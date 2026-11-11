// Command kf is the vault CLI. Secrets only ever go to stdout of a
// non-terminal process (get) or come from stdin (set).
package main

import (
	"bufio"
	"bytes"
	"cmp"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"slices"
	"sort"
	"strings"
	"syscall"
	"time"

	"filippo.io/age"
	"golang.org/x/term"

	"keyfold/internal/agent"
	"keyfold/internal/store"
	"keyfold/internal/vault"
)

const usage = `usage: kf [-server URL] <command> [args]

commands:
  init                       create the vault (asks the master password twice)
  unlock [-ttl 1h]           unlock and start the background agent
  lock                       stop the agent
  get <name>                 print a value to stdout (refused on a terminal)
  set <name> [-kind K] [-note N]
                             store a value read from stdin (kinds: login,
                             token, note, identity, ssh-key,
                             ssh-passphrase); other fields are kept
  read kf://name/field      print one field (refused on a terminal); fields:
                             value, username, note, url, totp, or a custom
                             field name
  run -env VAR=kf://name/field [-env ...] -- cmd [args]
                             run cmd with secrets in its environment
  inject -i template [-o out]
                             replace {{ kf://name/field }}; out is 0600
  generate [-len 24] [-symbols=false] [-words N]
                             print a random password or EFF passphrase
  totp <name>                print the current TOTP code of an item
  export [-format keyfold|bitwarden-json] [-o file] (-encrypt | -plaintext)
                             export every item; -encrypt asks a passphrase
  import -format keyfold|bitwarden-json|1password-1pux|csv <file>
                             add the items of an export; one already present
                             is skipped, a taken name gets a " (2)" suffix
  list                       print names and kinds
  rm <name>                  delete an item
  migrate [-apply]           rewrite items in the current format (dry run
                             without -apply)
  mcp                        serve the MCP tools on stdin/stdout, for AI agents
                             (list names, generate a secret; never a value)

The server URL defaults to $KEYFOLD_SERVER, then http://127.0.0.1:8717.
`

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}

