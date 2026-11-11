// Package store keeps the vault files on disk. It only handles ciphertext.
package store

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"golang.org/x/sys/unix"
)

const (
	identityFile  = "identity.age"
	recipientFile = "recipient.txt"
	totpFile      = "totp.json"
	itemsDir      = "items"
	blobsDir      = "blobs"
)

var idPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

// ValidID reports whether id is a valid item id (and so a safe file name).
func ValidID(id string) bool { return idPattern.MatchString(id) }

// ErrConflict is returned by Put when the item changed since the caller read it.
var ErrConflict = errors.New("item changed since it was read")

// Store is a vault data directory.
type Store struct {
	dir string
	mu  sync.Mutex // makes Put's compare-and-write atomic
}

// Entry is one encrypted item. ETag identifies this version of the ciphertext.
type Entry struct {
	ID         string `json:"id"`
	Ciphertext []byte `json:"ciphertext"`
	ETag       string `json:"etag"`
}

// ETag returns the version tag of a ciphertext: its SHA-256, in hex.
func ETag(ciphertext []byte) string {
	sum := sha256.Sum256(ciphertext)
	return hex.EncodeToString(sum[:])
}

// Open creates the data directory layout if needed.
func Open(dir string) (*Store, error) {
	for _, d := range []string{dir, filepath.Join(dir, itemsDir), filepath.Join(dir, blobsDir)} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			return nil, err
		}
		if err := os.Chmod(d, 0o700); err != nil {
			return nil, err
		}
	}
	return &Store{dir: dir}, nil
}

// Initialized reports whether the identity file exists. It is written last
// by Init, so its presence means the vault is complete.
func (s *Store) Initialized() bool {
	_, err := os.Stat(filepath.Join(s.dir, identityFile))
	return err == nil
}

// Init stores the encrypted identity and its recipient. The caller makes
// sure the vault is not initialized yet.
func (s *Store) Init(identity []byte, recipient string) error {
	if err := writeAtomic(filepath.Join(s.dir, recipientFile), []byte(recipient+"\n")); err != nil {
		return err
	}
	return writeAtomic(filepath.Join(s.dir, identityFile), identity)
}

// SetIdentity replaces the encrypted identity, after a master password change.
// The recipient does not change: it is the same identity, wrapped anew.
func (s *Store) SetIdentity(identity []byte) error {
	return writeAtomic(filepath.Join(s.dir, identityFile), identity)
}

// TOTP is the second factor state. The secret is stored in clear: the server
// must read it alone to check a code. Pending means set up, not yet confirmed.
type TOTP struct {
	Secret  string `json:"secret"`
	Enabled bool   `json:"enabled"`
}

// TOTP returns the second factor state; the zero value when none is set.
func (s *Store) TOTP() (TOTP, error) {
	var t TOTP
	data, err := os.ReadFile(filepath.Join(s.dir, totpFile))
	if errors.Is(err, os.ErrNotExist) {
		return t, nil
	}
	if err != nil {
		return t, err
	}
	return t, json.Unmarshal(data, &t)
}

// SetTOTP stores the second factor state.
func (s *Store) SetTOTP(t TOTP) error {
	data, err := json.Marshal(t)
	if err != nil {
		return err
	}
	return writeAtomic(filepath.Join(s.dir, totpFile), data)
}

