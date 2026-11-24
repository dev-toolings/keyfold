package main

import (
	"fmt"
	"os"
	"testing"

	"golang.org/x/sys/unix"
)

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
