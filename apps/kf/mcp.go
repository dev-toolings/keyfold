package main

import (
	"cmp"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"keyfold/internal/vault"
)

// The MCP tools let an AI agent see what the vault holds and add generated
// secrets. Whatever a tool returns enters the model's conversation, so no
// tool ever returns a value or a note, and none edits or deletes.

type listedItem struct {
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type listOutput struct {
	Items []listedItem `json:"items"`
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
}

// generatedKinds are the kinds a random value makes sense for.
var generatedKinds = []string{"login", "token", "ssh-passphrase"}

func newMCPServer(base string) *mcp.Server {
	s := mcp.NewServer(&mcp.Implementation{Name: "keyfold", Version: "0.1.0"}, nil)

	mcp.AddTool(s, &mcp.Tool{
		Name:        "list_items",
		Description: "List the items of the Keyfold vault: name, kind, creation and last modification dates. Never returns secret values or notes. The vault must be unlocked first with `kf unlock`.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, func(context.Context, *mcp.CallToolRequest, struct{}) (*mcp.CallToolResult, listOutput, error) {
		c := &client{base: base}
		_, entries, err := c.open()
		if err != nil {
			return nil, listOutput{}, err
		}
		defer c.logout()
		out := listOutput{Items: []listedItem{}}
		for _, e := range entries {
			it, _ := vault.Upgrade(e.item) // the kinds generate_item accepts
			out.Items = append(out.Items, listedItem{
				Name: it.Name, Kind: it.Kind,
				CreatedAt: cmp.Or(it.CreatedAt, it.UpdatedAt), UpdatedAt: it.UpdatedAt,
			})
		}
		slices.SortFunc(out.Items, func(a, b listedItem) int { return strings.Compare(a.Name, b.Name) })
		return nil, out, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name: "vault_health",
		Description: "Health check of the Keyfold vault. server: API version, item and attachment counts, attachment bytes, free disk space, TOTP on or off, open sessions, uptime. " +
			"vault: the web dashboard indicators as item names: stale (not modified for more than 90 days), reused (same secret as another item), short (password under 16 characters), weak (estimated under 60 bits), no_totp (website login without a TOTP secret). " +
			"Never returns a value or a note. The vault must be unlocked first with `kf unlock`.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, func(context.Context, *mcp.CallToolRequest, struct{}) (*mcp.CallToolResult, healthOutput, error) {
		c := &client{base: base}
		_, entries, err := c.open()
		if err != nil {
			return nil, healthOutput{}, err
		}
		defer c.logout()
		var out healthOutput
		if err := c.do("GET", "/api/v1/health", nil, &out.Server); err != nil {
			return nil, healthOutput{}, err
		}
		items := make([]vault.Item, 0, len(entries))
		for _, e := range entries {
			it, _ := vault.Upgrade(e.item)
			items = append(items, it)
		}
		out.Vault = vault.ComputeHealth(items, time.Now())
		return nil, out, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "generate_item",
		Description: "Create a new vault item holding a freshly generated random secret. The value is generated and encrypted locally and is never returned: read it later with `kf get <name>` or in the web UI. Fails if the name already exists. The vault must be unlocked first with `kf unlock`.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in generateInput) (*mcp.CallToolResult, generateOutput, error) {
		name := strings.TrimSpace(in.Name)
		kind := cmp.Or(in.Kind, "login")
		if name == "" {
			return nil, generateOutput{}, errors.New("name is empty")
		}
		if !slices.Contains(generatedKinds, kind) {
			return nil, generateOutput{}, fmt.Errorf("unknown kind %q (want one of %s)", kind, strings.Join(generatedKinds, ", "))
		}
		c := &client{base: base}
		id, entries, err := c.open()
		if err != nil {
			return nil, generateOutput{}, err
		}
		defer c.logout()
		if _, ok := find(entries, name); ok {
			return nil, generateOutput{}, fmt.Errorf("an item named %q already exists", name)
		}
		now := time.Now().UTC().Format(time.RFC3339)
		it := vault.Item{V: vault.ItemVersion, Name: name, Kind: kind, Value: rand.Text(), CreatedAt: now, UpdatedAt: now}
		if err := c.put(newEntry(), it, id.Recipient()); err != nil {
			return nil, generateOutput{}, err
		}
		return nil, generateOutput{Created: name, Kind: kind}, nil
	})
	return s
}

// cmdMCP serves the tools over stdin and stdout until the client disconnects.
func cmdMCP(c *client) error {
	return newMCPServer(c.base).Run(context.Background(), &mcp.StdioTransport{})
}
