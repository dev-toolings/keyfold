package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"keyfold/internal/vault"
)

// importEnv copies variables of a remote env file into the vault. The agent
// names a source and keys; kf reads the file over ssh and encrypts the values
// itself, so no value passes through the model. A source is an alias the user
// declared in sources.json: the model cannot point kf at a host or a file.

// importSource is one entry of sources.json.
type importSource struct {
	Host        string `json:"host"`           // ssh destination, an alias of ~/.ssh/config works
	Path        string `json:"path"`           // absolute path of the env file on that host
	Sudo        bool   `json:"sudo,omitempty"` // read it with sudo -n (a root-owned 0600 file)
	Project     string `json:"project,omitempty"`
	Environment string `json:"environment,omitempty"`
}

type importInput struct {
	Source string   `json:"source" jsonschema:"alias of a source declared by the user in ~/.config/keyfold/sources.json"`
	Keys   []string `json:"keys,omitempty" jsonschema:"variable names to import; empty imports every variable of the file"`
}

type importedKey struct {
	Key  string `json:"key"`
	Item string `json:"item"`
	// Status: imported, unchanged (same value already stored), conflict (the
	// item exists with another value and was left alone), missing (absent or
	// empty in the file).
	Status string `json:"status"`
}

type importOutput struct {
	Source string        `json:"source"`
	Keys   []importedKey `json:"keys"`
}

// sourcesPath is where the user declares the sources kf.importEnv may read.
func sourcesPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "keyfold", "sources.json"), nil
}

// loadSource returns the source declared under alias. A file others can write
// is refused: whoever writes it chooses which files kf reads.
func loadSource(alias string) (importSource, error) {
	path, err := sourcesPath()
	if err != nil {
		return importSource{}, err
	}
	fi, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return importSource{}, fmt.Errorf(`no sources file: the user declares sources in %s, as {"<alias>": {"host": "...", "path": "/abs/.env", "sudo": true}}`, path)
	}
	if err != nil {
		return importSource{}, err
	}
	if fi.Mode().Perm()&0o022 != 0 {
		return importSource{}, fmt.Errorf("%s is writable by group or others (mode %o): chmod 600 it", path, fi.Mode().Perm())
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return importSource{}, err
	}
	var sources map[string]importSource
	if err := json.Unmarshal(data, &sources); err != nil {
		return importSource{}, fmt.Errorf("%s: %w", path, err)
	}
	src, ok := sources[alias]
	if !ok {
		return importSource{}, fmt.Errorf("unknown source %q: declared sources are in %s", alias, path)
	}
	if src.Host == "" || !filepath.IsAbs(src.Path) {
		return importSource{}, fmt.Errorf("source %q in %s needs a host and an absolute path", alias, path)
	}
	if err := vault.CheckEnvironment(src.Environment); err != nil {
		return importSource{}, fmt.Errorf("source %q in %s: %w", alias, path, err)
	}
	return src, nil
}

// readSource returns the env file of src, read over ssh. BatchMode and no
// stdin: a password prompt would read the MCP stream.
func readSource(ctx context.Context, src importSource) ([]byte, error) {
	remote := "cat -- '" + strings.ReplaceAll(src.Path, "'", `'\''`) + "'"
	if src.Sudo {
		remote = "sudo -n " + remote
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, "ssh", "-o", "BatchMode=yes", "--", src.Host, remote)
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		// stderr is not returned: a login script on the host may print anything.
		// Only known ssh, sudo and cat failures are named.
		reason := "run `ssh " + src.Host + " true` yourself to see why"
		for _, known := range sshFailures {
			if strings.Contains(stderr.String(), known) {
				reason = known
				break
			}
		}
		return nil, fmt.Errorf("ssh %s: %w: %s", src.Host, err, reason)
	}
	return out, nil
}

var sshFailures = []string{
	"Permission denied", "Host key verification failed", "Could not resolve hostname",
	"Connection refused", "Connection timed out", "No route to host",
	"a password is required", "No such file or directory", "Is a directory",
}

// envKey matches the start of a KEY=value line, up to the value.
var envKey = regexp.MustCompile(`^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*`)

