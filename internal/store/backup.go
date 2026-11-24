package store

import (
	"archive/tar"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
)

// archiveName matches the files of a vault, the only entries a backup holds
// and the only ones a restore writes.
var archiveName = regexp.MustCompile(`^(version|recipient\.txt|identity\.age|totp\.json|(items|blobs)/[0-9a-f]{32}\.age)$`)

// Backup writes every file of the vault in dir to w, as a tar archive. It
// takes no lock and works next to a running server: a file is replaced by a
// rename, never written in place, so each one read here is whole. An item and
// an attachment written during the backup may be in it one without the other.
// The archive holds what dir holds: ciphertext, and the TOTP secret in clear.
func Backup(dir string, w io.Writer) error {
	if _, err := os.Stat(filepath.Join(dir, identityFile)); err != nil {
		return fmt.Errorf("no vault in %s", dir)
	}
	names := []string{versionFile, recipientFile, identityFile, totpFile}
	for _, sub := range []string{itemsDir, blobsDir} {
		files, err := filepath.Glob(filepath.Join(dir, sub, "*.age"))
		if err != nil {
			return err
		}
		for _, f := range files {
			if name := sub + "/" + filepath.Base(f); archiveName.MatchString(name) {
				names = append(names, name)
			}
		}
	}
	tw := tar.NewWriter(w)
	for _, name := range names {
		if err := addFile(tw, dir, name); err != nil {
			return err
		}
	}
	return tw.Close()
}

// addFile copies one file of dir into the archive. One that does not exist
// (no TOTP, or an item deleted since it was listed) is skipped.
func addFile(tw *tar.Writer, dir, name string) error {
	f, err := os.Open(filepath.Join(dir, filepath.FromSlash(name)))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o600, Size: info.Size(), ModTime: info.ModTime()}); err != nil {
		return err
	}
	_, err = io.Copy(tw, f)
	return err
}

// Restore recreates in dir the vault of a Backup archive. dir must be missing
// or empty: a restore never writes over a vault. The files go to a directory
// next to dir first, renamed to dir once complete, so a failed restore leaves
// nothing behind and can be run again.
func Restore(dir string, r io.Reader) error {
	if entries, err := os.ReadDir(dir); err == nil && len(entries) > 0 {
		return fmt.Errorf("%s is not empty: restore into a new directory", dir)
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	tmp, err := os.MkdirTemp(filepath.Dir(dir), filepath.Base(dir)+".restore-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp) // no-op after the rename
	for _, sub := range []string{itemsDir, blobsDir} {
		if err := os.Mkdir(filepath.Join(tmp, sub), 0o700); err != nil {
			return err
		}
	}
	tr := tar.NewReader(r)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("not a keyfold backup: %w", err)
		}
		if h.Typeflag != tar.TypeReg || !archiveName.MatchString(h.Name) {
			return fmt.Errorf("not a keyfold backup: unexpected entry %q", h.Name)
		}
		if err := writeAtomic(filepath.Join(tmp, filepath.FromSlash(h.Name)), tr); err != nil {
			return err
		}
	}
	if _, err := os.Stat(filepath.Join(tmp, identityFile)); err != nil {
		return errors.New("not a keyfold backup: no vault identity in it")
	}
	if _, err := Open(tmp); err != nil { // refuses a newer layout than this code reads
		return err
	}
	if err := os.Remove(dir); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Rename(tmp, dir); err != nil {
		return err
	}
	return syncDir(filepath.Dir(dir))
}
