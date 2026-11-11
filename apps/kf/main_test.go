package main

import (
	"bytes"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"filippo.io/age"
	"golang.org/x/sys/unix"

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

// openPTY returns the follower side of a new pseudo terminal.
func openPTY(t *testing.T) *os.File {
	t.Helper()
	leader, err := os.OpenFile("/dev/ptmx", os.O_RDWR, 0)
	if err != nil {
		t.Skipf("no pty available: %v", err)
	}
	t.Cleanup(func() { leader.Close() })
	if err := unix.IoctlSetPointerInt(int(leader.Fd()), unix.TIOCSPTLCK, 0); err != nil {
		t.Fatal(err)
	}
	n, err := unix.IoctlGetInt(int(leader.Fd()), unix.TIOCGPTN)
	if err != nil {
		t.Fatal(err)
	}
	follower, err := os.OpenFile(fmt.Sprintf("/dev/pts/%d", n), os.O_RDWR|unix.O_NOCTTY, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { follower.Close() })
	return follower
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
	ts := httptest.NewServer(api.New(st, api.DefaultMaxBlob))
	t.Cleanup(ts.Close)

	t.Setenv("XDG_RUNTIME_DIR", dir)
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
