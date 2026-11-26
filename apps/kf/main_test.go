package main

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"filippo.io/age"

	"keyfold/internal/agent"
	"keyfold/internal/api"
	"keyfold/internal/store"
	"keyfold/internal/vault"
	"keyfold/internal/version"
)

func init() { vault.ScryptWorkFactor = 10 }

// fileWith returns an open file holding content, for use as stdin or stdout.
func fileWith(t *testing.T, content string) *os.File {
	t.Helper()
	f, err := os.CreateTemp(t.TempDir(), "io")
	if err != nil {
		t.Fatal(err)
	}
	f.WriteString(content)
	f.Seek(0, 0)
	t.Cleanup(func() { f.Close() })
	return f
}

func TestVersion(t *testing.T) {
	runtimeDir(t)
	var stderr bytes.Buffer
	out := fileWith(t, "")
	if code := run([]string{"-server", "http://127.0.0.1:1", "version"}, fileWith(t, ""), out, &stderr); code != 0 || stderr.Len() != 0 {
		t.Fatalf("kf version: exit %d, stderr %q", code, stderr.String())
	}
	got, err := os.ReadFile(out.Name())
	if err != nil {
		t.Fatal(err)
	}
	if want := "kf " + version.Display() + "\n"; string(got) != want {
		t.Errorf("stdout = %q, want %q", got, want)
	}
}

func TestGetRefusesTerminal(t *testing.T) {
	tty := openPTY(t)
	// No server and no agent: the refusal must come first.
	var stderr bytes.Buffer
	code := run([]string{"-server", "http://127.0.0.1:1", "get", "fake-name"}, fileWith(t, ""), tty, &stderr)
	if code != 1 {
		t.Fatalf("exit code %d, want 1", code)
	}
	if !bytes.Contains(stderr.Bytes(), []byte("refusing")) {
		t.Fatalf("stderr = %q", stderr.String())
	}
}

func TestInitInstallTokenHeader(t *testing.T) {
	for _, tc := range []struct{ name, token string }{
		{"with token", "fake-install-token"},
		{"missing token", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("KEYFOLD_INSTALL_TOKEN", tc.token)
			mux := http.NewServeMux()
			mux.HandleFunc("GET /api/v1/status", func(w http.ResponseWriter, r *http.Request) {
				if len(r.Header.Values("X-Install-Token")) != 0 {
					t.Error("the status request sent the install token")
				}
				io.WriteString(w, `{"initialized":false}`)
			})
			mux.HandleFunc("POST /api/v1/init", func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("X-Install-Token") != tc.token {
					t.Error("the init request did not send the configured token")
				}
				if tc.token == "" {
					w.WriteHeader(http.StatusForbidden)
					io.WriteString(w, `{"error":"X-Install-Token is required and must match the install token in the server log"}`)
					return
				}
				w.WriteHeader(http.StatusCreated)
			})
			ts := httptest.NewServer(mux)
			defer ts.Close()

			var stderr bytes.Buffer
			err := cmdInit(&client{base: ts.URL}, func(string) (string, error) { return "fake-install-master-password", nil }, &stderr)
			if tc.token == "" {
				if err == nil || !strings.Contains(err.Error(), "server log") {
					t.Fatal("a missing token must point the user to the server log")
				}
				return
			}
			if err != nil || !strings.Contains(stderr.String(), "vault initialized") {
				t.Fatalf("init did not complete: %v", err)
			}
		})
	}
}

// runtimeDir points XDG_RUNTIME_DIR at a new directory only this user can
// write to, as the real one is: the agent refuses any other.
func runtimeDir(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	if err := os.Chmod(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XDG_RUNTIME_DIR", dir)
}

// setupVault starts a server on a new vault and an agent holding its identity.
func setupVault(t *testing.T) (string, *store.Store, *age.X25519Identity) {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "data"))
	if err != nil {
		t.Fatal(err)
	}
	id, _ := age.GenerateX25519Identity()
	wrapped, err := vault.WrapIdentity(id, "fake-master-123")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Init(wrapped, id.Recipient().String()); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(api.New(st, api.Options{}))
	t.Cleanup(ts.Close)

	runtimeDir(t)
	l, err := agent.Listen(ts.URL)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { agent.Serve(l, id.String(), time.Minute); close(done) }()
	t.Cleanup(func() { agent.Lock(ts.URL); <-done })
	return ts.URL, st, id
}

