package store

import (
	"bytes"
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// Deposits are items an agent submits with a deposit key, without unlocking
// the vault: ciphertext for the vault recipient, kept apart from the items
// until the owner's client accepts them. A deposit key can also read the
// catalog the owner's client leaves for it: item names, never values.
//
// Layout, in depositsDir: keys.json, <key id>.<deposit id>.age and
// <key id>.catalog.age.
const (
	depositsDir     = "deposits"
	depositKeysFile = "keys.json"
	catalogName     = "catalog"

	// MaxDepositKeys bounds the keys an owner can create.
	MaxDepositKeys = 20
	// MaxDepositsPerKey bounds the deposits waiting under one key.
	MaxDepositsPerKey = 500
)

// ErrDepositQuota means the key already has MaxDepositsPerKey deposits waiting.
var ErrDepositQuota = errors.New("too many deposits wait for review under this key")

// ErrNoDepositKey means the key was revoked, possibly while its request ran.
var ErrNoDepositKey = errors.New("no such deposit key")

// ErrDepositKeyQuota means the owner already has MaxDepositKeys keys.
var ErrDepositKeyQuota = errors.New("too many deposit keys")

// DepositKey is a deposit key as the server keeps it: the SHA-256 of its
// token, never the token, and the age recipient its catalog is encrypted to.
type DepositKey struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	TokenHash string    `json:"tokenHash"`
	Recipient string    `json:"recipient"`
	Created   time.Time `json:"created"`
}

// Deposit is one submission waiting for review.
type Deposit struct {
	KeyID      string
	ID         string
	Ciphertext []byte
	Created    time.Time
}

func (s *Store) depositPath(name string) string {
	return filepath.Join(s.dir, depositsDir, name)
}

// DepositKeys returns the deposit keys, oldest first.
func (s *Store) DepositKeys() ([]DepositKey, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.depositKeys()
}

func (s *Store) depositKeys() ([]DepositKey, error) {
	data, err := os.ReadFile(s.depositPath(depositKeysFile))
	if errors.Is(err, os.ErrNotExist) {
		return []DepositKey{}, nil
	}
	if err != nil {
		return nil, err
	}
	var keys []DepositKey
	if err := json.Unmarshal(data, &keys); err != nil {
		return nil, fmt.Errorf("%s: %w", depositKeysFile, err)
	}
	return keys, nil
}

func (s *Store) writeDepositKeys(keys []DepositKey) error {
	data, err := json.Marshal(keys)
	if err != nil {
		return err
	}
	return writeAtomic(s.depositPath(depositKeysFile), bytes.NewReader(data))
}

