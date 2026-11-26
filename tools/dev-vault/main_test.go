package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"

	"keyfold/internal/store"
	"keyfold/internal/vault"
)

func TestSeedCreatesReadableDemoVault(t *testing.T) {
	st, err := store.OpenOffline(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := seed(st); err != nil {
		t.Fatal(err)
	}
	wrapped, recipient, err := st.Identity()
	if err != nil {
		t.Fatal(err)
	}
	id, err := vault.UnwrapIdentity(wrapped, demoPassword)
	if err != nil {
		t.Fatal(err)
	}
	if id.Recipient().String() != recipient {
		t.Fatal("seed identity does not match its recipient")
	}
	if err := seed(st); err == nil {
		t.Fatal("seed replaced an initialized vault")
	}
	entries, err := st.Items()
	if err != nil {
		t.Fatal(err)
	}
	kinds := make(map[string]bool)
	for _, entry := range entries {
		item, err := vault.DecryptItem(entry.Ciphertext, id)
		if err != nil {
			t.Fatal(err)
		}
		kinds[item.Kind] = true
	}
	for _, kind := range []string{"login", "token", "note", "identity"} {
		if !kinds[kind] {
			t.Errorf("missing demo item of kind %s", kind)
		}
	}
}

// holdLock waits until the flock of dir is free, starts args in their own
// process group, as a shell starts a job, and returns once they hold it.
func holdLock(t *testing.T, dir string, args ...string) *exec.Cmd {
	t.Helper()
	f, err := os.Open(filepath.Join(dir, ".lock"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	// locked reports whether another process holds the lock.
	locked := func() bool {
		err := unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB)
		if err == nil {
			unix.Flock(int(f.Fd()), unix.LOCK_UN)
		}
		return errors.Is(err, unix.EWOULDBLOCK)
	}
	for deadline := time.Now().Add(5 * time.Second); locked(); time.Sleep(20 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("a previous holder never released the lock")
		}
	}
	cmd := exec.Command(args[0], args[1:]...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if cmd.ProcessState == nil { // a reaped group id may already be reused
			unix.Kill(-cmd.Process.Pid, unix.SIGKILL)
			cmd.Wait()
		}
	})
	for deadline := time.Now().Add(5 * time.Second); !locked(); time.Sleep(20 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("the lock holder never took the lock")
		}
	}
	return cmd
}

func TestStopsOnlyMakeDev(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("make dev is found through /proc, on Linux only")
	}
	for _, tool := range []string{"make", "flock", "sleep"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skip(tool + " is not installed")
		}
	}
	dir := t.TempDir()
	if _, err := store.Open(dir); err != nil {
		t.Fatal(err)
	}
	lock := filepath.Join(dir, ".lock")
	if err := os.WriteFile(lock, nil, 0o600); err != nil {
		t.Fatal(err)
	}

	other := holdLock(t, dir, "flock", lock, "sleep", "60")
	if _, err := makeDevGroup(dir); err == nil {
		t.Fatal("a lock holder not started by make dev would be stopped")
	}
	unix.Kill(-other.Process.Pid, unix.SIGKILL)
	other.Wait()

	makefile := filepath.Join(t.TempDir(), "Makefile")
	if err := os.WriteFile(makefile, []byte("dev:\n\tflock "+lock+" sleep 60\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	elsewhere := holdLock(t, dir, "make", "-C", t.TempDir(), "-f", makefile, "dev")
	if _, err := makeDevGroup(dir); err == nil {
		t.Fatal("a make dev run from another directory would be stopped")
	}
	unix.Kill(-elsewhere.Process.Pid, unix.SIGKILL)
	elsewhere.Wait()

	dev := holdLock(t, dir, "make", "-f", makefile, "dev")
	group, err := makeDevGroup(dir)
	if err != nil {
		t.Fatal(err)
	}
	if group != dev.Process.Pid {
		t.Fatalf("found process group %d, make dev is %d", group, dev.Process.Pid)
	}
	st, err := stopMakeDev(group, dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Reset(); err != nil {
		t.Fatal(err)
	}
	if err := dev.Wait(); err == nil {
		t.Fatal("make dev exited normally instead of being interrupted")
	}
}
