package store

import (
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
