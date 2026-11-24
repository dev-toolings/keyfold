package main

import (
	"bytes"
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
	l, err := agent.Listen()
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { agent.Serve(l, id.String(), time.Minute); close(done) }()
	t.Cleanup(func() { agent.Lock(); <-done })
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
