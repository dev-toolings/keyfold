// Package store keeps the vault files on disk. It only handles ciphertext.
package store

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
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
	versionFile   = "version"
	lockFile      = ".lock"
	tmpPattern    = ".tmp-*"

	// Layout is the version of the data directory layout this code reads and
	// writes: the file names above. Items carry their own format version.
	Layout = 1
)

var idPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

// ValidID reports whether id is a valid item id (and so a safe file name).
func ValidID(id string) bool { return idPattern.MatchString(id) }

// ErrConflict is returned by Put when the item changed since the caller read it.
var ErrConflict = errors.New("item changed since it was read")

// Store is a vault data directory.
type Store struct {
	dir  string
	mu   sync.Mutex // makes Put's compare-and-write atomic
	lock *os.File   // held open by Lock for the life of the process
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

// Open creates the data directory layout if needed, and refuses a directory
// written by a newer layout than this code knows. A directory without a
// version file predates it and is layout 1: Lock writes the file.
func Open(dir string) (*Store, error) {
	for _, d := range []string{dir, filepath.Join(dir, itemsDir), filepath.Join(dir, blobsDir)} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			return nil, err
		}
		if err := os.Chmod(d, 0o700); err != nil {
			return nil, err
		}
	}
	path := filepath.Join(dir, versionFile)
	data, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err == nil {
		v, err := strconv.Atoi(strings.TrimSpace(string(data)))
		if err != nil {
			return nil, fmt.Errorf("%s does not hold a layout version", path)
		}
		if v > Layout {
			return nil, fmt.Errorf("%s has layout version %d, this keyfold-server reads up to %d: use a newer one", dir, v, Layout)
		}
	}
	return &Store{dir: dir}, nil
}

// ErrInUse is returned by Lock when another process serves the directory.
var ErrInUse = errors.New("the data directory is in use by another keyfold-server")

// Lock makes this process the only writer of the directory, until it exits:
// two servers on one directory would each accept a write that overwrites the
// other's. It then removes the temp files a killed writer left behind and
// writes the layout version if it is missing: both are only safe once no other
// writer can be in the middle of a write.
func (s *Store) Lock() error {
	f, err := os.OpenFile(filepath.Join(s.dir, lockFile), os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return err
	}
	if err := unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		f.Close()
		if errors.Is(err, unix.EWOULDBLOCK) {
			return ErrInUse
		}
		return err
	}
	s.lock = f
	for _, d := range []string{s.dir, filepath.Join(s.dir, itemsDir), filepath.Join(s.dir, blobsDir)} {
		left, err := filepath.Glob(filepath.Join(d, tmpPattern))
		if err != nil {
			return err
		}
		for _, tmp := range left {
			if err := os.Remove(tmp); err != nil {
				return err
			}
		}
	}
	path := filepath.Join(s.dir, versionFile)
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return writeAtomic(path, strings.NewReader(strconv.Itoa(Layout)+"\n"))
	}
	return nil
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
	if err := writeAtomic(filepath.Join(s.dir, recipientFile), strings.NewReader(recipient+"\n")); err != nil {
		return err
	}
	return writeAtomic(filepath.Join(s.dir, identityFile), bytes.NewReader(identity))
}

// SetIdentity replaces the encrypted identity, after a master password change.
// The recipient does not change: it is the same identity, wrapped anew.
func (s *Store) SetIdentity(identity []byte) error {
	return writeAtomic(filepath.Join(s.dir, identityFile), bytes.NewReader(identity))
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
	return writeAtomic(filepath.Join(s.dir, totpFile), bytes.NewReader(data))
}

// ClearTOTP removes the second factor. Removing a missing one is not an error.
func (s *Store) ClearTOTP() error {
	err := remove(filepath.Join(s.dir, totpFile))
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
	return writeAtomic(s.itemPath(id), bytes.NewReader(ciphertext))
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
	return remove(s.itemPath(id))
}

// PutBlob streams an encrypted attachment to disk. id must be valid. Nothing
// is stored if r fails before its end.
func (s *Store) PutBlob(id string, r io.Reader) error {
	if !ValidID(id) {
		return errors.New("invalid blob id")
	}
	return writeAtomic(s.blobPath(id), r)
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
	return remove(s.blobPath(id))
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

// writeAtomic streams r to a 0600 temp file in the target directory, renames
// it over path, then flushes the directory. Nothing is stored if r fails
// before its end.
func writeAtomic(path string, r io.Reader) error {
	f, err := os.CreateTemp(filepath.Dir(path), tmpPattern)
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp) // no-op after a successful rename
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
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	return syncDir(filepath.Dir(path))
}

// syncDir flushes a directory: without it, a file renamed or removed there can
// be back in its former state after a power loss, although the caller was told
// the change was done. Its error says the change is made and not flushed, so
// that nobody takes it for a change that did not happen.
func syncDir(dir string) error {
	d, err := os.Open(dir)
	if err == nil {
		err = d.Sync()
		d.Close()
	}
	if err != nil {
		return fmt.Errorf("the change in %s is made but not flushed to disk: %w", dir, err)
	}
	return nil
}

// remove deletes a file and flushes its directory.
func remove(path string) error {
	if err := os.Remove(path); err != nil {
		return err
	}
	return syncDir(filepath.Dir(path))
}
