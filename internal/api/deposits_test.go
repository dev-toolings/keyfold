package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"filippo.io/age"

	"keyfold/internal/store"
	"keyfold/internal/vault"
)

// depositKeyFixture creates a deposit key through the owner API and returns its id and token.
func depositKeyFixture(t *testing.T, ts *httptest.Server, session string) (string, string) {
	t.Helper()
	token := strings.Repeat("ab", 32)
	agent, _ := age.GenerateX25519Identity()
	var out struct{ ID string }
	in := map[string]string{"name": "agent", "token": token, "recipient": agent.Recipient().String()}
	if code := call(t, ts, "POST", "/api/v1/deposit-keys", session, in, &out); code != http.StatusCreated || out.ID == "" {
		t.Fatalf("create deposit key: %d", code)
	}
	return out.ID, token
}

// inbox calls an inbox route with a deposit token.
func inbox(t *testing.T, ts *httptest.Server, method, path, auth string, in any) (int, []byte) {
	t.Helper()
	var body io.Reader
	if in != nil {
		b, _ := json.Marshal(in)
		body = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, ts.URL+path, body)
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, b
}

func depositFixture(t *testing.T, id *age.X25519Identity, name string) []byte {
	t.Helper()
	ct, err := vault.EncryptItem(vault.Item{V: vault.ItemVersion, Name: name, Kind: "token", Value: "fake-deposit-value"}, id.Recipient())
	if err != nil {
		t.Fatal(err)
	}
	return ct
}

func TestDepositStaysOutOfTheVault(t *testing.T) {
	ts, id, _ := setup(t)
	session := login(t, ts, id)
	keyID, token := depositKeyFixture(t, ts, session)
	depositID := strings.Repeat("1", 32)
	in := map[string]any{"id": depositID, "ciphertext": depositFixture(t, id, "aws-prod")}

	if code, _ := inbox(t, ts, "POST", "/api/v1/inbox", "Deposit "+token, in); code != http.StatusCreated {
		t.Fatalf("deposit: %d", code)
	}
	var items []store.Entry
	if code := call(t, ts, "GET", "/api/v1/items", session, nil, &items); code != http.StatusOK || len(items) != 0 {
		t.Fatalf("items after a deposit: %d, %d items; a deposit must stay out of the vault", code, len(items))
	}
	var deposits []struct{ KeyID, KeyName, ID string }
	if code := call(t, ts, "GET", "/api/v1/deposits", session, nil, &deposits); code != http.StatusOK || len(deposits) != 1 ||
		deposits[0].KeyID != keyID || deposits[0].KeyName != "agent" || deposits[0].ID != depositID {
		t.Fatalf("deposits: %d %+v", code, deposits)
	}

	// A retry with the same id finds it: no copy, the first one is kept.
	in["ciphertext"] = depositFixture(t, id, "other")
	if code, _ := inbox(t, ts, "POST", "/api/v1/inbox", "Deposit "+token, in); code != http.StatusOK {
		t.Fatalf("same deposit id again: %d, want 200", code)
	}
	call(t, ts, "GET", "/api/v1/deposits", session, nil, &deposits)
	if len(deposits) != 1 {
		t.Fatalf("a retry made %d deposits", len(deposits))
	}

	if code := call(t, ts, "DELETE", "/api/v1/deposits/"+keyID+"/"+depositID, session, nil, nil); code != http.StatusNoContent {
		t.Fatalf("delete deposit: %d", code)
	}
	call(t, ts, "GET", "/api/v1/deposits", session, nil, &deposits)
	if len(deposits) != 0 {
		t.Fatal("the deposit is still there after its deletion")
	}
}

func TestDepositKeyReachesOnlyTheInbox(t *testing.T) {
	ts, id, _ := setup(t)
	session := login(t, ts, id)
	_, token := depositKeyFixture(t, ts, session)
	in := map[string]any{"id": strings.Repeat("2", 32), "ciphertext": depositFixture(t, id, "x")}
	for _, auth := range []string{"", "Bearer " + session, "Deposit " + strings.Repeat("cd", 32), "Bearer " + token} {
		if code, _ := inbox(t, ts, "POST", "/api/v1/inbox", auth, in); code != http.StatusUnauthorized {
			t.Errorf("inbox with %.12q: %d, want 401", auth, code)
		}
	}
	for _, path := range []string{"/api/v1/items", "/api/v1/deposits", "/api/v1/deposit-keys", "/api/v1/health"} {
		if code, _ := inbox(t, ts, "GET", path, "Deposit "+token, nil); code != http.StatusUnauthorized {
			t.Errorf("GET %s with a deposit key: %d, want 401", path, code)
		}
	}
}

func TestRevokedDepositKeyLosesItsDeposits(t *testing.T) {
	ts, id, _ := setup(t)
	session := login(t, ts, id)
	keyID, token := depositKeyFixture(t, ts, session)
	in := map[string]any{"id": strings.Repeat("3", 32), "ciphertext": depositFixture(t, id, "x")}
	inbox(t, ts, "POST", "/api/v1/inbox", "Deposit "+token, in)
	if code := call(t, ts, "DELETE", "/api/v1/deposit-keys/"+keyID, session, nil, nil); code != http.StatusNoContent {
		t.Fatalf("revoke: %d", code)
	}
	var deposits []any
	call(t, ts, "GET", "/api/v1/deposits", session, nil, &deposits)
	if len(deposits) != 0 {
		t.Fatalf("%d deposit(s) of a revoked key remain", len(deposits))
	}
	in["id"] = strings.Repeat("4", 32)
	if code, _ := inbox(t, ts, "POST", "/api/v1/inbox", "Deposit "+token, in); code != http.StatusUnauthorized {
		t.Fatalf("deposit with a revoked key: %d, want 401", code)
	}
}

