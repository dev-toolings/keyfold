package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"filippo.io/age"

	"keyfold/internal/api"
	"keyfold/internal/store"
	"keyfold/internal/vault"
)

// depositVault starts a server on an initialized vault, with no agent running,
// and creates a deposit key through the owner API. It returns the server URL,
// the store, the vault identity and the deposit key.
func depositVault(t *testing.T) (string, *store.Store, *age.X25519Identity, depositKey, string) {
	t.Helper()
	runtimeDir(t) // an empty runtime dir: no agent answers
	st, err := store.Open(t.TempDir())
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
	t.Cleanup(ts.Close)

	owner := &client{base: ts.URL}
	if err := owner.login(id); err != nil {
		t.Fatal(err)
	}
	agentID, _ := age.GenerateX25519Identity()
	token := hex.EncodeToString([]byte(strings.Repeat("k", 32)))
	var created struct{ ID string }
	if err := owner.do("POST", "/api/v1/deposit-keys", map[string]string{"name": "agent", "token": token, "recipient": agentID.Recipient().String()}, &created); err != nil {
		t.Fatal(err)
	}
	k, err := parseDepositKey(strings.Join([]string{depositKeyPrefix, token, agentID.String(), id.Recipient().String()}, "."))
	if err != nil {
		t.Fatal(err)
	}
	return ts.URL, st, id, k, created.ID
}

// deposited decrypts the deposits waiting in st with the vault identity.
func deposited(t *testing.T, st *store.Store, id *age.X25519Identity) []vault.Item {
	t.Helper()
	deposits, err := st.Deposits()
	if err != nil {
		t.Fatal(err)
	}
	var items []vault.Item
	for _, d := range deposits {
		it, err := vault.DecryptItem(d.Ciphertext, id)
		if err != nil {
			t.Fatal(err)
		}
		items = append(items, it)
	}
	return items
}

func TestDepositGenerateNeedsNoUnlock(t *testing.T) {
	url, st, id, k, _ := depositVault(t)
	o := depositOps(url, k)
	out, err := o.generate(context.Background(), generateInput{Name: "fake-db-password", Kind: "token"})
	if err != nil || !out.Pending || out.Created != "fake-db-password" {
		t.Fatalf("generate without an agent: %+v, %v", out, err)
	}
	if entries, _ := st.Items(); len(entries) != 0 {
		t.Fatal("a deposit reached the vault before review")
	}
	items := deposited(t, st, id)
	if len(items) != 1 || items[0].Name != "fake-db-password" || items[0].Kind != "token" || len(items[0].Value) < 16 {
		t.Fatalf("deposited %+v", items)
	}
	if strings.Contains(mustJSON(t, out), items[0].Value) {
		t.Fatal("the tool returned the generated value")
	}
	if o.health != nil {
		t.Error("deposit mode offers vaultHealth, which needs to read values")
	}
	for _, f := range o.api() {
		if f.Name == "kf.vaultHealth" {
			t.Error("search in deposit mode describes kf.vaultHealth")
		}
	}
}

func TestDepositCatalog(t *testing.T) {
	url, st, _, k, keyID := depositVault(t)
	session := mcpSession(t, depositOps(url, k))
	if got, isErr := callOp(t, session, "listItems", nil); !isErr || !strings.Contains(got, "no catalog yet") {
		t.Fatalf("list before any catalog: %s", got)
	}
	// What the owner's web UI writes: names for the deposit key's recipient.
	cat, _ := json.Marshal(map[string]any{"items": []listedItem{{Name: "fake-taken", Kind: "login", CreatedAt: "2026-11-26T00:00:00Z", UpdatedAt: "2026-11-26T00:00:00Z"}}})
	ct, err := vault.Encrypt(cat, k.identity.Recipient())
	if err != nil {
		t.Fatal(err)
	}
	if err := st.PutCatalog(keyID, ct); err != nil {
		t.Fatal(err)
	}
	got, isErr := callOp(t, session, "listItems", nil)
	var res struct {
		StructuredContent struct{ Result listOutput } `json:"structuredContent"`
	}
	json.Unmarshal([]byte(got), &res)
	if out := res.StructuredContent.Result; isErr || len(out.Items) != 1 || out.Items[0].Name != "fake-taken" || out.CatalogUpdatedAt == "" {
		t.Fatalf("list: %s", got)
	}
	if got, isErr := callOp(t, session, "generateItem", map[string]any{"name": "fake-taken"}); !isErr || !strings.Contains(got, "already exists") {
		t.Fatalf("generate on a name of the catalog: %s", got)
	}
}

