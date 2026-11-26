package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
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
	ts := httptest.NewServer(api.New(st, api.Options{}))
	defer ts.Close()

	runtimeDir(t)
	l, err := agent.Listen(ts.URL)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { agent.Serve(l, id.String(), time.Minute); close(done) }()
	defer func() { agent.Lock(ts.URL); <-done }()

	var stderr bytes.Buffer
	args := []string{"-server", ts.URL, "set", "fake-key", "-note", "fake-note-xyz"}
	if code := run(args, fileWith(t, "fake-passphrase-123\n"), fileWith(t, ""), &stderr); code != 0 {
		t.Fatalf("set: exit %d: %s", code, stderr.String())
	}

	ctx := context.Background()
	serverSide, clientSide := mcp.NewInMemoryTransports()
	if _, err := newMCPServer(ts.URL, false).Connect(ctx, serverSide, nil); err != nil {
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
	if isErr || !strings.Contains(health, `"items":2`) || !strings.Contains(health, `"api":"v1"`) || !strings.Contains(health, `"no_totp":[]`) || !strings.Contains(health, `"unreadable":[]`) {
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

// import_env reads only a declared source, stores each key once, never
// overwrites, and returns no value.
func TestMCPImportEnv(t *testing.T) {
	url, _, _ := setupVault(t)
	dir := t.TempDir()
	envFile := filepath.Join(dir, "remote.env")
	writeEnv := func(content string) {
		t.Helper()
		if err := os.WriteFile(envFile, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	writeEnv("# comment\nexport API_KEY=\"fake-api-value-1\"\nDB_PASSWORD=fake-db-value-2 # inline\nEMPTY=\nOTHER='fake-other-3'\n")
	// A fake ssh on PATH records its arguments and prints the env file.
	bin := filepath.Join(dir, "bin")
	os.Mkdir(bin, 0o700)
	argsFile := filepath.Join(dir, "args")
	failFile := filepath.Join(dir, "fail")
	script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > '" + argsFile + "'\n" +
		"if [ -f '" + failFile + "' ]; then echo 'fake-stderr-secret: Permission denied' >&2; exit 255; fi\n" +
		"cat '" + envFile + "'\n"
	if err := os.WriteFile(filepath.Join(bin, "ssh"), []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+":"+os.Getenv("PATH"))
	config := filepath.Join(dir, "config")
	t.Setenv("XDG_CONFIG_HOME", config)
	os.MkdirAll(filepath.Join(config, "keyfold"), 0o700)
	sources := `{
		"core-pve": {"host": "fake-host", "path": "/opt/core/.env", "sudo": true, "project": "fake-core", "environment": "preprod"},
		"bad-env": {"host": "fake-host", "path": "/opt/core/.env", "environment": "staging"}
	}`
	if err := os.WriteFile(filepath.Join(config, "keyfold", "sources.json"), []byte(sources), 0o600); err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	serverSide, clientSide := mcp.NewInMemoryTransports()
	if _, err := newMCPServer(url, false).Connect(ctx, serverSide, nil); err != nil {
		t.Fatal(err)
	}
	session, err := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "0"}, nil).Connect(ctx, clientSide, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	var results string
	call := func(arguments map[string]any) (importOutput, bool) {
		t.Helper()
		res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "import_env", Arguments: arguments})
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(res)
		results += string(raw)
		var out importOutput
		if !res.IsError {
			structured, _ := json.Marshal(res.StructuredContent)
			json.Unmarshal(structured, &out)
		}
		return out, res.IsError
	}
	statuses := func(out importOutput) string {
		var s []string
		for _, k := range out.Keys {
			s = append(s, k.Item+"="+k.Status)
		}
		return strings.Join(s, " ")
	}

	out, isErr := call(map[string]any{"source": "core-pve", "keys": []string{"API_KEY", "DB_PASSWORD", "EMPTY", "NOPE", "API_KEY"}})
	want := "core-pve.API_KEY=imported core-pve.DB_PASSWORD=imported core-pve.EMPTY=missing core-pve.NOPE=missing core-pve.API_KEY=unchanged"
	if isErr || statuses(out) != want {
		t.Fatalf("first import = %q, want %q (error %v)", statuses(out), want, isErr)
	}
	args, _ := os.ReadFile(argsFile)
	if got := string(args); got != "-o\nBatchMode=yes\n--\nfake-host\nsudo -n cat -- '/opt/core/.env'\n" {
		t.Errorf("ssh arguments = %q", got)
	}

	// Every key, with API_KEY changed on the host: a conflict, the item keeps its value.
	// Quotes, escapes and a multi-line value; an unterminated quote ends the
	// parse, so the line after it is not a key.
	writeEnv("API_KEY=fake-api-rotated\nDB_PASSWORD=fake-db-value-2\nEMPTY=\nOTHER='fake-other-3'\n" +
		"QUOTED=\"fake-quoted-4\" # note\nPEM=\"-----BEGIN-----\nMIIBfakepem5AAJB=\n-----END-----\"\nESC=\"fake-a\\\"b\\nc\"\n" +
		"SQ='it\\'s\nFRAGMENT=fake-frag-7'\n" +
		"BROKEN=\"fake-unterminated\nLOOKS_LIKE_KEY=fake-tail-6\n")
	out, isErr = call(map[string]any{"source": "core-pve"})
	want = "core-pve.API_KEY=conflict core-pve.DB_PASSWORD=unchanged core-pve.EMPTY=missing core-pve.OTHER=imported core-pve.QUOTED=imported core-pve.PEM=imported core-pve.ESC=imported core-pve.SQ=imported"
	if isErr || statuses(out) != want {
		t.Fatalf("second import = %q, want %q (error %v)", statuses(out), want, isErr)
	}
	for name, value := range map[string]string{"core-pve.API_KEY": "fake-api-value-1", "core-pve.DB_PASSWORD": "fake-db-value-2", "core-pve.OTHER": "fake-other-3",
		"core-pve.QUOTED": "fake-quoted-4", "core-pve.PEM": "-----BEGIN-----\nMIIBfakepem5AAJB=\n-----END-----", "core-pve.ESC": "fake-a\"b\nc",
		"core-pve.SQ": "it's\nFRAGMENT=fake-frag-7"} {
		var stderr bytes.Buffer
		stdout := fileWith(t, "")
		if code := run([]string{"-server", url, "get", name}, fileWith(t, ""), stdout, &stderr); code != 0 {
			t.Fatalf("get %s: exit %d: %s", name, code, stderr.String())
		}
		got, _ := os.ReadFile(stdout.Name())
		if strings.TrimSpace(string(got)) != value {
			t.Errorf("%s holds %d characters, not the file's value", name, len(got))
		}
	}

	if _, isErr := call(map[string]any{"source": "unknown"}); !isErr {
		t.Error("an undeclared source was read")
	}
	if err := os.Remove(argsFile); err != nil {
		t.Fatal(err)
	}
	if _, isErr := call(map[string]any{"source": "bad-env"}); !isErr || !strings.Contains(results, "prod, preprod, local") {
		t.Error("an invalid environment did not report the allowed environments")
	}
	if _, err := os.Stat(argsFile); !os.IsNotExist(err) {
		t.Errorf("an invalid environment reached ssh or the ssh log could not be checked: %v", err)
	}
	listed, err := listItems(ctx, url)
	if err != nil || len(listed.Items) != 7 || len(listed.Unreadable) != 0 {
		t.Fatalf("listItems returned %d items and %d unreadable items, error %v", len(listed.Items), len(listed.Unreadable), err)
	}
	for _, it := range listed.Items {
		if it.Project != "fake-core" || it.Environment != "preprod" {
			t.Errorf("item %s is missing its import classification", it.Name)
		}
	}
	raw, err := json.Marshal(listed)
	if err != nil {
		t.Fatal(err)
	}
	results += string(raw)
	// A failing ssh: its stderr may hold anything, only the known reason is kept.
	os.WriteFile(failFile, nil, 0o600)
	if _, isErr := call(map[string]any{"source": "core-pve"}); !isErr || !strings.Contains(results, "Permission denied") {
		t.Error("a failing ssh did not report its known reason")
	}
	for _, secret := range []string{"fake-api-value-1", "fake-api-rotated", "fake-db-value-2", "fake-other-3", "fake-quoted-4", "MIIBfakepem5AAJB", "fake-unterminated", "fake-tail-6", "FRAGMENT", "fake-stderr-secret", "Imported from"} {
		if strings.Contains(results, secret) {
			t.Errorf("a tool result contains a secret (%d characters)", len(secret))
		}
	}
}

// Code mode serves search and execute only; a script chains the operations,
// sees no host API, stops on time, and never gets a value.
func TestMCPCodeMode(t *testing.T) {
	url, _, id := setupVault(t)
	var stderr bytes.Buffer
	if code := run([]string{"-server", url, "set", "fake-key"}, fileWith(t, "fake-passphrase-123\n"), fileWith(t, ""), &stderr); code != 0 {
		t.Fatalf("set: exit %d: %s", code, stderr.String())
	}
	ctx := context.Background()
	serverSide, clientSide := mcp.NewInMemoryTransports()
	if _, err := newMCPServer(url, true).Connect(ctx, serverSide, nil); err != nil {
		t.Fatal(err)
	}
	session, err := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "0"}, nil).Connect(ctx, clientSide, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()

	tools, err := session.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, tool := range tools.Tools {
		names = append(names, tool.Name)
	}
	if got := strings.Join(names, " "); got != "execute search" {
		t.Fatalf("code mode tools = %q, want execute and search only", got)
	}

	var results string
	call := func(name string, arguments map[string]any) (string, bool) {
		t.Helper()
		res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: arguments})
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(res)
		results += string(raw)
		return string(raw), res.IsError
	}

	if found, isErr := call("search", map[string]any{"query": "import"}); isErr || !strings.Contains(found, "kf.importEnv") || strings.Contains(found, "kf.listItems") {
		t.Errorf("search import = %s", found)
	}

	script := `
		const created = await kf.generateItem({name: "fake-gen", kind: "token"});
		let again;
		try { kf.generateItem({name: "fake-gen"}); } catch (e) { again = String(e); }
		const list = kf.listItems();
		console.log("items", list.items.length);
		return {created: created.created, again, names: list.items.map(i => i.name),
			hidden: [typeof require, typeof process, typeof fetch]};`
	got, isErr := call("execute", map[string]any{"code": script})
	for _, want := range []string{`"created":"fake-gen"`, "already exists", `"names":["fake-gen","fake-key"]`, `"hidden":["undefined","undefined","undefined"]`, `"logs":["items 2"]`} {
		if isErr || !strings.Contains(got, want) {
			t.Errorf("execute result lacks %s: %s", want, got)
		}
	}

	if got, isErr := call("execute", map[string]any{"code": "throw new Error('fake-boom')"}); !isErr || !strings.Contains(got, "fake-boom") {
		t.Errorf("a throwing script = %s", got)
	}
	if got, isErr := call("execute", map[string]any{"code": "return kf.vaultHealth().server.api"}); isErr || !strings.Contains(got, `"result":"v1"`) {
		t.Errorf("vaultHealth from a script = %s", got)
	}
	// The output caps: a thrown string, many empty logs, a large result.
	if got, isErr := call("execute", map[string]any{"code": `throw "x".repeat(1000000)`}); !isErr || len(got) > 2*maxErrorText {
		t.Errorf("a huge error is %d bytes", len(got))
	}
	if got, isErr := call("execute", map[string]any{"code": `for (let i = 0; i < 100000; i++) console.log("")`}); !isErr || !strings.Contains(got, "logs are over") {
		t.Errorf("many empty logs = %.200s", got)
	}
	if got, isErr := call("execute", map[string]any{"code": `return "x".repeat(100000)`}); !isErr || !strings.Contains(got, "over 64 KiB") {
		t.Errorf("a large result = %.200s", got)
	}

	executeTimeout = 200 * time.Millisecond
	defer func() { executeTimeout = 30 * time.Second }()
	if got, isErr := call("execute", map[string]any{"code": "for (;;) {}"}); !isErr || !strings.Contains(got, "ran for more than") {
		t.Errorf("an endless script = %s", got)
	}
	// A server that never answers: the deadline stops the operation itself,
	// which the interpreter cannot interrupt. Only the duration is checked:
	// which of the two stops comes first varies.
	var hits atomic.Int32
	hung := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1); <-r.Context().Done() }))
	defer hung.Close()
	l, err := agent.Listen(hung.URL) // each server has its own agent
	if err != nil {
		t.Fatal(err)
	}
	hungAgent := make(chan struct{})
	go func() { agent.Serve(l, id.String(), time.Minute); close(hungAgent) }()
	defer func() { agent.Lock(hung.URL); <-hungAgent }()
	start := time.Now()
	_, err = execute(ctx, hung.URL, "return kf.listItems()")
	if err == nil || hits.Load() == 0 || time.Since(start) > 5*time.Second {
		t.Errorf("a hung operation: error %v after %s", err, time.Since(start))
	}

	// The generated value, read back through the CLI, must not be in any result.
	out := fileWith(t, "")
	if code := run([]string{"-server", url, "get", "fake-gen"}, fileWith(t, ""), out, &stderr); code != 0 {
		t.Fatalf("get: exit %d: %s", code, stderr.String())
	}
	generated, _ := os.ReadFile(out.Name())
	for _, secret := range []string{"fake-passphrase-123", strings.TrimSpace(string(generated))} {
		if len(secret) < 10 || strings.Contains(results, secret) {
			t.Errorf("a result contains a secret, or the secret is too short (%d characters)", len(secret))
		}
	}
}
