package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"keyfold/internal/vault"
)

// storeItem stores it straight in the vault, with the agent identity's recipient.
func storeItem(t *testing.T, url string, it vault.Item) {
	t.Helper()
	c := &client{base: url}
	id, _, err := c.open()
	if err != nil {
		t.Fatal(err)
	}
	defer c.logout()
	it.V = vault.ItemVersion
	if err := c.put(newEntry(), it, id.Recipient()); err != nil {
		t.Fatal(err)
	}
}

func TestReadRunInject(t *testing.T) {
	url, _, _ := setupVault(t)
	storeItem(t, url, vault.Item{Name: "fake-db", Kind: "login", Value: "fake-pw-123", Username: "fake-user",
		Fields: []vault.Field{{Name: "host", Value: "fake-host"}}})
	var stderr bytes.Buffer

	out := fileWith(t, "")
	if code := run([]string{"-server", url, "read", "kf://fake-db/host"}, fileWith(t, ""), out, &stderr); code != 0 {
		t.Fatalf("read: exit %d: %s", code, stderr.String())
	}
	if got, _ := os.ReadFile(out.Name()); string(got) != "fake-host\n" {
		t.Fatalf("read printed %q", got)
	}

	// run: the secret reaches the child through its environment only.
	out = fileWith(t, "")
	args := []string{"-server", url, "run", "-env", "FAKE_PW=kf://fake-db/password", "--", "sh", "-c", `printf %s "$FAKE_PW"; exit 3`}
	if code := run(args, fileWith(t, ""), out, &stderr); code != 3 {
		t.Fatalf("run: exit %d, want the child's 3: %s", code, stderr.String())
	}
	if got, _ := os.ReadFile(out.Name()); string(got) != "fake-pw-123" {
		t.Fatalf("child printed %q", got)
	}

	// inject: placeholders replaced, output private.
	dir := t.TempDir()
	tpl := filepath.Join(dir, "tpl")
	storeItem(t, url, vault.Item{Name: "fake site (2)", Kind: "token", Value: "fake-tok"})
	os.WriteFile(tpl, []byte("user={{ kf://fake-db/username }} pw={{kf://fake-db}} tok={{ kf://fake site (2)/value }}\n"), 0o644)
	dst := filepath.Join(dir, "out.env")
	if code := run([]string{"-server", url, "inject", "-i", tpl, "-o", dst}, fileWith(t, ""), fileWith(t, ""), &stderr); code != 0 {
		t.Fatalf("inject: exit %d: %s", code, stderr.String())
	}
	got, _ := os.ReadFile(dst)
	info, _ := os.Stat(dst)
	if string(got) != "user=fake-user pw=fake-pw-123 tok=fake-tok\n" || info.Mode().Perm() != 0o600 {
		t.Fatalf("inject wrote %q with mode %v", got, info.Mode().Perm())
	}

	// An unknown reference writes nothing.
	os.WriteFile(tpl, []byte("{{ kf://fake-missing }}"), 0o644)
	bad := filepath.Join(dir, "bad")
	if code := run([]string{"-server", url, "inject", "-i", tpl, "-o", bad}, fileWith(t, ""), fileWith(t, ""), &stderr); code != 1 {
		t.Fatalf("inject with a missing item: exit %d", code)
	}
	if _, err := os.Stat(bad); !os.IsNotExist(err) {
		t.Fatal("inject wrote a file despite the error")
	}
}

func TestExportImport(t *testing.T) {
	url, st, id := setupVault(t)
	storeItem(t, url, vault.Item{Name: "fake-site", Kind: "login", Value: "fake-pw-123"})
	var stderr bytes.Buffer

	// Neither -encrypt nor -plaintext: refused before anything is read.
	if code := run([]string{"-server", url, "export"}, fileWith(t, ""), fileWith(t, ""), &stderr); code != 1 {
		t.Fatalf("export without a mode: exit %d", code)
	}
	if tty := openPTY(t); run([]string{"-server", url, "export", "-plaintext"}, fileWith(t, ""), tty, &stderr) != 1 {
		t.Fatal("plaintext export to a terminal was not refused")
	}

	file := filepath.Join(t.TempDir(), "export.json")
	if code := run([]string{"-server", url, "export", "-format", "bitwarden-json", "-plaintext", "-o", file}, fileWith(t, ""), fileWith(t, ""), &stderr); code != 0 {
		t.Fatalf("export: exit %d: %s", code, stderr.String())
	}
	if info, _ := os.Stat(file); info.Mode().Perm() != 0o600 {
		t.Fatalf("export mode %v", info.Mode().Perm())
	}

	// Importing the vault's own export adds nothing; a changed value comes in renamed.
	if code := run([]string{"-server", url, "import", "-format", "bitwarden-json", file}, fileWith(t, ""), fileWith(t, ""), &stderr); code != 0 {
		t.Fatalf("import: exit %d: %s", code, stderr.String())
	}
	data, _ := os.ReadFile(file)
	os.WriteFile(file, bytes.Replace(data, []byte("fake-pw-123"), []byte("fake-pw-456"), 1), 0o600)
	stderr.Reset()
	if code := run([]string{"-server", url, "import", "-format", "bitwarden-json", file}, fileWith(t, ""), fileWith(t, ""), &stderr); code != 0 {
		t.Fatalf("second import: exit %d: %s", code, stderr.String())
	}
	if !strings.Contains(stderr.String(), "1 item(s) imported") {
		t.Fatalf("stderr %q", stderr.String())
	}
	if _, it := item(t, st, id, "fake-site (2)"); it.Value != "fake-pw-456" {
		t.Fatalf("renamed item %+v", it)
	}
	if entries, _ := st.Items(); len(entries) != 2 {
		t.Fatalf("%d items, want 2", len(entries))
	}
}