func TestDepositQuota(t *testing.T) {
	ts, s, id, _ := setupServer(t)
	session := login(t, ts, id)
	keyID, token := depositKeyFixture(t, ts, session)
	ct := depositFixture(t, id, "x")
	for i := range store.MaxDepositsPerKey {
		if _, err := s.store.PutDeposit(keyID, randomHex(16), ct); err != nil {
			t.Fatalf("deposit %d: %v", i, err)
		}
	}
	in := map[string]any{"id": randomHex(16), "ciphertext": ct}
	if code, _ := inbox(t, ts, "POST", "/api/v1/inbox", "Deposit "+token, in); code != http.StatusInsufficientStorage {
		t.Fatalf("deposit past the quota: %d, want 507", code)
	}
}

func TestCatalogForTheDepositKey(t *testing.T) {
	ts, id, _ := setup(t)
	session := login(t, ts, id)
	keyID, token := depositKeyFixture(t, ts, session)
	if code, _ := inbox(t, ts, "GET", "/api/v1/inbox/catalog", "Deposit "+token, nil); code != http.StatusNotFound {
		t.Fatalf("catalog before the owner wrote one: %d, want 404", code)
	}
	catalog := []byte(ageHeader + "fake catalog")
	if code := call(t, ts, "PUT", "/api/v1/deposit-keys/"+keyID+"/catalog", session, map[string]any{"ciphertext": catalog}, nil); code != http.StatusNoContent {
		t.Fatalf("put catalog: %d", code)
	}
	code, body := inbox(t, ts, "GET", "/api/v1/inbox/catalog", "Deposit "+token, nil)
	var out struct{ Ciphertext []byte }
	json.Unmarshal(body, &out)
	if code != http.StatusOK || !bytes.Equal(out.Ciphertext, catalog) {
		t.Fatalf("catalog: %d %q", code, out.Ciphertext)
	}
}

// A request authenticated just before a revocation must not write after it.
func TestDepositAfterRevocationIsRefused(t *testing.T) {
	ts, s, id, _ := setupServer(t)
	session := login(t, ts, id)
	keyID, _ := depositKeyFixture(t, ts, session)
	if err := s.store.RemoveDepositKey(keyID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.store.PutDeposit(keyID, randomHex(16), depositFixture(t, id, "x")); err != store.ErrNoDepositKey {
		t.Fatalf("deposit under a revoked key: %v, want ErrNoDepositKey", err)
	}
}

func TestDepositSizeLimit(t *testing.T) {
	ts, id, _ := setup(t)
	session := login(t, ts, id)
	_, token := depositKeyFixture(t, ts, session)
	near := append([]byte(ageHeader), bytes.Repeat([]byte("x"), 60<<10)...)
	if code, body := inbox(t, ts, "POST", "/api/v1/inbox", "Deposit "+token, map[string]any{"id": randomHex(16), "ciphertext": near}); code != http.StatusCreated {
		t.Fatalf("a 60 KiB deposit: %d %s", code, body)
	}
	over := append([]byte(ageHeader), bytes.Repeat([]byte("x"), 64<<10)...)
	if code, _ := inbox(t, ts, "POST", "/api/v1/inbox", "Deposit "+token, map[string]any{"id": randomHex(16), "ciphertext": over}); code != http.StatusRequestEntityTooLarge {
		t.Fatalf("a deposit over 64 KiB: %d, want 413", code)
	}
}

// "If-None-Match: *" writes an item only under a free id: a client moving a
// deposit again never overwrites the item an earlier run stored and the owner
// may have edited since.
func TestCreateOnlyItemWrite(t *testing.T) {
	ts, id, _ := setup(t)
	session := login(t, ts, id)
	put := func(ct []byte) int {
		b, _ := json.Marshal(map[string]any{"ciphertext": ct})
		req, _ := http.NewRequest("PUT", ts.URL+"/api/v1/items/"+strings.Repeat("5", 32), bytes.NewReader(b))
		req.Header.Set("Authorization", "Bearer "+session)
		req.Header.Set("If-None-Match", "*")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if code := put(depositFixture(t, id, "first")); code != http.StatusNoContent {
		t.Fatalf("create under a free id: %d", code)
	}
	if code := put(depositFixture(t, id, "second")); code != http.StatusPreconditionFailed {
		t.Fatalf("create under a taken id: %d, want 412", code)
	}
	var items []store.Entry
	call(t, ts, "GET", "/api/v1/items", session, nil, &items)
	it, _ := vault.DecryptItem(items[0].Ciphertext, id)
	if len(items) != 1 || it.Name != "first" {
		t.Fatalf("the first item was overwritten: %d items, %q", len(items), it.Name)
	}
}

func TestOversizeInboxBodyIs413(t *testing.T) {
	ts, id, _ := setup(t)
	session := login(t, ts, id)
	_, token := depositKeyFixture(t, ts, session)
	huge := append([]byte(ageHeader), bytes.Repeat([]byte("x"), 200<<10)...)
	if code, _ := inbox(t, ts, "POST", "/api/v1/inbox", "Deposit "+token, map[string]any{"id": randomHex(16), "ciphertext": huge}); code != http.StatusRequestEntityTooLarge {
		t.Fatalf("a body past the inbox limit: %d, want 413", code)
	}
}