// parseEnv reads an env file as dotenv and Compose write it: comments and
// other lines are skipped, a value in single quotes is literal but for \', one
// in double quotes knows \n \r \t \" \\ \$, both may span lines, and an unquoted value
// ends at a " #" comment. order lists each key once, as first seen. An
// unterminated quote ends the parse: what follows it is part of a value, and
// a key read there could be a piece of a secret.
func parseEnv(data []byte) (order []string, values map[string]string) {
	values = map[string]string{}
	rest := string(data)
	for rest != "" {
		line, next, _ := strings.Cut(rest, "\n")
		m := envKey.FindStringSubmatchIndex(line)
		if m == nil {
			rest = next
			continue
		}
		key, raw := line[m[2]:m[3]], rest[m[1]:]
		var value string
		switch {
		case strings.HasPrefix(raw, "'"), strings.HasPrefix(raw, `"`):
			v, n, ok := unquote(raw[1:], raw[0])
			if !ok {
				return order, values
			}
			value, rest = v, afterLine(raw[1+n:])
		default:
			value = strings.TrimRight(line[m[1]:], "\r")
			if i := strings.Index(strings.ReplaceAll(value, "\t", " "), " #"); i >= 0 {
				value = value[:i]
			}
			value, rest = strings.TrimSpace(value), next
		}
		if _, seen := values[key]; !seen {
			order = append(order, key)
		}
		values[key] = value
	}
	return order, values
}

// afterLine returns what follows the end of the current line of s.
func afterLine(s string) string {
	_, next, _ := strings.Cut(s, "\n")
	return next
}

// unquote reads s up to its closing quote q and returns the value and the
// bytes read, the quote included. In single quotes only \' is an escape.
func unquote(s string, q byte) (string, int, bool) {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		switch c := s[i]; {
		case c == q:
			return b.String(), i + 1, true
		case c == '\\' && i+1 < len(s) && q == '\'':
			if s[i+1] == '\'' {
				i++
			}
			b.WriteByte(s[i])
		case c == '\\' && i+1 < len(s):
			i++
			switch e := s[i]; e {
			case 'n':
				b.WriteByte('\n')
			case 'r':
				b.WriteByte('\r')
			case 't':
				b.WriteByte('\t')
			case '"', '\\', '$':
				b.WriteByte(e)
			default:
				b.WriteByte('\\')
				b.WriteByte(e)
			}
		default:
			b.WriteByte(c)
		}
	}
	return "", 0, false
}

// sourceEnv is the env file of a declared source, read and parsed.
type sourceEnv struct {
	alias  string
	src    importSource
	keys   []string // the requested keys, or every key of the file
	values map[string]string
}

// readEnv reads the env file of the source in.Source.
func readEnv(ctx context.Context, in importInput) (sourceEnv, error) {
	src, err := loadSource(in.Source)
	if err != nil {
		return sourceEnv{}, err
	}
	data, err := readSource(ctx, src)
	if err != nil {
		return sourceEnv{}, err
	}
	order, values := parseEnv(data)
	keys := in.Keys
	if len(keys) == 0 {
		keys = order
	}
	return sourceEnv{alias: in.Source, src: src, keys: keys, values: values}, nil
}

// item is the token item a variable of the source becomes.
func (e sourceEnv) item(name, value, now string) vault.Item {
	return vault.Item{V: vault.ItemVersion, Name: name, Kind: "token", Value: value,
		Note:    "Imported from " + e.alias + " (" + e.src.Host + ":" + e.src.Path + ")",
		Project: e.src.Project, Environment: e.src.Environment, CreatedAt: now, UpdatedAt: now}
}

// importEnv stores each requested variable of the source as a token item
// named "<source>.<KEY>". It never overwrites an item: a different value is
// reported as a conflict. A rerun after a failure finishes the work.
func importEnv(ctx context.Context, base string, in importInput) (importOutput, error) {
	env, err := readEnv(ctx, in)
	if err != nil {
		return importOutput{}, err
	}

	c := &client{base: base, ctx: ctx}
	id, entries, err := c.open()
	if err != nil {
		return importOutput{}, err
	}
	defer c.logout()
	if err := c.whole(); err != nil { // a name may be the one of an item that cannot be read
		return importOutput{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	out := importOutput{Source: in.Source, Keys: []importedKey{}}
	added := 0
	for _, key := range env.keys {
		r := importedKey{Key: key, Item: in.Source + "." + key}
		value := env.values[key]
		existing, exists := find(entries, r.Item)
		switch {
		case value == "":
			r.Status = "missing"
		case exists && existing.item.Value == value:
			r.Status = "unchanged"
		case exists:
			r.Status = "conflict"
		default:
			e := newEntry()
			e.item = env.item(r.Item, value, now)
			if err := c.put(e, e.item, id.Recipient()); err != nil {
				return importOutput{}, fmt.Errorf("%s: %w (%d item(s) imported before)", r.Item, err, added)
			}
			entries = append(entries, e) // a key asked twice is then unchanged
			added++
			r.Status = "imported"
		}
		out.Keys = append(out.Keys, r)
	}
	return out, nil
}
