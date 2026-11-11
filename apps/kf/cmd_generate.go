package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"time"

	"keyfold/internal/vault"
)

// cmdGenerate prints a new random password, or a passphrase with -words. It
// is stored nowhere: pipe it into `kf set`.
func cmdGenerate(args []string, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("generate", flag.ContinueOnError)
	fs.SetOutput(stderr)
	length := fs.Int("len", 24, "number of characters")
	symbols := fs.Bool("symbols", true, "add symbols to letters and digits (-symbols=false for none)")
	words := fs.Int("words", 0, "make a passphrase of this many EFF words instead")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("usage: kf generate [-len N] [-symbols=false] [-words N]")
	}
	if *words > 0 {
		if *words < 4 || *words > 20 {
			return errors.New("-words must be between 4 and 20")
		}
		_, err := fmt.Fprintln(stdout, vault.Passphrase(*words))
		return err
	}
	if *length < 12 || *length > 256 {
		return errors.New("-len must be between 12 and 256")
	}
	_, err := fmt.Fprintln(stdout, vault.Password(*length, *symbols))
	return err
}

// cmdTOTP prints the current TOTP code of an item.
func cmdTOTP(c *client, args []string, stdout io.Writer) error {
	if len(args) != 1 {
		return errors.New("usage: kf totp <name>")
	}
	_, entries, err := c.open()
	if err != nil {
		return err
	}
	defer c.logout()
	code, err := resolve(entries, refScheme+args[0]+"/totp", time.Now())
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(stdout, code)
	return err
}
