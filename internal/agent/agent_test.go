package agent

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const testServer = "https://vault.example.test"

// noRuntimeDir makes the environment look like macOS: no XDG_RUNTIME_DIR, and
// a temp dir of its own.
func noRuntimeDir(t *testing.T) string {
	t.Helper()
	tmp := t.TempDir()
	if err := os.Chmod(tmp, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XDG_RUNTIME_DIR", "")
	t.Setenv("TMPDIR", tmp)
	return tmp
}

func TestAgentWorksWithoutXDGRuntimeDir(t *testing.T) {
	noRuntimeDir(t)
	if _, err := Identity(testServer); !errors.Is(err, ErrNoAgent) {
		t.Fatalf("before unlock: got %v, want ErrNoAgent", err)
	}
	l, err := Listen(testServer)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { Serve(l, "AGE-SECRET-KEY-FAKE", time.Minute); close(done) }()

	dir := filepath.Dir(SocketPath(testServer))
	if info, err := os.Stat(dir); err != nil || info.Mode().Perm() != 0o700 {
		t.Errorf("socket dir: %v, mode %v, want 0700", err, info.Mode().Perm())
	}
	if info, err := os.Stat(SocketPath(testServer)); err != nil || info.Mode().Perm() != 0o600 {
		t.Errorf("socket: %v, mode %v, want 0600", err, info.Mode().Perm())
	}
	if got, err := Identity(testServer); err != nil || got != "AGE-SECRET-KEY-FAKE" {
		t.Errorf("Identity() = %q, %v", got, err)
	}
	if err := Lock(testServer); err != nil {
		t.Errorf("Lock() = %v", err)
	}
	<-done
}

func TestSocketDirThatIsALinkIsRefused(t *testing.T) {
	noRuntimeDir(t)
	dir := filepath.Dir(SocketPath(testServer))
	if err := os.Symlink(t.TempDir(), dir); err != nil {
		t.Fatal(err)
	}
	if l, err := Listen(testServer); err == nil {
		l.Close()
		t.Error("Listen() accepted a socket directory that is a link")
	}
	if _, err := Identity(testServer); err == nil || errors.Is(err, ErrNoAgent) {
		t.Errorf("Identity() = %v, want a refusal of the directory", err)
	}
}

func TestSharedTempDirWithoutStickyBitIsRefused(t *testing.T) {
	tmp := noRuntimeDir(t)
	if err := os.Chmod(tmp, 0o777); err != nil {
		t.Fatal(err)
	}
	if l, err := Listen(testServer); err == nil {
		l.Close()
		t.Error("Listen() put the socket where another user can replace its directory")
	}
	if err := os.Chmod(tmp, 0o777|os.ModeSticky); err != nil {
		t.Fatal(err)
	}
	l, err := Listen(testServer)
	if err != nil {
		t.Fatalf("Listen() in a sticky shared dir: %v", err)
	}
	l.Close()
}

func TestUnsafeSocketAncestor(t *testing.T) {
	root, err := filepath.EvalSymlinks(noRuntimeDir(t))
	if err != nil {
		t.Fatal(err)
	}
	open := filepath.Join(root, "open")
	mine := filepath.Join(open, "mine")
	if err := os.MkdirAll(mine, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(open, 0o777); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TMPDIR", mine)

	if l, err := Listen(testServer); err == nil {
		l.Close()
		t.Errorf("Listen() accepted a socket under %s (mode 0777, no sticky bit)", open)
	} else if errors.Is(err, ErrNoAgent) || !strings.Contains(err.Error(), open) {
		t.Errorf("Listen() = %v, want refusal naming %s", err, open)
	}
	if _, err := Identity(testServer); err == nil || errors.Is(err, ErrNoAgent) || !strings.Contains(err.Error(), open) {
		t.Errorf("Identity() = %v, want refusal naming %s", err, open)
	}
}

func TestTempDirLink(t *testing.T) {
	tmp, err := os.MkdirTemp("", "kf")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(tmp) })
	root, err := filepath.EvalSymlinks(tmp)
	if err != nil {
		t.Fatal(err)
	}
	open := filepath.Join(root, "open")
	if err := os.Mkdir(open, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(open, 0o777); err != nil {
		t.Fatal(err)
	}
	// The alias exceeds the Unix socket path limit, so both calls must use its target.
	link := filepath.Join(open, strings.Repeat("link", 28))
	if err := os.Symlink(root, link); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XDG_RUNTIME_DIR", "")
	t.Setenv("TMPDIR", link)

	l, err := Listen(testServer)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	want := filepath.Join(root, filepath.Base(filepath.Dir(SocketPath(testServer))), filepath.Base(SocketPath(testServer)))
	if got := l.Addr().String(); got != want {
		t.Fatalf("Listen() bound %s, want %s", got, want)
	}
	go Serve(l, "test identity", time.Minute)
	if got, err := Identity(testServer); err != nil || got != "test identity" {
		t.Errorf("Identity() = %q, %v", got, err)
	}
	if err := Lock(testServer); err != nil {
		t.Errorf("Lock() = %v", err)
	}
}

// serveAgent starts an agent for server holding identity and stops it at the end of the test.
func serveAgent(t *testing.T, server, identity string) {
	t.Helper()
	l, err := Listen(server)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { Serve(l, identity, time.Minute); close(done) }()
	t.Cleanup(func() { Lock(server); <-done })
}

func TestServerKeyIgnoresDefaultPort(t *testing.T) {
	for _, pair := range [][2]string{
		{"https://[::1]:443", "https://[::1]"},
		{"http://127.0.0.1:80/", "http://127.0.0.1"},
	} {
		if serverKey(pair[0]) != serverKey(pair[1]) {
			t.Errorf("%s and %s get different agents", pair[0], pair[1])
		}
	}
	if serverKey("https://[::1]:8443") == serverKey("https://[::1]") {
		t.Error("another port must get another agent")
	}
}

func TestOneAgentPerServer(t *testing.T) {
	noRuntimeDir(t)
	serveAgent(t, "https://vault.example.test", "identity of the remote vault")
	serveAgent(t, "http://127.0.0.1:8717", "identity of the local vault")
	if got, err := Identity("HTTPS://Vault.Example.test:443/"); err != nil || got != "identity of the remote vault" {
		t.Errorf("remote agent: Identity() = %q, %v", got, err)
	}
	if err := Lock("http://127.0.0.1:8717"); err != nil {
		t.Fatalf("Lock() of the local agent = %v", err)
	}
	if _, err := Identity("http://127.0.0.1:8717"); !errors.Is(err, ErrNoAgent) {
		t.Errorf("local agent after its lock: err = %v, want ErrNoAgent", err)
	}
	if got, err := Identity("https://vault.example.test"); err != nil || got != "identity of the remote vault" {
		t.Errorf("locking the local agent stopped the remote one: Identity() = %q, %v", got, err)
	}
}
