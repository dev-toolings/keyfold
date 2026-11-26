package store

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const maintenanceFile = ".maintenance"

// OpenOffline opens a local development vault and takes the server's writer lock.
// Reject unexpected entries before Open can create directories or change modes.
func OpenOffline(dir string) (*Store, error) {
	info, err := os.Lstat(dir)
	switch {
	case errors.Is(err, os.ErrNotExist):
	case err != nil:
		return nil, err
	case !info.IsDir():
		return nil, fmt.Errorf("%s is not a data directory", dir)
	default:
		entries, err := os.ReadDir(dir)
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			switch entry.Name() {
			case itemsDir, blobsDir, depositsDir:
				if entry.IsDir() {
					continue
				}
			case identityFile, recipientFile, totpFile, versionFile, lockFile, maintenanceFile:
				if entry.Type().IsRegular() {
					continue
				}
			default:
				if match, _ := filepath.Match(tmpPattern, entry.Name()); match && entry.Type().IsRegular() {
					continue // Lock removes temp files left by an interrupted write.
				}
			}
			return nil, fmt.Errorf("unexpected entry in data directory: %s", filepath.Join(dir, entry.Name()))
		}
	}
	st, err := Open(dir)
	if err != nil {
		return nil, err
	}
	if err := st.acquireLock(true); err != nil {
		return nil, err
	}
	return st, nil
}

// Seed initializes an empty, locked store and marks partial writes for reset.
func (s *Store) Seed(identity []byte, recipient string, entries []Entry) error {
	if s.lock == nil {
		return errors.New("seed requires the data directory lock")
	}
	if err := s.SeedReady(); err != nil {
		return err
	}
	marker := filepath.Join(s.dir, maintenanceFile)
	if err := writeAtomic(marker, strings.NewReader("seed\n")); err != nil {
		return err
	}
	for _, entry := range entries {
		if err := s.Put(entry.ID, entry.Ciphertext, ""); err != nil {
			return err
		}
	}
	if err := s.Init(identity, recipient); err != nil {
		return err
	}
	return remove(marker)
}

// SeedReady returns why Seed would refuse the directory, or nil when it holds
// no vault state.
func (s *Store) SeedReady() error {
	if s.Initialized() {
		return errors.New("the vault is already initialized; use an empty DATA directory for demo data")
	}
	for _, name := range []string{identityFile, recipientFile, totpFile, maintenanceFile} {
		if _, err := os.Lstat(filepath.Join(s.dir, name)); err == nil {
			return errors.New("the data directory contains vault state; use an empty DATA directory for demo data")
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	for _, name := range []string{itemsDir, blobsDir, depositsDir} {
		files, err := os.ReadDir(filepath.Join(s.dir, name))
		if err != nil {
			return err
		}
		if len(files) != 0 {
			return errors.New("the data directory contains vault state; use an empty DATA directory for demo data")
		}
	}
	return nil
}

// Reset removes the vault state while keeping the layout and writer lock.
func (s *Store) Reset() error {
	if s.lock == nil {
		return errors.New("reset requires the data directory lock")
	}
	marker := filepath.Join(s.dir, maintenanceFile)
	if err := writeAtomic(marker, strings.NewReader("reset\n")); err != nil {
		return err
	}
	// A server calls Open before trying to lock. Keep the directories it opened.
	for _, name := range []string{itemsDir, blobsDir, depositsDir} {
		dir := filepath.Join(s.dir, name)
		entries, err := os.ReadDir(dir)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err := os.RemoveAll(filepath.Join(dir, entry.Name())); err != nil {
				return err
			}
		}
		if err := syncDir(dir); err != nil {
			return err
		}
	}
	for _, name := range []string{totpFile, recipientFile, identityFile} {
		if err := os.Remove(filepath.Join(s.dir, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	// Make the deletions durable before letting the server open the vault.
	if err := syncDir(s.dir); err != nil {
		return err
	}
	return remove(marker)
}