func TestUnreadableItemDoesNotHideTheOthers(t *testing.T) {
	url, st, _ := setupVault(t)
	storeItem(t, url, vault.Item{Name: "fake-db", Kind: "login", Value: "fake-pw-123"})
	const damaged = "000000000000000000000000000000dd"
	if err := st.Put(damaged, []byte("not an age file"), ""); err != nil {
		t.Fatal(err)
	}
	kf := func(args ...string) (int, string, string) {
		t.Helper()
		var stderr bytes.Buffer
		out := fileWith(t, "")
		code := run(append([]string{"-server", url}, args...), fileWith(t, ""), out, &stderr)
		buf := make([]byte, 256)
		n, _ := out.ReadAt(buf, 0)
		return code, string(buf[:n]), stderr.String()
	}

	// The list covers a part of the vault only: it says so and exits 3.
	code, stdout, stderr := kf("list")
	if code != 3 || stdout != "fake-db\tlogin\n" || !strings.Contains(stderr, damaged) {
		t.Errorf("list: exit %d, stdout %q, stderr %q", code, stdout, stderr)
	}
	// A readable secret is still handed out, and the session still works.
	code, stdout, stderr = kf("read", "kf://fake-db/value")
	if code != 0 || stdout != "fake-pw-123\n" || !strings.Contains(stderr, "cannot be read") {
		t.Errorf("read: exit %d, stdout %q, stderr %q", code, stdout, stderr)
	}
	if code, _, _ := kf("migrate"); code != 3 {
		t.Errorf("migrate: exit %d, want 3", code)
	}
	// run hands out the readable secret and keeps the code of its command.
	if code, _, stderr := kf("run", "-env", "FAKE_PW=kf://fake-db/value", "--", "sh", "-c", `[ "$FAKE_PW" = fake-pw-123 ] && exit 7`); code != 7 || !strings.Contains(stderr, damaged) {
		t.Errorf("run: exit %d, stderr %q; want the command's code 7 and the warning", code, stderr)
	}

	// The name of the damaged item is unknown: nothing may take a name for
	// free, and no file may pass for the whole vault.
	count := func() int {
		items, err := st.Items()
		if err != nil {
			t.Fatal(err)
		}
		return len(items)
	}
	before := count()
	export := filepath.Join(t.TempDir(), "export.json")
	if err := os.WriteFile(export, []byte("an earlier, whole export"), 0o600); err != nil {
		t.Fatal(err)
	}
	if code, _, stderr := kf("export", "-plaintext", "-o", export); code != 1 || !strings.Contains(stderr, "whole vault") {
		t.Errorf("export: exit %d, stderr %q", code, stderr)
	}
	if got, _ := os.ReadFile(export); string(got) != "an earlier, whole export" {
		t.Errorf("a refused export wrote over the earlier file: %q", got)
	}
	toImport := filepath.Join(t.TempDir(), "import.json")
	if err := os.WriteFile(toImport, []byte(`[{"v":2,"name":"fake-new","kind":"login","value":"fake-pw-456"}]`), 0o600); err != nil {
		t.Fatal(err)
	}
	if code, _, stderr := kf("import", "-format", "keyfold", toImport); code != 1 || !strings.Contains(stderr, "whole vault") {
		t.Errorf("import: exit %d, stderr %q", code, stderr)
	}
	set := func(name string) int {
		var stderr bytes.Buffer
		return run([]string{"-server", url, "set", name}, fileWith(t, "fake-pw-789\n"), fileWith(t, ""), &stderr)
	}
	if code := set("fake-other"); code != 1 {
		t.Errorf("set on a new name: exit %d, want 1", code)
	}
	if after := count(); after != before {
		t.Errorf("items in the store: %d, want %d: a refused command created one", after, before)
	}
	// A readable item can still be changed.
	if code := set("fake-db"); code != 0 {
		t.Errorf("set on an existing name: exit %d, want 0", code)
	}
	if code, stdout, _ := kf("read", "kf://fake-db/value"); code != 0 || stdout != "fake-pw-789\n" {
		t.Errorf("read after set: exit %d, stdout %q", code, stdout)
	}

	// The MCP tools say what they leave out, and refuse to create.
	ctx := context.Background()
	serverSide, clientSide := mcp.NewInMemoryTransports()
	if _, err := newMCPServer(url).Connect(ctx, serverSide, nil); err != nil {
		t.Fatal(err)
	}
	session, err := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "0"}, nil).Connect(ctx, clientSide, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	for tool, c := range map[string]struct {
		arguments map[string]any
		isError   bool
		want      string
	}{
		"list_items":    {map[string]any{}, false, `"unreadable":["` + damaged + `"]`},
		"vault_health":  {map[string]any{}, false, `"unreadable":["` + damaged + `"]`},
		"generate_item": {map[string]any{"name": "fake-generated"}, true, "whole vault"},
	} {
		res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: tool, Arguments: c.arguments})
		if err != nil {
			t.Fatalf("%s: %v", tool, err)
		}
		raw, _ := json.Marshal(res)
		if res.IsError != c.isError || !strings.Contains(string(raw), c.want) {
			t.Errorf("%s: error = %v, result %s", tool, res.IsError, raw)
		}
	}
	if after := count(); after != before {
		t.Errorf("items in the store: %d, want %d: generate_item created one", after, before)
	}

	// Without the damaged item, no warning and the usual exit code.
	if err := st.Delete(damaged, ""); err != nil {
		t.Fatal(err)
	}
	if code, _, stderr := kf("list"); code != 0 || stderr != "" {
		t.Errorf("list of a whole vault: exit %d, stderr %q", code, stderr)
	}
}