// AddDepositKey stores a new key. k.ID must be valid and unused.
func (s *Store) AddDepositKey(k DepositKey) error {
	if !ValidID(k.ID) {
		return errors.New("invalid deposit key id")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	keys, err := s.depositKeys()
	if err != nil {
		return err
	}
	if len(keys) >= MaxDepositKeys {
		return ErrDepositKeyQuota
	}
	if slices.ContainsFunc(keys, func(o DepositKey) bool { return o.ID == k.ID }) {
		return errors.New("deposit key id already used")
	}
	return s.writeDepositKeys(append(keys, k))
}

// RemoveDepositKey revokes a key and deletes its deposits and catalog. The key
// goes first: a retry after a failure finishes the cleanup, and no request
// authenticates with it in between.
func (s *Store) RemoveDepositKey(id string) error {
	if !ValidID(id) {
		return errors.New("invalid deposit key id")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	keys, err := s.depositKeys()
	if err != nil {
		return err
	}
	kept := slices.DeleteFunc(slices.Clone(keys), func(k DepositKey) bool { return k.ID == id })
	if len(kept) != len(keys) {
		if err := s.writeDepositKeys(kept); err != nil {
			return err
		}
	}
	files, err := filepath.Glob(s.depositPath(id + ".*.age"))
	if err != nil {
		return err
	}
	for _, f := range files {
		if err := os.Remove(f); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return syncDir(filepath.Join(s.dir, depositsDir))
}

// PutDeposit stores a deposit under keyID. It never overwrites: a deposit id
// already stored reports false and keeps the first one, so a client can retry
// with the same id without creating a copy.
func (s *Store) PutDeposit(keyID, id string, ciphertext []byte) (bool, error) {
	if !ValidID(keyID) || !ValidID(id) {
		return false, errors.New("invalid deposit id")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Checked under the lock RemoveDepositKey takes: a request authenticated
	// just before a revocation cannot write after it.
	keys, err := s.depositKeys()
	if err != nil {
		return false, err
	}
	if !slices.ContainsFunc(keys, func(k DepositKey) bool { return k.ID == keyID }) {
		return false, ErrNoDepositKey
	}
	path := s.depositPath(keyID + "." + id + ".age")
	if _, err := os.Lstat(path); err == nil {
		return false, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return false, err
	}
	waiting, err := filepath.Glob(s.depositPath(keyID + ".*.age"))
	if err != nil {
		return false, err
	}
	if n := len(waiting) - countCatalog(waiting); n >= MaxDepositsPerKey {
		return false, ErrDepositQuota
	}
	if err := writeAtomic(path, bytes.NewReader(ciphertext)); err != nil {
		return false, err
	}
	return true, nil
}

func countCatalog(files []string) int {
	n := 0
	for _, f := range files {
		if strings.HasSuffix(f, "."+catalogName+".age") {
			n++
		}
	}
	return n
}

// Deposits returns every deposit waiting for review, oldest first, then by
// key and id: two clients that move them at once take them in the same order.
func (s *Store) Deposits() ([]Deposit, error) {
	files, err := filepath.Glob(s.depositPath("*.*.age"))
	if err != nil {
		return nil, err
	}
	out := []Deposit{}
	for _, f := range files {
		keyID, id, ok := strings.Cut(strings.TrimSuffix(filepath.Base(f), ".age"), ".")
		if !ok || !ValidID(keyID) || !ValidID(id) {
			continue // the catalogs
		}
		info, err := os.Stat(f)
		if errors.Is(err, os.ErrNotExist) {
			continue // accepted or rejected since the listing
		}
		if err != nil {
			return nil, err
		}
		data, err := os.ReadFile(f)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		out = append(out, Deposit{KeyID: keyID, ID: id, Ciphertext: data, Created: info.ModTime().UTC()})
	}
	slices.SortFunc(out, func(a, b Deposit) int {
		return cmp.Or(a.Created.Compare(b.Created), strings.Compare(a.KeyID, b.KeyID), strings.Compare(a.ID, b.ID))
	})
	return out, nil
}

// DeleteDeposit removes a deposit. A missing one is not an error: accepting a
// deposit twice, after a failure, must not fail.
func (s *Store) DeleteDeposit(keyID, id string) error {
	if !ValidID(keyID) || !ValidID(id) {
		return errors.New("invalid deposit id")
	}
	err := remove(s.depositPath(keyID + "." + id + ".age"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// PutCatalog replaces the catalog of a key that exists.
func (s *Store) PutCatalog(keyID string, ciphertext []byte) error {
	if !ValidID(keyID) {
		return errors.New("invalid deposit key id")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	keys, err := s.depositKeys()
	if err != nil {
		return err
	}
	if !slices.ContainsFunc(keys, func(k DepositKey) bool { return k.ID == keyID }) {
		return ErrNoDepositKey
	}
	return writeAtomic(s.depositPath(keyID+"."+catalogName+".age"), bytes.NewReader(ciphertext))
}

// Catalog returns the catalog of a key and when it was written. A key whose
// owner has not opened the vault since its creation has none: os.ErrNotExist.
func (s *Store) Catalog(keyID string) ([]byte, time.Time, error) {
	if !ValidID(keyID) {
		return nil, time.Time{}, errors.New("invalid deposit key id")
	}
	path := s.depositPath(keyID + "." + catalogName + ".age")
	info, err := os.Stat(path)
	if err != nil {
		return nil, time.Time{}, err
	}
	data, err := os.ReadFile(path)
	return data, info.ModTime().UTC(), err
}
