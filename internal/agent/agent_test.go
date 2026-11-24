package agent

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// noRuntimeDir makes the environment look like macOS: no XDG_RUNTIME_DIR, and
// a temp dir of its own.
func noRuntimeDir(t *testing.T) string {
	t.Helper()
	tmp := t.TempDir()
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
