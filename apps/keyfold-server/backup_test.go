package main

import (
	"os"
	"path/filepath"
	"testing"

	"keyfold/internal/store"
)

func TestBackupFileIsPrivateAndNeverOverwritten(t *testing.T) {
	dir := t.TempDir()
	data := filepath.Join(dir, "data")
	st, err := store.Open(data)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Init([]byte("fake-identity"), "age1fake"); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "vault.tar")
	if err := backupTo(data, file); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(file); err != nil || info.Mode().Perm() != 0o600 || info.Size() == 0 {
		t.Errorf("backup file: %v, %v", info, err)
	}
	if err := backupTo(data, file); err == nil {
		t.Error("a second backup wrote over the first file")
	}
	if err := restoreFrom(filepath.Join(dir, "restored"), file); err != nil {
		t.Fatal(err)
	}
	if got, err := store.Open(filepath.Join(dir, "restored")); err != nil || !got.Initialized() {
		t.Errorf("the restored directory holds no vault: %v", err)
	}

	// A failed backup leaves no file to be taken for a good one, and a
	// finished one no partial file.
	empty := filepath.Join(dir, "empty.tar")
	if err := backupTo(filepath.Join(dir, "no-vault"), empty); err == nil {
		t.Error("backup of a directory without a vault succeeded")
	}
	if left, _ := filepath.Glob(filepath.Join(dir, "*.tar*")); len(left) != 1 || left[0] != file {
		t.Errorf("archive files in the directory: %v, want %s only", left, file)
	}
}
