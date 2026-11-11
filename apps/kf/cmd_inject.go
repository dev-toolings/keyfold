package main

import (
	"errors"
	"flag"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"golang.org/x/term"
)

// placeholder matches {{ kf://name/field }} in a template.
// A name may hold spaces ("site (2)"), not "}".
var placeholder = regexp.MustCompile(`\{\{\s*(kf://[^}]+?)\s*\}\}`)

// cmdInject fills a template's placeholders. The output file is created 0600;
// without -o the result goes to stdout, refused on a terminal.
func cmdInject(c *client, args []string, stdout *os.File, stderr io.Writer) error {
	fs := flag.NewFlagSet("inject", flag.ContinueOnError)
	fs.SetOutput(stderr)
	in := fs.String("i", "", "template file")
	out := fs.String("o", "", "output file (default: stdout)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *in == "" || fs.NArg() != 0 {
		return errors.New("usage: kf inject -i template [-o output]")
	}
	if *out == "" && term.IsTerminal(int(stdout.Fd())) {
		return errors.New("refusing to print secrets to a terminal; use -o or redirect stdout")
	}
	tpl, err := os.ReadFile(*in)
	if err != nil {
		return err
	}
	_, entries, err := c.open()
	if err != nil {
		return err
	}
	defer c.logout()
	now := time.Now()
	var firstErr error
	result := placeholder.ReplaceAllFunc(tpl, func(m []byte) []byte {
		v, err := resolve(entries, string(placeholder.FindSubmatch(m)[1]), now)
		if err != nil && firstErr == nil {
			firstErr = err
		}
		return []byte(v)
	})
	if firstErr != nil {
		return firstErr // nothing is written
	}
	if *out == "" {
		_, err = stdout.Write(result)
		return err
	}
	return writePrivate(*out, result)
}

// writePrivate writes data to a 0600 temp file next to path, then renames it
// over path: no reader ever sees a partial file or wider permissions.
func writePrivate(path string, data []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".kf-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name()) // no-op after the rename
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}
