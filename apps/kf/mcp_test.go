package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"filippo.io/age"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"keyfold/internal/agent"
	"keyfold/internal/api"
	"keyfold/internal/store"
	"keyfold/internal/vault"
)

func TestMCPToolsNeverReturnValues(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "data"))
	if err != nil {
		t.Fatal(err)
	}
	id, _ := age.GenerateX25519Identity()
	wrapped, err := vault.WrapIdentity(id, "fake-master-123")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Init(wrapped, id.Recipient().String()); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(api.New(st, api.DefaultMaxBlob))
	defer ts.Close()

	t.Setenv("XDG_RUNTIME_DIR", dir)
	l, err := agent.Listen()
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { agent.Serve(l, id.String(), time.Minute); close(done) }()
	defer func() { agent.Lock(); <-done }()

	var stderr bytes.Buffer
	args := []string{"-server", ts.URL, "set", "fake-key", "-note", "fake-note-xyz"}
	if code := run(args, fileWith(t, "fake-passphrase-123\n"), fileWith(t, ""), &stderr); code != 0 {
		t.Fatalf("set: exit %d: %s", code, stderr.String())
	}

	ctx := context.Background()
	serverSide, clientSide := mcp.NewInMemoryTransports()
	if _, err := newMCPServer(ts.URL).Connect(ctx, serverSide, nil); err != nil {
		t.Fatal(err)
	}
	session, err := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "0"}, nil).Connect(ctx, clientSide, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()

	// call returns the whole tool result as JSON: text content and structured content.
	call := func(name string, arguments any) (string, bool) {
		t.Helper()
		res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: arguments})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		raw, err := json.Marshal(res)
		if err != nil {
			t.Fatal(err)
		}
		return string(raw), res.IsError
	}

	created, isErr := call("generate_item", map[string]any{"name": "fake-generated", "kind": "token"})
	if isErr {
		t.Fatalf("generate_item failed: %s", created)
	}
	if again, isErr := call("generate_item", map[string]any{"name": "fake-generated"}); !isErr {
		t.Errorf("generate_item on an existing name succeeded: %s", again)
	}
	listed, isErr := call("list_items", map[string]any{})
	if isErr || !strings.Contains(listed, "fake-key") || !strings.Contains(listed, "fake-generated") {
		t.Fatalf("list_items = %s", listed)
	}

	health, isErr := call("vault_health", map[string]any{})
	if isErr || !strings.Contains(health, `"items":2`) || !strings.Contains(health, `"api":"v1"`) || !strings.Contains(health, `"no_totp":[]`) {
		t.Fatalf("vault_health = %s", health)
	}

	// The generated value, read back through the CLI, must not be in any tool result.
	out := fileWith(t, "")
	if code := run([]string{"-server", ts.URL, "get", "fake-generated"}, fileWith(t, ""), out, &stderr); code != 0 {
		t.Fatalf("get: exit %d: %s", code, stderr.String())
	}
	buf := make([]byte, 256)
	n, _ := out.ReadAt(buf, 0)
	generated := strings.TrimSpace(string(buf[:n]))
	if len(generated) < 20 {
		t.Fatalf("generated value is too short: %d characters", len(generated))
	}
	for _, secret := range []string{"fake-passphrase-123", "fake-note-xyz", generated} {
		if strings.Contains(created+listed+health, secret) {
			t.Errorf("a tool result contains a secret (%d characters)", len(secret))
		}
	}
}
