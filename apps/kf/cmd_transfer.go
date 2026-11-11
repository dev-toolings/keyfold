package main

import (
	"bytes"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"slices"
	"strings"
	"time"

	"filippo.io/age"
	"golang.org/x/term"

	"keyfold/internal/transfer"
	"keyfold/internal/vault"
)

const ageMagic = "age-encryption.org/v1\n"

// cmdExport writes every item, decrypted, in a format another manager reads.
// It must be told -encrypt (age with a passphrase) or -plaintext, and never
// writes to a terminal.
func cmdExport(c *client, args []string, stdin, stdout *os.File, stderr io.Writer) error {
	fs := flag.NewFlagSet("export", flag.ContinueOnError)
	fs.SetOutput(stderr)
	format := fs.String("format", "keyfold", "keyfold or bitwarden-json")
	out := fs.String("o", "", "output file, created 0600 (default: stdout)")
	encrypt := fs.Bool("encrypt", false, "encrypt the export with a passphrase (asked on the terminal)")
	plaintext := fs.Bool("plaintext", false, "write the secrets in clear")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 || *encrypt == *plaintext {
		return errors.New("usage: kf export [-format keyfold|bitwarden-json] [-o file] (-encrypt | -plaintext)")
	}
	if *out == "" && term.IsTerminal(int(stdout.Fd())) {
		return errors.New("refusing to write an export to a terminal; use -o or redirect stdout")
	}
	var r age.Recipient
	if *encrypt {
		pw, err := readPassword(stdin, stderr, "Export passphrase: ")
		if err != nil {
			return err
		}
		if err := vault.CheckMasterPassword(pw); err != nil {
			return errors.New(strings.Replace(err.Error(), "master password", "export passphrase", 1))
		}
		if again, err := readPassword(stdin, stderr, "Repeat passphrase: "); err != nil || again != pw {
			return errors.New("passphrases do not match")
		}
		sr, err := age.NewScryptRecipient(pw)
		if err != nil {
			return err
		}
		sr.SetWorkFactor(vault.ScryptWorkFactor)
		r = sr
	}
	_, entries, err := c.open()
	if err != nil {
		return err
	}
	defer c.logout()
	items := make([]vault.Item, 0, len(entries))
	attached := 0
	for _, e := range entries {
		it, _ := vault.Upgrade(e.item)
		items = append(items, it)
		attached += len(it.Attachments)
	}
	if attached > 0 {
		fmt.Fprintf(stderr, "warning: %d attachment(s) are not exported; download them from the web UI\n", attached)
	}
	slices.SortFunc(items, func(a, b vault.Item) int { return strings.Compare(a.Name, b.Name) })
	data, err := transfer.Export(*format, items)
	if err != nil {
		return err
	}
	if r != nil {
		if data, err = vault.Encrypt(data, r); err != nil {
			return err
		}
	}
	if *out == "" {
		_, err = stdout.Write(data)
	} else {
		err = writePrivate(*out, data)
	}
	if err == nil {
		fmt.Fprintf(stderr, "%d item(s) exported\n", len(items))
	}
	return err
}

// cmdImport adds the items of an export file. An item whose name and value
// are already in the vault is skipped; another name clash gets a " (2)" suffix.
// An age file (from `export -encrypt`) asks for its passphrase.
func cmdImport(c *client, args []string, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("import", flag.ContinueOnError)
	fs.SetOutput(stderr)
	format := fs.String("format", "", strings.Join(transfer.Formats, ", "))
	file, err := nameArg(fs, args)
	if err != nil || *format == "" {
		return errors.New("usage: kf import -format " + strings.Join(transfer.Formats, "|") + " <file>")
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	if bytes.HasPrefix(data, []byte(ageMagic)) {
		pw, err := readPassword(os.Stdin, stderr, "Export passphrase: ")
		if err != nil {
			return err
		}
		sid, err := age.NewScryptIdentity(pw)
		if err != nil {
			return err
		}
		if data, err = vault.Decrypt(data, sid); err != nil {
			return errors.New("wrong passphrase or damaged export")
		}
	}
	items, skipped, err := transfer.Import(*format, data, time.Now())
	if err != nil {
		return err
	}
	id, entries, err := c.open()
	if err != nil {
		return err
	}
	defer c.logout()
	values := map[string]string{} // name -> sameness key, of the vault and of the items added so far
	for _, e := range entries {
		values[e.item.Name] = sameness(e.item)
	}
	added, dups := 0, 0
	for _, it := range items {
		// Walk "name", "name (2)"...: the same value under one of them means
		// this item was imported already.
		name, dup := it.Name, false
		for n := 2; ; n++ {
			v, ok := values[name]
			if !ok {
				break
			}
			if v == sameness(it) {
				dup = true
				break
			}
			name = fmt.Sprintf("%s (%d)", it.Name, n)
		}
		if dup {
			dups++
			continue
		}
		it.Name = name
		if err := c.put(newEntry(), it, id.Recipient()); err != nil {
			return fmt.Errorf("%s: %w (%d item(s) imported before)", it.Name, err, added)
		}
		values[it.Name] = sameness(it)
		added++
	}
	for _, name := range skipped {
		fmt.Fprintf(stdout, "skipped\t%s\n", name)
	}
	fmt.Fprintf(stderr, "%d item(s) imported, %d already present, %d of an unsupported type (payment cards...)\n", added, dups, len(skipped))
	return nil
}

// sameness tells two copies of one item apart from two items sharing a name.
func sameness(it vault.Item) string {
	key := it.Value + "\x00" + it.Username + "\x00" + it.Note
	if it.SSHKey != nil {
		key += "\x00" + it.SSHKey.Private
	}
	return key
}
