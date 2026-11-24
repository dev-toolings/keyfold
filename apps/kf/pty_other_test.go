//go:build !linux

package main

import (
	"os"
	"testing"
)

// openPTY skips the test: opening a pseudo terminal is written for Linux only.
func openPTY(t *testing.T) *os.File {
	t.Helper()
	t.Skip("pseudo terminal tests run on Linux only")
	return nil
}
