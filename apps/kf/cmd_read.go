package main

import (
	"errors"
	"fmt"
	"io"
	"time"
)

// cmdRead prints the field a reference points to. run refuses a terminal
// stdout before calling it, as for get.
func cmdRead(c *client, args []string, stdout io.Writer) error {
	if len(args) != 1 {
		return errors.New("usage: kf read kf://<name>/<field>")
	}
	if _, _, err := parseRef(args[0]); err != nil {
		return err
	}
	_, entries, err := c.open()
	if err != nil {
		return err
	}
	defer c.logout()
	v, err := resolve(entries, args[0], time.Now())
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(stdout, v)
	return err
}
