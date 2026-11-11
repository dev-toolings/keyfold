package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

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
