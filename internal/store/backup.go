package store

import (
	"archive/tar"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

// endEntry closes an archive: it holds the number of files before it. An
// archive cut short has no such entry, or the wrong count.
const endEntry = "complete"

// archiveName matches the files of a vault, the only entries a backup holds
// and the only ones a restore writes.
var archiveName = regexp.MustCompile(`^(version|recipient\.txt|identity\.age|totp\.json|(items|blobs)/[0-9a-f]{32}\.age)$`)

// Backup writes every file of the vault in dir to w, as a tar archive. It
// takes no lock and works next to a running server: a file is replaced by a
// rename, never written in place, so each one read here is whole.
//
// Attachments are listed after the items are copied. A client uploads an
// attachment before the item that names it, so every attachment an archived
// item names was on disk by then. Only one removed during the backup can be
// missing: stop the server for a snapshot of one instant.
//
// The archive holds what dir holds: ciphertext, and the TOTP secret in clear.
func Backup(dir string, w io.Writer) error {
	if _, err := os.Stat(filepath.Join(dir, identityFile)); err != nil {
		return fmt.Errorf("no vault in %s", dir)
	}
	tw := tar.NewWriter(w)
	files := 0
	add := func(names ...string) error {
		for _, name := range names {
			added, err := addFile(tw, dir, name)
			if err != nil {
				return err
			}
			if added {
				files++
			}
		}
		return nil
	}
	if err := add(versionFile, recipientFile, identityFile, totpFile); err != nil {
		return err
	}
	for _, sub := range []string{itemsDir, blobsDir} {
		found, err := filepath.Glob(filepath.Join(dir, sub, "*.age"))
		if err != nil {
			return err
		}
		for _, f := range found {
			if name := sub + "/" + filepath.Base(f); archiveName.MatchString(name) {
				if err := add(name); err != nil {
					return err
				}
			}
		}
	}
	count := strconv.Itoa(files)
	if err := tw.WriteHeader(&tar.Header{Name: endEntry, Mode: 0o600, Size: int64(len(count))}); err != nil {
		return err
	}
	if _, err := io.WriteString(tw, count); err != nil {
		return err
	}
	return tw.Close()
}

// addFile copies one file of dir into the archive and reports whether it did.
// One that does not exist (no TOTP, or an item deleted since it was listed) is
// skipped. A link is refused: the archive would carry the file it points to.
func addFile(tw *tar.Writer, dir, name string) (bool, error) {
	f, err := os.OpenFile(filepath.Join(dir, filepath.FromSlash(name)), os.O_RDONLY|unix.O_NOFOLLOW, 0)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("%s: %w", name, err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return false, err
	}
	if !info.Mode().IsRegular() {
		return false, fmt.Errorf("%s is not a regular file", name)
	}
	if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o600, Size: info.Size(), ModTime: info.ModTime()}); err != nil {
		return false, err
	}
	_, err = io.Copy(tw, f)
	return err == nil, err
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
	files, complete := 0, false
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("not a whole keyfold backup: %w", err)
		}
		if complete || h.Typeflag != tar.TypeReg || (h.Name != endEntry && !archiveName.MatchString(h.Name)) {
			return fmt.Errorf("not a keyfold backup: unexpected entry %q", h.Name)
		}
		if h.Name == endEntry {
			count, err := io.ReadAll(io.LimitReader(tr, 32))
			if err != nil || strings.TrimSpace(string(count)) != strconv.Itoa(files) {
				return fmt.Errorf("not a whole keyfold backup: it announces %q files and holds %d", count, files)
			}
			complete = true
			continue
		}
		if err := writeAtomic(filepath.Join(tmp, filepath.FromSlash(h.Name)), tr); err != nil {
			return err
		}
		files++
	}
	if !complete {
		return errors.New("not a whole keyfold backup: it stops before its end")
	}
	if _, err := os.Stat(filepath.Join(tmp, identityFile)); err != nil {
		return errors.New("not a keyfold backup: no vault identity in it")
	}
	if _, err := Open(tmp); err != nil { // refuses a newer layout than this code reads
		return err
	}
	// rename replaces a missing or an empty directory, and nothing else: a
	// file or a vault that appeared at dir meanwhile makes it fail.
	if err := os.Rename(tmp, dir); err != nil {
		return fmt.Errorf("%s changed during the restore: %w", dir, err)
	}
	return syncDir(filepath.Dir(dir))
}