func run(args []string, stdin, stdout *os.File, stderr io.Writer) int {
	fs := flag.NewFlagSet("kf", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.Usage = func() { fmt.Fprint(stderr, usage) }
	defaultServer := os.Getenv("KEYFOLD_SERVER")
	if defaultServer == "" {
		defaultServer = "http://127.0.0.1:8717"
	}
	server := fs.String("server", defaultServer, "server URL")
	if err := fs.Parse(args); err != nil || fs.NArg() == 0 {
		fs.Usage()
		return 2
	}
	c := &client{base: strings.TrimRight(*server, "/")}
	cmd, rest := fs.Arg(0), fs.Args()[1:]

	var err error
	switch cmd {
	case "init":
		err = cmdInit(c, stdin, stderr)
	case "unlock":
		err = cmdUnlock(c, rest, stdin, stderr)
	case "agent":
		err = cmdAgent(rest, stdin, stdout)
	case "lock":
		err = agent.Lock()
		if errors.Is(err, agent.ErrNoAgent) {
			err = nil
		}
	case "get":
		// Checked before anything else: no secret may reach a terminal.
		if term.IsTerminal(int(stdout.Fd())) {
			fmt.Fprintln(stderr, "kf: refusing to print a secret to a terminal; pipe or redirect stdout")
			return 1
		}
		err = cmdGet(c, rest, stdout)
	case "read":
		if term.IsTerminal(int(stdout.Fd())) {
			fmt.Fprintln(stderr, "kf: refusing to print a secret to a terminal; pipe or redirect stdout")
			return 1
		}
		err = cmdRead(c, rest, stdout)
	case "run":
		var code int
		if code, err = cmdRun(c, rest, stdin, stdout, stderr); err == nil {
			return code
		}
	case "inject":
		err = cmdInject(c, rest, stdout, stderr)
	case "generate":
		err = cmdGenerate(rest, stdout, stderr)
	case "totp":
		err = cmdTOTP(c, rest, stdout)
	case "export":
		err = cmdExport(c, rest, stdin, stdout, stderr)
	case "import":
		err = cmdImport(c, rest, stdout, stderr)
	case "set":
		err = cmdSet(c, rest, stdin, stderr)
	case "list":
		err = cmdList(c, stdout)
	case "rm":
		err = cmdRm(c, rest)
	case "migrate":
		err = cmdMigrate(c, rest, stdout, stderr)
	case "mcp":
		err = cmdMCP(c)
	default:
		fs.Usage()
		return 2
	}
	if err != nil {
		fmt.Fprintln(stderr, "kf:", err)
		return 1
	}
	return 0
}

// client talks to the server API.
type client struct {
	base  string
	token string
	totp  string // sent once with the identity download when the server asks for it
}

func (c *client) do(method, path string, in, out any) error {
	return c.doWith(method, path, nil, in, out)
}

// doWith is do with extra request headers.
func (c *client) doWith(method, path string, hdr http.Header, in, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.base+path, body)
	if err != nil {
		return err
	}
	for k, v := range hdr {
		req.Header[k] = v
	}
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	if c.totp != "" {
		req.Header.Set("X-TOTP-Code", c.totp)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("server unreachable at %s", c.base)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		var e struct {
			Error string `json:"error"`
		}
		json.NewDecoder(resp.Body).Decode(&e)
		return fmt.Errorf("server: %s %s: %d %s", method, path, resp.StatusCode, e.Error)
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}

// login proves possession of the identity and stores the session token.
func (c *client) login(id age.Identity) error {
	var ch struct {
		ID         string `json:"id"`
		Ciphertext []byte `json:"ciphertext"`
	}
	if err := c.do("POST", "/api/v1/challenge", nil, &ch); err != nil {
		return err
	}
	answer, err := vault.Decrypt(ch.Ciphertext, id)
	if err != nil {
		return errors.New("cannot decrypt the server challenge: the agent identity does not match this vault")
	}
	var s struct {
		Token string `json:"token"`
	}
	if err := c.do("POST", "/api/v1/session", map[string]any{"id": ch.ID, "answer": answer}, &s); err != nil {
		return err
	}
	c.token = s.Token
	return nil
}

func (c *client) logout() { c.do("POST", "/api/v1/lock", nil, nil) }

type entry struct {
	id   string
	etag string // empty for an item not stored yet
	item vault.Item
}

// put encrypts it in the current format and stores it under e.id. An entry
// read from the server is written only if nobody changed it meanwhile.
func (c *client) put(e entry, it vault.Item, r age.Recipient) error {
	ct, err := vault.EncryptItem(it, r)
	if err != nil {
		return err
	}
	var hdr http.Header
	if e.etag != "" {
		hdr = http.Header{"If-Match": {e.etag}}
	}
	return c.doWith("PUT", "/api/v1/items/"+e.id, hdr, map[string]any{"ciphertext": ct}, nil)
}

// newEntry returns an entry with a fresh random id.
func newEntry() entry {
	b := make([]byte, 16)
	rand.Read(b)
	return entry{id: hex.EncodeToString(b)}
}

// open logs in with the agent identity and decrypts every item.
func (c *client) open() (*age.X25519Identity, []entry, error) {
	s, err := agent.Identity()
	if err != nil {
		return nil, nil, err
	}
	id, err := age.ParseX25519Identity(s)
	if err != nil {
		return nil, nil, errors.New("agent returned an invalid identity")
	}
	if err := c.login(id); err != nil {
		return nil, nil, err
	}
	var raw []store.Entry
	if err := c.do("GET", "/api/v1/items", nil, &raw); err != nil {
		c.logout()
		return nil, nil, err
	}
	entries := make([]entry, 0, len(raw))
	for _, r := range raw {
		it, err := vault.DecryptItem(r.Ciphertext, id)
		if err != nil {
			c.logout()
			return nil, nil, fmt.Errorf("item %s cannot be decrypted", r.ID)
		}
		entries = append(entries, entry{id: r.ID, etag: r.ETag, item: it})
	}
	return id, entries, nil
}

func find(entries []entry, name string) (entry, bool) {
	for _, e := range entries {
		if e.item.Name == name {
			return e, true
		}
	}
	return entry{}, false
}

// nameArg parses flags placed before or after the single positional name.
func nameArg(fs *flag.FlagSet, args []string) (string, error) {
	if err := fs.Parse(args); err != nil {
		return "", err
	}
	if fs.NArg() == 0 {
		return "", errors.New("missing name")
	}
	name := fs.Arg(0)
	if err := fs.Parse(fs.Args()[1:]); err != nil {
		return "", err
	}
	if fs.NArg() != 0 {
		return "", errors.New("too many arguments")
	}
	return name, nil
}

func readPassword(stdin *os.File, stderr io.Writer, prompt string) (string, error) {
	if !term.IsTerminal(int(stdin.Fd())) {
		return "", errors.New("the master password must be typed on a terminal")
	}
	fmt.Fprint(stderr, prompt)
	b, err := term.ReadPassword(int(stdin.Fd()))
	fmt.Fprintln(stderr)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func cmdInit(c *client, stdin *os.File, stderr io.Writer) error {
	var st struct {
		Initialized bool `json:"initialized"`
	}
	if err := c.do("GET", "/api/v1/status", nil, &st); err != nil {
		return err
	}
	if st.Initialized {
		return errors.New("vault already initialized")
	}
	pw, err := readPassword(stdin, stderr, "New master password: ")
	if err != nil {
		return err
	}
	if err := vault.CheckMasterPassword(pw); err != nil {
		return err
	}
	again, err := readPassword(stdin, stderr, "Repeat master password: ")
	if err != nil {
		return err
	}
	if pw != again {
		return errors.New("passwords do not match")
	}
	id, err := age.GenerateX25519Identity()
	if err != nil {
		return err
	}
	wrapped, err := vault.WrapIdentity(id, pw)
	if err != nil {
		return err
	}
	if err := c.do("POST", "/api/v1/init", map[string]any{"identity": wrapped, "recipient": id.Recipient().String()}, nil); err != nil {
		return err
	}
	fmt.Fprintln(stderr, "vault initialized")
	return nil
}

func cmdUnlock(c *client, args []string, stdin *os.File, stderr io.Writer) error {
	fs := flag.NewFlagSet("unlock", flag.ContinueOnError)
	fs.SetOutput(stderr)
	ttl := fs.Duration("ttl", time.Hour, "agent lifetime")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *ttl <= 0 {
		return errors.New("ttl must be positive")
	}
	var st struct {
		TOTP bool `json:"totp"`
	}
	if err := c.do("GET", "/api/v1/status", nil, &st); err != nil {
		return err
	}
	pw, err := readPassword(stdin, stderr, "Master password: ")
	if err != nil {
		return err
	}
	if st.TOTP {
		if c.totp, err = readPassword(stdin, stderr, "TOTP code: "); err != nil {
			return err
		}
	}
	var resp struct {
		Identity  []byte `json:"identity"`
		Recipient string `json:"recipient"`
	}
	err = c.do("GET", "/api/v1/identity", nil, &resp)
	c.totp = "" // single use
	if err != nil {
		return err
	}
	id, err := vault.UnwrapIdentity(resp.Identity, pw)
	if err != nil {
		return err
	}
	if id.Recipient().String() != resp.Recipient {
		return errors.New("identity does not match the stored recipient")
	}
	agent.Lock() // replace a previous agent, if any

	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, "agent", "-ttl", ttl.String())
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	in, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	fmt.Fprintln(in, id.String())
	in.Close()
	line, err := bufio.NewReader(out).ReadString('\n')
	if err != nil || strings.TrimSpace(line) != "ready" {
		cmd.Process.Kill()
		cmd.Wait()
		return errors.New("agent failed to start")
	}
	cmd.Process.Release()
	fmt.Fprintf(stderr, "unlocked for %s\n", ttl)
	return nil
}

// cmdAgent is the detached process started by unlock. It reads the identity
// from stdin, never from argv or the environment.
func cmdAgent(args []string, stdin, stdout *os.File) error {
	fs := flag.NewFlagSet("agent", flag.ContinueOnError)
	ttl := fs.Duration("ttl", time.Hour, "agent lifetime")
	if err := fs.Parse(args); err != nil {
		return err
	}
	b, err := io.ReadAll(io.LimitReader(stdin, 4096))
	if err != nil {
		return err
	}
	id, err := age.ParseX25519Identity(strings.TrimSpace(string(b)))
	if err != nil {
		return errors.New("agent: invalid identity on stdin")
	}
	l, err := agent.Listen()
	if err != nil {
		return err
	}
	fmt.Fprintln(stdout, "ready")
	stdout.Close()
	agent.Serve(l, id.String(), *ttl)
	return nil
}

func cmdGet(c *client, args []string, stdout io.Writer) error {
	if len(args) != 1 {
		return errors.New("usage: kf get <name>")
	}
	_, entries, err := c.open()
	if err != nil {
		return err
	}
	defer c.logout()
	e, ok := find(entries, args[0])
	if !ok {
		return fmt.Errorf("no item named %q", args[0])
	}
	_, err = fmt.Fprintln(stdout, e.item.Value)
	return err
}

func cmdSet(c *client, args []string, stdin *os.File, stderr io.Writer) error {
	fs := flag.NewFlagSet("set", flag.ContinueOnError)
	fs.SetOutput(stderr)
	kind := fs.String("kind", "", "item kind (default: unchanged, login for a new item)")
	note := fs.String("note", "", "note (default: unchanged)")
	name, err := nameArg(fs, args)
	if err != nil {
		return err
	}
	if *kind != "" && !slices.Contains(vault.Kinds, *kind) {
		return fmt.Errorf("unknown kind %q (want one of %s)", *kind, strings.Join(vault.Kinds, ", "))
	}
	var value string
	if term.IsTerminal(int(stdin.Fd())) {
		fmt.Fprint(stderr, "Value: ")
		b, err := term.ReadPassword(int(stdin.Fd()))
		fmt.Fprintln(stderr)
		if err != nil {
			return err
		}
		value = string(b)
	} else {
		b, err := io.ReadAll(io.LimitReader(stdin, 512<<10))
		if err != nil {
			return err
		}
		value = strings.TrimSuffix(strings.TrimSuffix(string(b), "\n"), "\r")
	}
	if value == "" {
		return errors.New("empty value")
	}

	id, entries, err := c.open()
	if err != nil {
		return err
	}
	defer c.logout()
	// An existing item keeps every field the flags do not set: the web UI
	// may have added a username, URLs or custom fields.
	now := time.Now().UTC().Format(time.RFC3339)
	e, ok := find(entries, name)
	if ok {
		e.item, _ = vault.Upgrade(e.item)
		e.item.CreatedAt = cmp.Or(e.item.CreatedAt, e.item.UpdatedAt)
	} else {
		e = newEntry()
		e.item = vault.Item{V: vault.ItemVersion, Name: name, Kind: "login", CreatedAt: now}
	}
	it := vault.WithValue(e.item, value, now)
	it.UpdatedAt = now
	if *kind != "" {
		it.Kind = *kind
	}
	setFlags := map[string]bool{}
	fs.Visit(func(f *flag.Flag) { setFlags[f.Name] = true })
	if setFlags["note"] {
		it.Note = *note
	}
	return c.put(e, it, id.Recipient())
}

// cmdMigrate rewrites items stored in an older format. Without -apply it only
// reports what it would change. Each write is conditional on the version read.
func cmdMigrate(c *client, args []string, stdout io.Writer, stderr io.Writer) error {
	fs := flag.NewFlagSet("migrate", flag.ContinueOnError)
	fs.SetOutput(stderr)
	apply := fs.Bool("apply", false, "write the migrated items")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("usage: kf migrate [-apply]")
	}
	id, entries, err := c.open()
	if err != nil {
		return err
	}
	defer c.logout()
	sort.Slice(entries, func(i, j int) bool { return entries[i].item.Name < entries[j].item.Name })
	n := 0
	for _, e := range entries {
		it, changed := vault.Upgrade(e.item)
		if !changed {
			continue
		}
		n++
		fmt.Fprintf(stdout, "%s\tv%d %s -> v%d %s\n", e.item.Name, max(e.item.V, 1), e.item.Kind, it.V, it.Kind)
		if *apply {
			if err := c.put(e, it, id.Recipient()); err != nil {
				return fmt.Errorf("%s: %w", e.item.Name, err)
			}
		}
	}
	switch {
	case n == 0:
		fmt.Fprintln(stderr, "every item is already in the current format")
	case *apply:
		fmt.Fprintf(stderr, "%d item(s) migrated\n", n)
	default:
		fmt.Fprintf(stderr, "%d item(s) to migrate; run again with -apply to write them\n", n)
	}
	return nil
}

func cmdList(c *client, stdout io.Writer) error {
	_, entries, err := c.open()
	if err != nil {
		return err
	}
	defer c.logout()
	sort.Slice(entries, func(i, j int) bool { return entries[i].item.Name < entries[j].item.Name })
	for _, e := range entries {
		it, _ := vault.Upgrade(e.item) // same kinds as the web UI and `set -kind`
		fmt.Fprintf(stdout, "%s\t%s\n", it.Name, it.Kind)
	}
	return nil
}

func cmdRm(c *client, args []string) error {
	if len(args) != 1 {
		return errors.New("usage: kf rm <name>")
	}
	_, entries, err := c.open()
	if err != nil {
		return err
	}
	defer c.logout()
	e, ok := find(entries, args[0])
	if !ok {
		return fmt.Errorf("no item named %q", args[0])
	}
	if err := c.doWith("DELETE", "/api/v1/items/"+e.id, http.Header{"If-Match": {e.etag}}, nil, nil); err != nil {
		return err
	}
	// Then its attachments. One left behind is ciphertext nothing points to:
	// a failure here is not worth failing the command.
	for _, b := range e.item.Attachments {
		c.do("DELETE", "/api/v1/blobs/"+b.ID, nil, nil)
	}
	return nil
}