// ClearTOTP removes the second factor. Removing a missing one is not an error.
func (s *Store) ClearTOTP() error {
	err := os.Remove(filepath.Join(s.dir, totpFile))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// Identity returns the encrypted identity and the recipient.
func (s *Store) Identity() ([]byte, string, error) {
	id, err := os.ReadFile(filepath.Join(s.dir, identityFile))
	if err != nil {
		return nil, "", err
	}
	rcpt, err := os.ReadFile(filepath.Join(s.dir, recipientFile))
	if err != nil {
		return nil, "", err
	}
	return id, strings.TrimSpace(string(rcpt)), nil
}

// Items returns every encrypted item.
func (s *Store) Items() ([]Entry, error) {
	names, err := filepath.Glob(filepath.Join(s.dir, itemsDir, "*.age"))
	if err != nil {
		return nil, err
	}
	entries := []Entry{}
	for _, name := range names {
		id := strings.TrimSuffix(filepath.Base(name), ".age")
		if !ValidID(id) {
			continue
		}
		data, err := os.ReadFile(name)
		if err != nil {
			return nil, err
		}
		entries = append(entries, Entry{ID: id, Ciphertext: data, ETag: ETag(data)})
	}
	return entries, nil
}

// Put writes an item. id must be valid. A non-empty ifMatch must be the ETag
// of the stored item, or Put returns ErrConflict and writes nothing.
func (s *Store) Put(id string, ciphertext []byte, ifMatch string) error {
	if !ValidID(id) {
		return errors.New("invalid item id")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if ifMatch != "" {
		current, err := os.ReadFile(s.itemPath(id))
		if errors.Is(err, os.ErrNotExist) {
			return ErrConflict
		}
		if err != nil {
			return err
		}
		if ETag(current) != ifMatch {
			return ErrConflict
		}
	}
	return writeAtomic(s.itemPath(id), ciphertext)
}

// Delete removes an item. id must be valid. Deleting a missing item returns
// an error matching os.ErrNotExist. A non-empty ifMatch must be the ETag of
// the stored item, or Delete returns ErrConflict and removes nothing.
func (s *Store) Delete(id, ifMatch string) error {
	if !ValidID(id) {
		return errors.New("invalid item id")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if ifMatch != "" {
		current, err := os.ReadFile(s.itemPath(id))
		if err != nil {
			return err
		}
		if ETag(current) != ifMatch {
			return ErrConflict
		}
	}
	return os.Remove(s.itemPath(id))
}

// PutBlob streams an encrypted attachment to disk. id must be valid. Nothing
// is stored if r fails before its end.
func (s *Store) PutBlob(id string, r io.Reader) error {
	if !ValidID(id) {
		return errors.New("invalid blob id")
	}
	f, err := os.CreateTemp(filepath.Join(s.dir, blobsDir), ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name()) // no-op after a successful rename
	if _, err := io.Copy(f, r); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), s.blobPath(id))
}

// Blob opens an encrypted attachment. A missing one returns an error matching
// os.ErrNotExist.
func (s *Store) Blob(id string) (*os.File, error) {
	if !ValidID(id) {
		return nil, errors.New("invalid blob id")
	}
	return os.Open(s.blobPath(id))
}

// DeleteBlob removes an attachment. A missing one returns an error matching
// os.ErrNotExist.
func (s *Store) DeleteBlob(id string) error {
	if !ValidID(id) {
		return errors.New("invalid blob id")
	}
	return os.Remove(s.blobPath(id))
}

// Usage counts the stored items and attachments, and the free space left on
// the data directory's file system.
type Usage struct {
	Items     int    `json:"items"`
	Blobs     int    `json:"blobs"`
	BlobBytes int64  `json:"blob_bytes"`
	FreeBytes uint64 `json:"free_bytes"`
}

func (s *Store) Usage() (Usage, error) {
	var u Usage
	items, err := filepath.Glob(filepath.Join(s.dir, itemsDir, "*.age"))
	if err != nil {
		return u, err
	}
	u.Items = len(items)
	blobs, err := filepath.Glob(filepath.Join(s.dir, blobsDir, "*.age"))
	if err != nil {
		return u, err
	}
	for _, b := range blobs {
		info, err := os.Stat(b)
		if err != nil {
			return u, err
		}
		u.Blobs++
		u.BlobBytes += info.Size()
	}
	var fs unix.Statfs_t
	if err := unix.Statfs(s.dir, &fs); err != nil {
		return u, err
	}
	u.FreeBytes = fs.Bavail * uint64(fs.Bsize)
	return u, nil
}

func (s *Store) blobPath(id string) string {
	return filepath.Join(s.dir, blobsDir, id+".age")
}

func (s *Store) itemPath(id string) string {
	return filepath.Join(s.dir, itemsDir, id+".age")
}

// writeAtomic writes data to a 0600 temp file in the target directory, then
// renames it over path.
func writeAtomic(path string, data []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp) // no-op after a successful rename
	if err := f.Chmod(0o600); err != nil {
		f.Close()
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
