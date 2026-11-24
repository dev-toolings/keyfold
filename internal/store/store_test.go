package store

import (
	"archive/tar"
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	idA = "000000000000000000000000000000aa"
	idB = "000000000000000000000000000000bb"
)

func open(t *testing.T) (*Store, string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "data")
	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	return st, dir
}

func TestItemsAreWrittenReadAndDeleted(t *testing.T) {
	st, dir := open(t)
	if err := st.Put(idA, []byte("fake-ciphertext-1"), ""); err != nil {
		t.Fatal(err)
	}
	items, err := st.Items()
	if err != nil || len(items) != 1 || items[0].ID != idA || string(items[0].Ciphertext) != "fake-ciphertext-1" {
		t.Fatalf("Items() = %+v, %v", items, err)
	}

	if err := st.Put(idA, []byte("fake-ciphertext-2"), "stale-etag"); !errors.Is(err, ErrConflict) {
		t.Errorf("Put with a stale ETag: %v, want ErrConflict", err)
	}
	if err := st.Put(idA, []byte("fake-ciphertext-2"), items[0].ETag); err != nil {
		t.Errorf("Put with the current ETag: %v", err)
	}
	if err := st.Delete(idA, items[0].ETag); !errors.Is(err, ErrConflict) {
		t.Errorf("Delete with a stale ETag: %v, want ErrConflict", err)
	}
	if err := st.Delete(idA, ""); err != nil {
		t.Errorf("Delete: %v", err)
	}
	if err := st.Delete(idA, ""); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("Delete of a missing item: %v, want os.ErrNotExist", err)
	}
	if left, _ := filepath.Glob(filepath.Join(dir, "items", "*")); len(left) != 0 {
		t.Errorf("files left in items/: %v", left)
	}
}

func TestFilesArePrivate(t *testing.T) {
	st, dir := open(t)
	if err := st.Init([]byte("fake-identity"), "age1fake"); err != nil {
		t.Fatal(err)
	}
	if err := st.Put(idA, []byte("fake-ciphertext"), ""); err != nil {
		t.Fatal(err)
	}
	if err := st.PutBlob(idB, strings.NewReader("fake-attachment")); err != nil {
		t.Fatal(err)
	}
	for path, want := range map[string]os.FileMode{
		"":                      0o700,
		"items":                 0o700,
		"blobs":                 0o700,
		"identity.age":          0o600,
		"recipient.txt":         0o600,
		"items/" + idA + ".age": 0o600,
		"blobs/" + idB + ".age": 0o600,
	} {
		info, err := os.Stat(filepath.Join(dir, path))
		if err != nil || info.Mode().Perm() != want {
			t.Errorf("%q: mode %v, %v; want %v", path, info.Mode().Perm(), err, want)
		}
	}
}

func TestBlobIsStoredWholeOrNotAtAll(t *testing.T) {
	st, dir := open(t)
	if err := st.PutBlob(idA, strings.NewReader("fake-attachment")); err != nil {
		t.Fatal(err)
	}
	f, err := st.Blob(idA)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(f)
	f.Close()
	if string(got) != "fake-attachment" {
		t.Errorf("Blob() = %q", got)
	}

	broken := io.MultiReader(bytes.NewReader([]byte("half")), failingReader{})
	if err := st.PutBlob(idB, broken); err == nil {
		t.Error("PutBlob accepted a body that failed before its end")
	}
	if left, _ := filepath.Glob(filepath.Join(dir, "blobs", "*")); len(left) != 1 {
		t.Errorf("blobs/ after a failed upload: %v, want the first attachment only", left)
	}
	if err := st.DeleteBlob(idA); err != nil {
		t.Errorf("DeleteBlob: %v", err)
	}
}

type failingReader struct{}

func (failingReader) Read([]byte) (int, error) { return 0, errors.New("connection lost") }

func TestSecondWriterIsRefused(t *testing.T) {
	st, dir := open(t)
	if err := st.Lock(); err != nil {
		t.Fatal(err)
	}
	other, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := other.Lock(); !errors.Is(err, ErrInUse) {
		t.Errorf("second Lock: %v, want ErrInUse", err)
	}
	// What a process exit does: the lock goes with the file.
	st.lock.Close()
	if err := other.Lock(); err != nil {
		t.Errorf("Lock after the first writer is gone: %v", err)
	}
}

