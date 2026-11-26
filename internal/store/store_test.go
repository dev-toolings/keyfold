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
	"time"

	"golang.org/x/sys/unix"
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
	st, dir := open(t)
	marker := filepath.Join(dir, "version")
	// Only the process holding the lock writes the file: one that opens the
	// directory next to a running server (-disable-totp) must not.
	if _, err := os.Stat(marker); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("Open alone wrote the version file: %v", err)
	}
	if err := st.Lock(); err != nil {
		t.Fatal(err)
	}
	if got, err := os.ReadFile(marker); err != nil || string(got) != "1\n" {
		t.Fatalf("after Lock: version file = %q, %v; want %q", got, err, "1\n")
	}
	if _, err := Open(dir); err != nil {
		t.Errorf("Open of a layout 1 directory: %v", err)
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

func TestRestoreRefusesAnArchiveCutShort(t *testing.T) {
	_, dir := vaultWithContent(t)
	var archive bytes.Buffer
	if err := Backup(dir, &archive); err != nil {
		t.Fatal(err)
	}
	whole := archive.Bytes()
	// The last 2048 bytes are the closing entry and the tar trailer: without
	// them the archive ends on a file boundary, as a tar file may.
	for _, size := range []int{len(whole) - 2048, len(whole) - 2048 - 1024, len(whole) / 2, 700} {
		parent := t.TempDir()
		if err := Restore(filepath.Join(parent, "data"), bytes.NewReader(whole[:size])); err == nil {
			t.Errorf("Restore accepted the first %d bytes of a %d byte archive", size, len(whole))
		}
		if left, _ := os.ReadDir(parent); len(left) != 0 {
			t.Errorf("cut at %d: a failed restore left %v behind", size, left)
		}
	}
}

// appearing reads like r, after making something at the restore target on
// the first read: by then Restore has seen the target missing.
type appearing struct {
	r    io.Reader
	make func()
}

func (a *appearing) Read(p []byte) (int, error) {
	if a.make != nil {
		a.make()
		a.make = nil
	}
	return a.r.Read(p)
}

func TestRestoreLeavesAloneWhatAppearsAtTheTarget(t *testing.T) {
	_, dir := vaultWithContent(t)
	var archive bytes.Buffer
	if err := Backup(dir, &archive); err != nil {
		t.Fatal(err)
	}
	for name, appear := range map[string]func(target string) string{
		"a file": func(target string) string {
			os.WriteFile(target, []byte("kept"), 0o600)
			return target
		},
		"a directory that is not empty": func(target string) string {
			os.Mkdir(target, 0o700)
			os.WriteFile(filepath.Join(target, "note"), []byte("kept"), 0o600)
			return filepath.Join(target, "note")
		},
	} {
		parent := t.TempDir()
		target := filepath.Join(parent, "data")
		var kept string
		r := &appearing{r: bytes.NewReader(archive.Bytes()), make: func() { kept = appear(target) }}
		if err := Restore(target, r); err == nil {
			t.Errorf("%s appeared at the target during the restore, and Restore replaced it", name)
		}
		if got, _ := os.ReadFile(kept); string(got) != "kept" {
			t.Errorf("%s: what appeared at the target changed: %q", name, got)
		}
		if left, _ := os.ReadDir(parent); len(left) != 1 {
			t.Errorf("%s: a failed restore left %v behind", name, left)
		}
	}

	// A file there from the start is refused before the archive is read.
	target := filepath.Join(t.TempDir(), "data")
	if err := os.WriteFile(target, []byte("kept"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Restore(target, bytes.NewReader(archive.Bytes())); err == nil {
		t.Error("Restore replaced a file with the vault")
	}
	if got, _ := os.ReadFile(target); string(got) != "kept" {
		t.Errorf("the file at the target changed: %q", got)
	}
}

func TestBackupListsItemsBeforeAttachmentsAndClosesTheArchive(t *testing.T) {
	_, dir := vaultWithContent(t)
	var archive bytes.Buffer
	if err := Backup(dir, &archive); err != nil {
		t.Fatal(err)
	}
	var names []string
	tr := tar.NewReader(&archive)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		names = append(names, h.Name)
	}
	want := []string{"version", "recipient.txt", "identity.age", "totp.json", "items/" + idA + ".age", "items/" + idB + ".age", "blobs/" + idA + ".age", "complete"}
	if strings.Join(names, " ") != strings.Join(want, " ") {
		t.Errorf("archive entries = %v, want %v", names, want)
	}
}

func TestBackupRefusesALinkInTheVault(t *testing.T) {
	_, dir := vaultWithContent(t)
	outside := filepath.Join(t.TempDir(), "outside")
	if err := os.WriteFile(outside, []byte("not part of the vault"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "items", idB+".age")
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	if err := Backup(dir, &archive); err == nil || bytes.Contains(archive.Bytes(), []byte("not part of the vault")) {
		t.Errorf("Backup followed a link out of the vault: %v", err)
	}
}

func TestBackupDoesNotWaitOnANamedPipe(t *testing.T) {
	_, dir := vaultWithContent(t)
	pipe := filepath.Join(dir, "items", idB+".age")
	if err := os.Remove(pipe); err != nil {
		t.Fatal(err)
	}
	if err := unix.Mkfifo(pipe, 0o600); err != nil {
		t.Skipf("no named pipe here: %v", err)
	}
	done := make(chan error, 1)
	go func() { done <- Backup(dir, io.Discard) }()
	select {
	case err := <-done:
		if err == nil {
			t.Error("Backup archived a named pipe")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Backup waits for a writer on a named pipe")
	}
}

func TestBackupKeepsDeposits(t *testing.T) {
	src := t.TempDir()
	st, err := Open(src)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Init([]byte("age-encryption.org/v1\nfake identity"), "fake-recipient"); err != nil {
		t.Fatal(err)
	}
	key := DepositKey{ID: strings.Repeat("a", 32), Name: "agent", TokenHash: "fake-hash", Recipient: "fake-recipient"}
	if err := st.AddDepositKey(key); err != nil {
		t.Fatal(err)
	}
	if _, err := st.PutDeposit(key.ID, strings.Repeat("b", 32), []byte("fake deposit")); err != nil {
		t.Fatal(err)
	}
	if err := st.PutCatalog(key.ID, []byte("fake catalog")); err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	if err := Backup(src, &archive); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(t.TempDir(), "restored")
	if err := Restore(dst, &archive); err != nil {
		t.Fatal(err)
	}
	restored, err := Open(dst)
	if err != nil {
		t.Fatal(err)
	}
	keys, _ := restored.DepositKeys()
	deposits, _ := restored.Deposits()
	if before, _ := st.Deposits(); len(deposits) == 1 && !deposits[0].Created.Equal(before[0].Created) {
		t.Errorf("restored deposit dated %s, archived %s: deposits are taken in arrival order", deposits[0].Created, before[0].Created)
	}
	catalog, _, err := restored.Catalog(key.ID)
	if len(keys) != 1 || len(deposits) != 1 || string(catalog) != "fake catalog" || err != nil {
		t.Fatalf("restored %d key(s), %d deposit(s), catalog %q (%v)", len(keys), len(deposits), catalog, err)
	}
}