func TestSetThenGet(t *testing.T) {
	url, _, _ := setupVault(t)
	var stderr bytes.Buffer
	stdin := fileWith(t, "fake-passphrase-123\n")
	if code := run([]string{"-server", url, "set", "fake-key", "-kind", "ssh-passphrase"}, stdin, fileWith(t, ""), &stderr); code != 0 {
		t.Fatalf("set: exit %d: %s", code, stderr.String())
	}
	out := fileWith(t, "")
	if code := run([]string{"-server", url, "get", "fake-key"}, fileWith(t, ""), out, &stderr); code != 0 {
		t.Fatalf("get: exit %d: %s", code, stderr.String())
	}
	got, _ := os.ReadFile(out.Name())
	if string(got) != "fake-passphrase-123\n" {
		t.Fatalf("get printed %q", got)
	}
}

// item reads back the only item named name, straight from the store.
func item(t *testing.T, st *store.Store, id age.Identity, name string) (string, vault.Item) {
	t.Helper()
	entries, err := st.Items()
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		it, err := vault.DecryptItem(e.Ciphertext, id)
		if err != nil {
			t.Fatal(err)
		}
		if it.Name == name {
			return e.ETag, it
		}
	}
	t.Fatalf("no item %q", name)
	return "", vault.Item{}
}

func TestMigrateThenSetKeepsFields(t *testing.T) {
	url, st, id := setupVault(t)
	// A v1 item, as written before the v2 format.
	ct, err := vault.Encrypt([]byte(`{"name":"fake-old","kind":"password","value":"fake-value-123","note":"fake-note"}`), id.Recipient())
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Put("00000000000000000000000000000001", ct, ""); err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	out := fileWith(t, "")
	if code := run([]string{"-server", url, "migrate"}, fileWith(t, ""), out, &stderr); code != 0 {
		t.Fatalf("migrate: exit %d: %s", code, stderr.String())
	}
	if got, _ := os.ReadFile(out.Name()); string(got) != "fake-old\tv1 password -> v2 login\n" {
		t.Fatalf("dry run printed %q", got)
	}
	if etag, _ := item(t, st, id, "fake-old"); etag != store.ETag(ct) {
		t.Fatal("the dry run wrote the item")
	}
	if code := run([]string{"-server", url, "migrate", "-apply"}, fileWith(t, ""), fileWith(t, ""), &stderr); code != 0 {
		t.Fatalf("migrate -apply: exit %d: %s", code, stderr.String())
	}
	_, it := item(t, st, id, "fake-old")
	if it.V != vault.ItemVersion || it.Kind != "login" || it.Value != "fake-value-123" || it.Note != "fake-note" {
		t.Fatalf("migrated item = %+v", it)
	}

	// set changes the value and keeps what it was not asked to change.
	it.Username = "fake-user"
	it.Project = "fake-project"
	it.Specialty = "Backend"
	it.Languages = []string{"Go", "SQL"}
	it.Tags = []string{"fake-tag", "fake-other"}
	etag, _ := item(t, st, id, "fake-old")
	ct2, err := vault.EncryptItem(it, id.Recipient())
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Put("00000000000000000000000000000001", ct2, etag); err != nil {
		t.Fatal(err)
	}
	if code := run([]string{"-server", url, "set", "fake-old"}, fileWith(t, "fake-value-456\n"), fileWith(t, ""), &stderr); code != 0 {
		t.Fatalf("set: exit %d: %s", code, stderr.String())
	}
	_, it = item(t, st, id, "fake-old")
	if it.Value != "fake-value-456" || it.Username != "fake-user" || it.Note != "fake-note" || it.Kind != "login" {
		t.Fatalf("after set: %+v", it)
	}
	if it.V != 3 || it.Project != "fake-project" || it.Specialty != "Backend" ||
		strings.Join(it.Languages, ",") != "Go,SQL" || strings.Join(it.Tags, ",") != "fake-tag,fake-other" {
		t.Fatalf("classification after set: %+v", it)
	}

	// Flags do change what they name, and only that.
	args := []string{"-server", url, "set", "fake-old", "-note", "", "-kind", "token"}
	if code := run(args, fileWith(t, "fake-value-789\n"), fileWith(t, ""), &stderr); code != 0 {
		t.Fatalf("set with flags: exit %d: %s", code, stderr.String())
	}
	_, it = item(t, st, id, "fake-old")
	if it.Value != "fake-value-789" || it.Note != "" || it.Kind != "token" || it.Username != "fake-user" {
		t.Fatalf("after set with flags: %+v", it)
	}
}

