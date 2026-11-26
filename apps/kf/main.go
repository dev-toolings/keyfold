// Command kf is the vault CLI. Secrets only ever go to stdout of a
// non-terminal process (get) or come from stdin (set).
package main

import (
	"bufio"
	"bytes"
	"cmp"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
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
	"keyfold/internal/hosts"
	"keyfold/internal/store"
	"keyfold/internal/vault"
	"keyfold/internal/version"
)

const usage = `usage: kf [-server URL] <command> [args]

commands:
  version                    print the version
  init                       create the vault (asks the master password twice)
  unlock [-ttl 1h]           unlock and start the background agent for
                             this server (one agent per server URL)
  lock                       stop the agent for this server
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
  list                       print name, kind, project and environment as tab-separated columns
  rm <name>                  delete an item
  migrate [-apply]           rewrite items in the current format (dry run
                             without -apply)
  mcp [-code-mode] [-deposit]
                             serve the MCP tools on stdin/stdout, for AI agents
                             (list names, generate a secret, import a declared
                             env file; never a value). -code-mode serves only
                             search and execute (JavaScript calling the same
                             operations). -deposit works without unlock, with
                             the deposit key in $KEYFOLD_DEPOSIT_KEY: new items
                             wait for review in the web UI

The server URL defaults to $KEYFOLD_SERVER, then http://127.0.0.1:8717.
For remote init, set $KEYFOLD_INSTALL_TOKEN to the install token from the server log.
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
	code := 0
	switch cmd {
	case "version":
		fmt.Fprintln(stdout, "kf", version.Display())
		return 0
	case "init":
		err = cmdInit(c, func(prompt string) (string, error) { return readPassword(stdin, stderr, prompt) }, stderr)
	case "unlock":
		err = cmdUnlock(c, rest, stdin, stderr)
	case "agent":
		err = cmdAgent(c.base, rest, stdin, stdout)
	case "lock":
		err = agent.Lock(c.base)
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
		code, err = cmdRun(c, rest, stdin, stdout, stderr)
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
		err = cmdMCP(c, rest)
	default:
		fs.Usage()
		return 2
	}
	if len(c.unreadable) > 0 {
		fmt.Fprintf(stderr, "kf: warning: %d item(s) cannot be read and were skipped: %s\n", len(c.unreadable), strings.Join(c.unreadable, ", "))
	}
	if err != nil {
		fmt.Fprintln(stderr, "kf:", err)
		return 1
	}
	// A command whose result stands for the whole vault did its work, on a
	// part of it only.
	if len(c.unreadable) > 0 && (cmd == "list" || cmd == "migrate") {
		return exitPartial
	}
	return code
}

// httpClient bounds every call, so a silent server fails the command instead
// of hanging it. It never follows a redirect: the API sends none, and one to
// another scheme or host would carry the session token there.
var httpClient = &http.Client{
	Timeout:       30 * time.Second,
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

// exitPartial is the exit code of list and migrate when they worked on the
// readable items only.
const exitPartial = 3

// client talks to the server API.
type client struct {
	base  string
	ctx   context.Context // bounds the HTTP calls; nil: the client timeout only
	token string
	// deposit is the token of a deposit key (kf mcp -deposit): it reaches the inbox only.
	deposit string
	totp    string // sent once with the identity download when the server asks for it
	// unreadable holds the ids of the items open could not decrypt: a damaged
	// file, or a format this kf does not know. They are skipped, not fatal.
	unreadable []string
	projects   []vault.Item
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
	// Tokens and the TOTP code travel in headers: never in clear
	// over a network. Checked here, so commands that stay local (lock, the
	// agent) run whatever the server URL is.
	if u, err := url.Parse(c.base); err != nil || (u.Scheme != "https" && (u.Scheme != "http" || !hosts.Loopback(hosts.Name(u.Host)))) {
		return fmt.Errorf("server %s: use an https:// URL, plain http is only accepted for a loopback address", c.base)
	}
	req, err := http.NewRequestWithContext(cmp.Or(c.ctx, context.Background()), method, c.base+path, body)
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
	if c.deposit != "" {
		req.Header.Set("Authorization", "Deposit "+c.deposit)
	}
	if c.totp != "" {
		req.Header.Set("X-TOTP-Code", c.totp)
	}
	resp, err := httpClient.Do(req)
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
	// Under a deadline (MCP), the session request ignores it: cut midway, it
	// would leave a session whose token nobody holds. Its own 10 s bound keeps
	// the deadline close. The CLI has no deadline and keeps the HTTP timeout.
	saved := c.ctx
	if saved != nil {
		var cancel context.CancelFunc
		c.ctx, cancel = context.WithTimeout(context.WithoutCancel(saved), 10*time.Second)
		defer cancel()
	}
	err = c.do("POST", "/api/v1/session", map[string]any{"id": ch.ID, "answer": answer}, &s)
	c.ctx = saved
	if err != nil {
		return err
	}
	c.token = s.Token
	return nil
}

// logout closes the session even when c.ctx is done, so a script that ran out
// of time leaves no open session behind; under a deadline it waits 5 s at
// most. The CLI has no deadline and keeps the HTTP timeout.
func (c *client) logout() {
	if c.ctx != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		c.ctx = ctx
	}
	c.do("POST", "/api/v1/lock", nil, nil)
}

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

// open logs in with the agent identity and decrypts every item it can. One
// item that cannot be read must not put every other secret out of reach: its
// id goes to c.unreadable.
func (c *client) open() (*age.X25519Identity, []entry, error) {
	s, err := agent.Identity(c.base)
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
	c.projects = nil
	for _, r := range raw {
		it, err := vault.DecryptItem(r.Ciphertext, id)
		if err != nil {
			c.unreadable = append(c.unreadable, r.ID)
			continue
		}
		if it.Kind == vault.ProjectKind {
			c.projects = append(c.projects, it)
			continue
		}
		entries = append(entries, entry{id: r.ID, etag: r.ETag, item: it})
	}
	return id, entries, nil
}

// whole returns an error when open skipped items. Their names are unknown, so
// a command that takes a name for free could make a second item of that name,
// and one that writes the vault to a file would leave them out.
func (c *client) whole() error {
	if len(c.unreadable) == 0 {
		return nil
	}
	// The ids are in the error itself: an MCP caller sees nothing else.
	return fmt.Errorf("this needs the whole vault, and %d item(s) cannot be read (%s): upgrade kf if a newer Keyfold wrote them, else restore them from a backup; deleting their files in items/ on the server removes them for good",
		len(c.unreadable), strings.Join(c.unreadable, ", "))
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

func cmdInit(c *client, password func(string) (string, error), stderr io.Writer) error {
	var st struct {
		Initialized bool `json:"initialized"`
	}
	if err := c.do("GET", "/api/v1/status", nil, &st); err != nil {
		return err
	}
	if st.Initialized {
		return errors.New("vault already initialized")
	}
	pw, err := password("New master password: ")
	if err != nil {
		return err
	}
	if err := vault.CheckMasterPassword(pw); err != nil {
		return err
	}
	again, err := password("Repeat master password: ")
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
	hdr := http.Header{}
	if token := os.Getenv("KEYFOLD_INSTALL_TOKEN"); token != "" {
		hdr.Set("X-Install-Token", token)
	}
	if err := c.doWith("POST", "/api/v1/init", hdr, map[string]any{"identity": wrapped, "recipient": id.Recipient().String()}, nil); err != nil {
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
	agent.Lock(c.base) // replace a previous agent for this server, if any

	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, "-server", c.base, "agent", "-ttl", ttl.String())
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
	if line = strings.TrimSpace(line); err != nil || line != "ready" {
		cmd.Process.Kill()
		cmd.Wait()
		if line != "" {
			return fmt.Errorf("agent failed to start: %s", line)
		}
		return errors.New("agent failed to start")
	}
	cmd.Process.Release()
	fmt.Fprintf(stderr, "unlocked for %s\n", ttl)
	return nil
}

// cmdAgent is the detached process started by unlock, serving the agent for
// server. It reads the identity from stdin, never from argv or the environment.
func cmdAgent(server string, args []string, stdin, stdout *os.File) error {
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
	l, err := agent.Listen(server)
	if err != nil {
		fmt.Fprintln(stdout, err) // unlock shows it: the agent has no terminal
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
		if err := c.whole(); err != nil { // the name may be the one of an item that cannot be read
			return err
		}
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
		fmt.Fprintf(stdout, "%s\t%s\t%s\t%s\n", it.Name, it.Kind, it.Project, it.Environment)
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