func TestLockRemovesTempFilesOfAKilledWriter(t *testing.T) {
	st, dir := open(t)
	if err := st.Put(idA, []byte("fake-ciphertext"), ""); err != nil {
		t.Fatal(err)
	}
	for _, left := range []string{"items/.tmp-123", "blobs/.tmp-456", ".tmp-789"} {
		if err := os.WriteFile(filepath.Join(dir, left), []byte("half written"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := st.Lock(); err != nil {
		t.Fatal(err)
	}
	for _, left := range []string{"items/.tmp-123", "blobs/.tmp-456", ".tmp-789"} {
		if _, err := os.Stat(filepath.Join(dir, left)); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("%s is still there: %v", left, err)
		}
	}
	if items, err := st.Items(); err != nil || len(items) != 1 {
		t.Errorf("Items() after the cleanup = %d items, %v; want the stored one", len(items), err)
	}
}

func TestLayoutVersion(t *testing.T) {
	_, dir := open(t)
	marker := filepath.Join(dir, "version")
	if got, err := os.ReadFile(marker); err != nil || string(got) != "1\n" {
		t.Fatalf("a new directory: version file = %q, %v; want %q", got, err, "1\n")
	}

	// A directory from before the version file is layout 1 and gets marked.
	if err := os.Remove(marker); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(dir); err != nil {
		t.Fatalf("Open of a directory without a version file: %v", err)
	}
	if got, _ := os.ReadFile(marker); string(got) != "1\n" {
		t.Errorf("the version file was not written back: %q", got)
	}

	if err := os.WriteFile(marker, []byte("2\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(dir); err == nil || !strings.Contains(err.Error(), "layout version 2") || !strings.Contains(err.Error(), "up to 1") {
		t.Errorf("Open of a newer layout: %v, want a refusal naming both versions", err)
	}
}

// vaultWithContent returns a store holding an identity, a TOTP secret, two
// items and one attachment, plus what a killed writer and a lock leave behind.
func vaultWithContent(t *testing.T) (*Store, string) {
	t.Helper()
	st, dir := open(t)
	if err := st.Init([]byte("fake-identity"), "age1fake"); err != nil {
		t.Fatal(err)
	}
	if err := st.SetTOTP(TOTP{Secret: "FAKESECRET", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	for id, ct := range map[string]string{idA: "fake-ciphertext-a", idB: "fake-ciphertext-b"} {
		if err := st.Put(id, []byte(ct), ""); err != nil {
			t.Fatal(err)
		}
	}
	if err := st.PutBlob(idA, strings.NewReader("fake-attachment")); err != nil {
		t.Fatal(err)
	}
	if err := st.Lock(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "items", ".tmp-123"), []byte("half written"), 0o600); err != nil {
		t.Fatal(err)
	}
	return st, dir
}

func TestBackupThenRestoreGivesTheSameVault(t *testing.T) {
	st, dir := vaultWithContent(t)
	var archive bytes.Buffer
	if err := Backup(dir, &archive); err != nil {
		t.Fatal(err)
	}
	restored := filepath.Join(t.TempDir(), "restored")
	if err := Restore(restored, &archive); err != nil {
		t.Fatal(err)
	}
	got, err := Open(restored)
	if err != nil {
		t.Fatal(err)
	}

	wantItems, _ := st.Items()
	gotItems, err := got.Items()
	if err != nil || len(gotItems) != 2 {
		t.Fatalf("restored Items() = %d items, %v", len(gotItems), err)
	}
	for i := range wantItems {
		if gotItems[i].ID != wantItems[i].ID || gotItems[i].ETag != wantItems[i].ETag || !bytes.Equal(gotItems[i].Ciphertext, wantItems[i].Ciphertext) {
			t.Errorf("item %d: got %+v, want %+v", i, gotItems[i], wantItems[i])
		}
	}
	f, err := got.Blob(idA)
	if err != nil {
		t.Fatal(err)
	}
	blob, _ := io.ReadAll(f)
	f.Close()
	if string(blob) != "fake-attachment" {
		t.Errorf("restored attachment = %q", blob)
	}
	if totp, err := got.TOTP(); err != nil || totp != (TOTP{Secret: "FAKESECRET", Enabled: true}) {
		t.Errorf("restored TOTP = %+v, %v", totp, err)
	}
	if id, rcpt, err := got.Identity(); err != nil || string(id) != "fake-identity" || rcpt != "age1fake" {
		t.Errorf("restored identity = %q, %q, %v", id, rcpt, err)
	}

	var files []string
	filepath.WalkDir(restored, func(path string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			rel, _ := filepath.Rel(restored, path)
			files = append(files, rel)
			if info, _ := d.Info(); info.Mode().Perm() != 0o600 {
				t.Errorf("%s restored with mode %v, want 0600", rel, info.Mode().Perm())
			}
		}
		return nil
	})
	want := []string{"blobs/" + idA + ".age", "identity.age", "items/" + idA + ".age", "items/" + idB + ".age", "recipient.txt", "totp.json", "version"}
	if strings.Join(files, " ") != strings.Join(want, " ") {
		t.Errorf("restored files = %v, want %v (no temp file, no lock)", files, want)
	}
}

func TestRestoreNeverWritesOverAVault(t *testing.T) {
	_, dir := vaultWithContent(t)
	var archive bytes.Buffer
	if err := Backup(dir, &archive); err != nil {
		t.Fatal(err)
	}
	other, otherDir := open(t)
	if err := other.Put(idB, []byte("kept"), ""); err != nil {
		t.Fatal(err)
	}
	if err := Restore(otherDir, &archive); err == nil {
		t.Fatal("Restore wrote into a directory that is not empty")
	}
	if items, _ := other.Items(); len(items) != 1 || string(items[0].Ciphertext) != "kept" {
		t.Errorf("the existing vault changed: %+v", items)
	}
}

func TestRestoreRefusesAForeignArchive(t *testing.T) {
	for name, entry := range map[string]string{"path leaving the directory": "../evil", "unknown file": "items/notes.txt"} {
		var archive bytes.Buffer
		tw := tar.NewWriter(&archive)
		for _, n := range []string{"identity.age", entry} {
			tw.WriteHeader(&tar.Header{Name: n, Mode: 0o600, Size: 4})
			tw.Write([]byte("fake"))
		}
		tw.Close()

		parent := t.TempDir()
		if err := Restore(filepath.Join(parent, "data"), &archive); err == nil {
			t.Errorf("%s: Restore accepted the archive", name)
		}
		if left, _ := os.ReadDir(parent); len(left) != 0 {
			t.Errorf("%s: a failed restore left %v behind", name, left)
		}
	}
}

func TestBackupNextToAWriterHoldsWholeFilesOnly(t *testing.T) {
	st, dir := vaultWithContent(t)
	versions := [][]byte{bytes.Repeat([]byte("a"), 1<<20), bytes.Repeat([]byte("b"), 1<<20)}
	stop, done := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; ; i++ {
			select {
			case <-stop:
				return
			default:
				st.Put(idA, versions[i%2], "")
			}
		}
	}()
	for range 20 {
		var archive bytes.Buffer
		if err := Backup(dir, &archive); err != nil {
			t.Fatal(err)
		}
		tr := tar.NewReader(&archive)
		for {
			h, err := tr.Next()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatal(err)
			}
			if h.Name != "items/"+idA+".age" {
				continue
			}
			got, _ := io.ReadAll(tr)
			if !bytes.Equal(got, versions[0]) && !bytes.Equal(got, versions[1]) && string(got) != "fake-ciphertext-a" {
				t.Fatalf("the archived item is none of the versions written: %d bytes", len(got))
			}
		}
	}
	close(stop)
	<-done
}

func TestBackupNeedsAVault(t *testing.T) {
	_, dir := open(t)
	if err := Backup(dir, io.Discard); err == nil {
		t.Error("Backup archived a directory that holds no vault")
	}
}