func TestSetKeepsEnvironment(t *testing.T) {
	url, st, id := setupVault(t)
	storeItem(t, url, vault.Item{Name: "fake-token", Kind: "token", Value: "fake-before", Environment: "prod"})
	var stderr bytes.Buffer
	if code := run([]string{"-server", url, "set", "fake-token"}, fileWith(t, "fake-after\n"), fileWith(t, ""), &stderr); code != 0 {
		t.Fatalf("set: exit %d: %s", code, stderr.String())
	}
	if _, it := item(t, st, id, "fake-token"); it.Value != "fake-after" || it.Environment != "prod" || it.V != 5 {
		t.Fatalf("after set: %+v", it)
	}
}

func TestPlainHTTPIsOnlyAcceptedForLoopback(t *testing.T) {
	// Refused before any network call; the accepted ones fail later, on a closed port.
	for server, refused := range map[string]bool{
		"http://192.0.2.10:8717": true,
		"http://vault.example":   true,
		"ftp://127.0.0.1":        true,
		"http://127.0.0.1:1":     false,
		"http://localhost:1":     false,
		"http://[::1]:1":         false,
		"https://127.0.0.1:1":    false,
	} {
		err := (&client{base: server}).do("GET", "/api/v1/status", nil, nil)
		if got := err != nil && strings.Contains(err.Error(), "plain http"); got != refused {
			t.Errorf("%s: refused = %v, want %v (error: %v)", server, got, refused, err)
		}
	}
}

func TestLocalCommandsIgnoreTheServerURL(t *testing.T) {
	runtimeDir(t)
	t.Setenv("KEYFOLD_SERVER", "http://192.0.2.10:8717")
	var stderr bytes.Buffer
	if code := run([]string{"lock"}, fileWith(t, ""), fileWith(t, ""), &stderr); code != 0 {
		t.Errorf("kf lock: exit %d, stderr %q", code, stderr.String())
	}
}

func TestRedirectIsNotFollowed(t *testing.T) {
	var leaked string
	elsewhere := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		leaked = r.Header.Get("Authorization") + r.Header.Get("X-TOTP-Code")
	}))
	t.Cleanup(elsewhere.Close)
	hits := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		http.Redirect(w, r, elsewhere.URL, http.StatusTemporaryRedirect)
	}))
	t.Cleanup(ts.Close)

	c := &client{base: ts.URL, token: "fake-token", totp: "123456"}
	if err := c.do("GET", "/api/v1/items", nil, nil); err == nil {
		t.Error("a redirect answer was taken for a success")
	}
	if hits != 1 || leaked != "" {
		t.Errorf("hits = %d, headers that reached the redirect target = %q", hits, leaked)
	}
}

// An agent that cannot open its socket says why on stdout, which unlock shows:
// it has no terminal of its own.
func TestAgentStartErrorIsReported(t *testing.T) {
	long := filepath.Join(t.TempDir(), strings.Repeat("d", 120))
	if err := os.MkdirAll(long, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XDG_RUNTIME_DIR", long) // past the Unix socket path limit
	id, _ := age.GenerateX25519Identity()
	out := fileWith(t, "")
	err := cmdAgent("https://vault.example.test", nil, fileWith(t, id.String()+"\n"), out)
	if err == nil {
		t.Fatal("the agent started on a socket path past the limit")
	}
	out.Seek(0, 0)
	b, _ := io.ReadAll(out)
	if line := strings.TrimSpace(string(b)); line != err.Error() {
		t.Fatalf("agent stdout = %q, want the error %q", line, err)
	}
}
