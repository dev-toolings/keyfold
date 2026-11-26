package store

import (
	"bytes"
	"path/filepath"
	"strings"
	"testing"
)

func TestSeedRefusesOrphanData(t *testing.T) {
	st, err := OpenOffline(filepath.Join(t.TempDir(), "data"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.lock.Close()
	orphan := []byte("orphaned ciphertext")
	if err := st.Put(idA, orphan, ""); err != nil {
		t.Fatal(err)
	}
	err = st.Seed([]byte("new identity"), "new recipient", []Entry{{ID: idA, Ciphertext: []byte("replacement")}})
	if err == nil {
		t.Fatal("seed accepted orphaned vault data")
	}
	entries, err := st.Items()
	if err != nil {
		t.Fatal(err)
	}
	if st.Initialized() || len(entries) != 1 || !bytes.Equal(entries[0].Ciphertext, orphan) {
		t.Fatal("seed modified the incomplete vault")
	}
}

func TestInterruptedMaintenanceBlocksServingUntilReset(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	st, err := OpenOffline(dir)
	if err != nil {
		t.Fatal(err)
	}
	err = st.Seed([]byte("fake identity"), "fake recipient", []Entry{
		{ID: idA, Ciphertext: []byte("fake ciphertext")},
		{ID: "invalid"},
	})
	st.lock.Close()
	if err == nil {
		t.Fatal("seed accepted an invalid entry")
	}

	server, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := server.Lock(); err == nil || !strings.Contains(err.Error(), "offline maintenance was interrupted") {
		t.Fatalf("lock for serving after interrupted seed: %v", err)
	}
	offline, err := OpenOffline(dir)
	if err != nil {
		t.Fatal(err)
	}
	err = offline.Reset()
	offline.lock.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err := server.Lock(); err != nil {
		t.Fatal(err)
	}
	defer server.lock.Close()
	entries, err := server.Items()
	if err != nil {
		t.Fatal(err)
	}
	if server.Initialized() || len(entries) != 0 {
		t.Fatal("reset did not finish clearing the vault")
	}
}
