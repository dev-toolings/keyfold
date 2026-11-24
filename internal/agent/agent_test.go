package agent

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

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
	if _, err := Identity(); !errors.Is(err, ErrNoAgent) {
		t.Fatalf("before unlock: got %v, want ErrNoAgent", err)
	}
	l, err := Listen()
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { Serve(l, "AGE-SECRET-KEY-FAKE", time.Minute); close(done) }()

	dir := filepath.Dir(SocketPath())
	if info, err := os.Stat(dir); err != nil || info.Mode().Perm() != 0o700 {
		t.Errorf("socket dir: %v, mode %v, want 0700", err, info.Mode().Perm())
	}
	if info, err := os.Stat(SocketPath()); err != nil || info.Mode().Perm() != 0o600 {
		t.Errorf("socket: %v, mode %v, want 0600", err, info.Mode().Perm())
	}
	if got, err := Identity(); err != nil || got != "AGE-SECRET-KEY-FAKE" {
		t.Errorf("Identity() = %q, %v", got, err)
	}
	if err := Lock(); err != nil {
		t.Errorf("Lock() = %v", err)
	}
	<-done
}

func TestSocketDirThatIsALinkIsRefused(t *testing.T) {
	noRuntimeDir(t)
	dir := filepath.Dir(SocketPath())
	if err := os.Symlink(t.TempDir(), dir); err != nil {
		t.Fatal(err)
	}
	if l, err := Listen(); err == nil {
		l.Close()
		t.Error("Listen() accepted a socket directory that is a link")
	}
	if _, err := Identity(); err == nil || errors.Is(err, ErrNoAgent) {
		t.Errorf("Identity() = %v, want a refusal of the directory", err)
	}
}

func TestSharedTempDirWithoutStickyBitIsRefused(t *testing.T) {
	tmp := noRuntimeDir(t)
	if err := os.Chmod(tmp, 0o777); err != nil {
		t.Fatal(err)
	}
	if l, err := Listen(); err == nil {
		l.Close()
		t.Error("Listen() put the socket where another user can replace its directory")
	}
	if err := os.Chmod(tmp, 0o777|os.ModeSticky); err != nil {
		t.Fatal(err)
	}
	l, err := Listen()
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

	if l, err := Listen(); err == nil {
		l.Close()
		t.Errorf("Listen() accepted a socket under %s (mode 0777, no sticky bit)", open)
	} else if errors.Is(err, ErrNoAgent) || !strings.Contains(err.Error(), open) {
		t.Errorf("Listen() = %v, want refusal naming %s", err, open)
	}
	if _, err := Identity(); err == nil || errors.Is(err, ErrNoAgent) || !strings.Contains(err.Error(), open) {
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

	l, err := Listen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	want := filepath.Join(root, filepath.Base(filepath.Dir(SocketPath())), "agent.sock")
	if got := l.Addr().String(); got != want {
		t.Fatalf("Listen() bound %s, want %s", got, want)
	}
	go Serve(l, "test identity", time.Minute)
	if got, err := Identity(); err != nil || got != "test identity" {
		t.Errorf("Identity() = %q, %v", got, err)
	}
	if err := Lock(); err != nil {
		t.Errorf("Lock() = %v", err)
	}
}