func TestDepositImportTwiceMakesNoCopy(t *testing.T) {
	url, st, id, k, _ := depositVault(t)
	dir := t.TempDir()
	envFile := filepath.Join(dir, "remote.env")
	os.WriteFile(envFile, []byte("API_KEY=fake-api-value-1\nEMPTY=\n"), 0o600)
	bin := filepath.Join(dir, "bin")
	os.Mkdir(bin, 0o700)
	os.WriteFile(filepath.Join(bin, "ssh"), []byte("#!/bin/sh\ncat '"+envFile+"'\n"), 0o700)
	t.Setenv("PATH", bin+":"+os.Getenv("PATH"))
	config := filepath.Join(dir, "config")
	t.Setenv("XDG_CONFIG_HOME", config)
	os.MkdirAll(filepath.Join(config, "keyfold"), 0o700)
	os.WriteFile(filepath.Join(config, "keyfold", "sources.json"), []byte(`{"fake-src": {"host": "fake-host", "path": "/opt/.env", "environment": "prod"}}`), 0o600)

	session := mcpSession(t, depositOps(url, k))
	statuses := func() string {
		t.Helper()
		got, isErr := callOp(t, session, "importEnv", map[string]any{"source": "fake-src"})
		var res struct {
			StructuredContent struct{ Result importOutput } `json:"structuredContent"`
		}
		if json.Unmarshal([]byte(got), &res); isErr {
			t.Fatal(got)
		}
		var s []string
		for _, r := range res.StructuredContent.Result.Keys {
			s = append(s, r.Key+"="+r.Status)
		}
		return strings.Join(s, ",")
	}
	if got := statuses(); got != "API_KEY=deposited,EMPTY=missing" {
		t.Fatalf("first import: %s", got)
	}
	if got := statuses(); got != "API_KEY=already deposited,EMPTY=missing" {
		t.Fatalf("second import: %s", got)
	}
	items := deposited(t, st, id)
	if len(items) != 1 || items[0].Name != "fake-src.API_KEY" || items[0].Value != "fake-api-value-1" || items[0].Environment != "prod" {
		t.Fatalf("deposited %+v", items)
	}
}

func TestParseDepositKeyRefusesOtherStrings(t *testing.T) {
	for _, s := range []string{"", "kfdep1.a.b", "other.a.b.c", "kfdep1.tok.not-an-identity.age1xyz"} {
		if _, err := parseDepositKey(s); err == nil {
			t.Errorf("parseDepositKey(%q) accepted it", s)
		}
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// Both identities serve the same two tools; only the functions a script sees
// differ: a deposit key gets no kf.vaultHealth and still never a value.
func TestMCPSameToolsForBothIdentities(t *testing.T) {
	url, st, id, k, _ := depositVault(t)
	for name, o := range map[string]ops{"unlocked": unlockedOps(url), "deposit": depositOps(url, k)} {
		tools, err := mcpSession(t, o).ListTools(context.Background(), nil)
		if err != nil {
			t.Fatal(err)
		}
		var names []string
		for _, tool := range tools.Tools {
			names = append(names, tool.Name)
		}
		if got := strings.Join(names, " "); got != "execute search" {
			t.Errorf("%s tools = %q, want execute and search only", name, got)
		}
	}

	session := mcpSession(t, depositOps(url, k))
	if found, isErr := callTool(t, session, "search", map[string]any{}); isErr || strings.Contains(found, "kf.vaultHealth") || !strings.Contains(found, "kf.generateItem") {
		t.Errorf("deposit search = %s", found)
	}
	got, isErr := callTool(t, session, "execute", map[string]any{"code": `return {health: typeof kf.vaultHealth, gen: kf.generateItem({name: "fake-deposited", kind: "token"})}`})
	for _, want := range []string{`"health":"undefined"`, `"created":"fake-deposited"`, `"pending":true`} {
		if isErr || !strings.Contains(got, want) {
			t.Errorf("deposit execute lacks %s: %s", want, got)
		}
	}
	items := deposited(t, st, id)
	if len(items) != 1 || len(items[0].Value) < 16 || strings.Contains(got, items[0].Value) {
		t.Errorf("deposited %d items, or the result holds the value", len(items))
	}
}
