package main

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"keyfold/internal/vault"
)

// A reference names one field of one item: kf://<name>/<field>. The field is
// what follows the last "/"; without one, the reference is the item's value.
// Fields: value (or password), username, note, url (the first one), totp (the
// current code), or the name of a custom field.
const refScheme = "kf://"

func parseRef(ref string) (name, field string, err error) {
	rest, ok := strings.CutPrefix(ref, refScheme)
	if !ok || rest == "" {
		return "", "", fmt.Errorf("%q is not a kf://name/field reference", ref)
	}
	if i := strings.LastIndex(rest, "/"); i >= 0 {
		return rest[:i], rest[i+1:], nil
	}
	return rest, "value", nil
}

// resolve returns the value a reference points to.
func resolve(entries []entry, ref string, now time.Time) (string, error) {
	name, field, err := parseRef(ref)
	if err != nil {
		return "", err
	}
	e, ok := find(entries, name)
	if !ok {
		return "", fmt.Errorf("%s: no item named %q", ref, name)
	}
	it := e.item
	switch field {
	case "value", "password":
		return it.Value, nil
	case "username":
		return it.Username, nil
	case "note":
		return it.Note, nil
	case "url":
		if len(it.URLs) == 0 {
			return "", fmt.Errorf("%s: the item has no URL", ref)
		}
		return it.URLs[0], nil
	case "totp":
		if it.TOTP == "" {
			return "", fmt.Errorf("%s: the item has no TOTP secret", ref)
		}
		code, err := vault.TOTPCode(it.TOTP, now)
		if err != nil {
			return "", errors.New(ref + ": invalid TOTP secret")
		}
		return code, nil
	}
	for _, f := range it.Fields {
		if f.Name == field {
			return f.Value, nil
		}
	}
	return "", fmt.Errorf("%s: the item has no field %q", ref, field)
}
