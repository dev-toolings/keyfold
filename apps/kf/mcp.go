package main

import (
	"cmp"
	"context"
	"crypto/rand"
	"errors"
	"flag"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"keyfold/internal/vault"
	"keyfold/internal/version"
)

// The MCP tools let an AI agent see what the vault holds, add generated
// secrets and import env files the user declared. Whatever a tool returns
// enters the model's conversation, so no tool ever returns a value or a note,
// and none edits or deletes.

type listedItem struct {
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	Project     string `json:"project,omitempty"`
	Environment string `json:"environment,omitempty"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

type listOutput struct {
	Items []listedItem `json:"items"`
	// Unreadable holds the ids of the items that could not be decrypted, and
	// so are not in Items.
	Unreadable []string `json:"unreadable"`
}

type generateInput struct {
	Name string `json:"name" jsonschema:"name of the new item; must not exist yet"`
	Kind string `json:"kind,omitempty" jsonschema:"login, token or ssh-passphrase; defaults to login"`
}

type generateOutput struct {
	Created string `json:"created"`
	Kind    string `json:"kind"`
}

// serverHealth is GET /api/v1/health: what the server sees (ciphertext only).
type serverHealth struct {
	API           string `json:"api"`
	Items         int    `json:"items"`
	Blobs         int    `json:"blobs"`
	BlobBytes     int64  `json:"blob_bytes"`
	FreeBytes     uint64 `json:"free_bytes"`
	MaxBlob       int64  `json:"max_blob"`
	TOTP          bool   `json:"totp"`
	Sessions      int    `json:"sessions"`
	UptimeSeconds int64  `json:"uptime_seconds"`
}

type healthOutput struct {
	Server serverHealth `json:"server"`
	// Vault holds the dashboard indicators, by item name.
	Vault vault.Health `json:"vault"`
	// Unreadable holds the ids of the items that could not be decrypted: the
	// indicators leave them out.
	Unreadable []string `json:"unreadable"`
}

// generatedKinds are the kinds a random value makes sense for.
var generatedKinds = []string{"login", "token", "ssh-passphrase"}

// The descriptions are shared by the tools and by code mode's search.
const (
	listDescription = "List the items of the Keyfold vault: name, kind, optional project and environment, and creation and last modification dates. unreadable: ids of the items that could not be decrypted (damaged file or unknown format), missing from the list. Never returns secret values or notes. The vault must be unlocked first with `kf unlock`."

	healthDescription = "Health check of the Keyfold vault. server: API version, item and attachment counts, attachment bytes, free disk space, TOTP on or off, open sessions, uptime. " +
		"vault: the web dashboard indicators as item names: stale (not modified for more than 90 days), reused (same secret as another item), short (password under 16 characters), weak (estimated under 60 bits), no_totp (website login without a TOTP secret). " +
		"unreadable: ids of the items that could not be decrypted (damaged file or unknown format), left out of the indicators. " +
		"Never returns a value or a note. The vault must be unlocked first with `kf unlock`."

	generateDescription = "Create a new vault item holding a freshly generated random secret. The value is generated and encrypted locally and is never returned: read it later with `kf get <name>` or in the web UI. Fails if the name already exists, or if an item of the vault cannot be decrypted (its name is unknown). The vault must be unlocked first with `kf unlock`."

	importDescription = "Import variables of a remote env file into the vault, as token items named \"<source>.<KEY>\". source is an alias the user declared in ~/.config/keyfold/sources.json (host, absolute path, sudo); the tool cannot read any other host or file. The source can set optional project and environment fields for every new item. Allowed environments are prod, preprod and local. kf reads the file over ssh and encrypts the values locally: the result holds names and a status per key only (imported, unchanged, conflict: the item exists with another value and is left alone, missing: absent or empty in the file). " +
		"Empty keys imports every variable of the file. Never overwrites an item. The vault must be unlocked first with `kf unlock`."
)

func listItems(ctx context.Context, base string) (listOutput, error) {
	c := &client{base: base, ctx: ctx}
	_, entries, err := c.open()
	if err != nil {
		return listOutput{}, err
	}
	defer c.logout()
	out := listOutput{Items: []listedItem{}, Unreadable: append([]string{}, c.unreadable...)}
	for _, e := range entries {
		it, _ := vault.Upgrade(e.item) // the kinds generate_item accepts
		out.Items = append(out.Items, listedItem{
			Name: it.Name, Kind: it.Kind, Project: it.Project, Environment: it.Environment,
			CreatedAt: cmp.Or(it.CreatedAt, it.UpdatedAt), UpdatedAt: it.UpdatedAt,
		})
	}
	slices.SortFunc(out.Items, func(a, b listedItem) int { return strings.Compare(a.Name, b.Name) })
	return out, nil
}

func vaultHealth(ctx context.Context, base string) (healthOutput, error) {
	c := &client{base: base, ctx: ctx}
	_, entries, err := c.open()
	if err != nil {
		return healthOutput{}, err
	}
	defer c.logout()
	var out healthOutput
	if err := c.do("GET", "/api/v1/health", nil, &out.Server); err != nil {
		return healthOutput{}, err
	}
	items := make([]vault.Item, 0, len(entries))
	for _, e := range entries {
		it, _ := vault.Upgrade(e.item)
		items = append(items, it)
	}
	out.Vault = vault.ComputeHealth(items, time.Now())
	out.Unreadable = append([]string{}, c.unreadable...)
	return out, nil
}

func generateItem(ctx context.Context, base string, in generateInput) (generateOutput, error) {
	name := strings.TrimSpace(in.Name)
	kind := cmp.Or(in.Kind, "login")
	if name == "" {
		return generateOutput{}, errors.New("name is empty")
	}
	if !slices.Contains(generatedKinds, kind) {
		return generateOutput{}, fmt.Errorf("unknown kind %q (want one of %s)", kind, strings.Join(generatedKinds, ", "))
	}
	c := &client{base: base, ctx: ctx}
	id, entries, err := c.open()
	if err != nil {
		return generateOutput{}, err
	}
	defer c.logout()
	if _, ok := find(entries, name); ok {
		return generateOutput{}, fmt.Errorf("an item named %q already exists", name)
	}
	if err := c.whole(); err != nil { // the name may be the one of an item that cannot be read
		return generateOutput{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	it := vault.Item{V: vault.ItemVersion, Name: name, Kind: kind, Value: rand.Text(), CreatedAt: now, UpdatedAt: now}
	if err := c.put(newEntry(), it, id.Recipient()); err != nil {
		return generateOutput{}, err
	}
	return generateOutput{Created: name, Kind: kind}, nil
}

// newMCPServer serves the four tools, or in code mode only search and
// execute, which reach the same operations from a script.
func newMCPServer(base string, codeMode bool) *mcp.Server {
	s := mcp.NewServer(&mcp.Implementation{Name: "keyfold", Version: version.Version}, nil)
	if codeMode {
		addCodeModeTools(s, base)
		return s
	}
	readOnly := &mcp.ToolAnnotations{ReadOnlyHint: true}
	mcp.AddTool(s, &mcp.Tool{Name: "list_items", Description: listDescription, Annotations: readOnly},
		func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, listOutput, error) {
			out, err := listItems(ctx, base)
			return nil, out, err
		})
	mcp.AddTool(s, &mcp.Tool{Name: "vault_health", Description: healthDescription, Annotations: readOnly},
		func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, healthOutput, error) {
			out, err := vaultHealth(ctx, base)
			return nil, out, err
		})
	mcp.AddTool(s, &mcp.Tool{Name: "generate_item", Description: generateDescription},
		func(ctx context.Context, _ *mcp.CallToolRequest, in generateInput) (*mcp.CallToolResult, generateOutput, error) {
			out, err := generateItem(ctx, base, in)
			return nil, out, err
		})
	mcp.AddTool(s, &mcp.Tool{Name: "import_env", Description: importDescription},
		func(ctx context.Context, _ *mcp.CallToolRequest, in importInput) (*mcp.CallToolResult, importOutput, error) {
			out, err := importEnv(ctx, base, in)
			return nil, out, err
		})
	return s
}

// cmdMCP serves the tools over stdin and stdout until the client disconnects.
func cmdMCP(c *client, args []string) error {
	fs := flag.NewFlagSet("mcp", flag.ContinueOnError)
	codeMode := fs.Bool("code-mode", false, "serve only search and execute: the agent runs JavaScript that calls the operations")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("usage: kf mcp [-code-mode]")
	}
	return newMCPServer(c.base, *codeMode).Run(context.Background(), &mcp.StdioTransport{})
}
