package api

import (
	"bytes"
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"filippo.io/age"
	"github.com/pquerna/otp/totp"

	"keyfold/internal/store"
	"keyfold/internal/vault"
)

func init() { vault.ScryptWorkFactor = 10 }

// setup starts an initialized server and returns it with its identity and data dir.
func setup(t *testing.T) (*httptest.Server, *age.X25519Identity, string) {
	t.Helper()
	ts, _, id, dir := setupServer(t)
	return ts, id, dir
}

// setupServer is setup, plus the server itself so a test can drive its clock.
func setupServer(t *testing.T) (*httptest.Server, *server, *age.X25519Identity, string) {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	s := newServer(st)
	ts := httptest.NewServer(s.handler())
	t.Cleanup(ts.Close)
	id, _ := age.GenerateX25519Identity()
	wrapped, err := vault.WrapIdentity(id, "fake-master-123")
	if err != nil {
		t.Fatal(err)
	}
	if code := call(t, ts, "POST", "/api/v1/init", "", map[string]any{"identity": wrapped, "recipient": id.Recipient().String()}, nil); code != http.StatusCreated {
		t.Fatalf("init: %d", code)
	}
	return ts, s, id, dir
}

func call(t *testing.T, ts *httptest.Server, method, path, token string, in, out any) int {
	t.Helper()
	var body io.Reader
	if in != nil {
		b, _ := json.Marshal(in)
		body = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, ts.URL+path, body)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if out != nil {
		json.NewDecoder(resp.Body).Decode(out)
	}
	return resp.StatusCode
}

type challengeResp struct {
	ID         string `json:"id"`
	Ciphertext []byte `json:"ciphertext"`
}

func login(t *testing.T, ts *httptest.Server, id age.Identity) string {
	t.Helper()
	var ch challengeResp
	call(t, ts, "POST", "/api/v1/challenge", "", nil, &ch)
	answer, err := vault.Decrypt(ch.Ciphertext, id)
	if err != nil {
		t.Fatal(err)
	}
	var s struct{ Token string }
	if code := call(t, ts, "POST", "/api/v1/session", "", map[string]any{"id": ch.ID, "answer": answer}, &s); code != http.StatusOK {
		t.Fatalf("session: %d", code)
	}
	return s.Token
}

func TestNoPlaintextOnDisk(t *testing.T) {
	ts, id, dir := setup(t)
	token := login(t, ts, id)
	fakes := []vault.Item{
		{V: vault.ItemVersion, Name: "fake-name-alpha", Kind: "login", Value: "fake-passphrase-123", Note: "fake-note-xyz", Username: "fake-user-xyz"},
		{V: vault.ItemVersion, Name: "fake-name-beta", Kind: "ssh-passphrase", Value: "fake-passphrase-456"},
	}
	for i, it := range fakes {
		ct, err := vault.EncryptItem(it, id.Recipient())
		if err != nil {
			t.Fatal(err)
		}
		path := "/api/v1/items/" + []string{"00000000000000000000000000000001", "00000000000000000000000000000002"}[i]
		if code := call(t, ts, "PUT", path, token, map[string]any{"ciphertext": ct}, nil); code != http.StatusNoContent {
			t.Fatalf("put: %d", code)
		}
	}
	var listed []store.Entry
	call(t, ts, "GET", "/api/v1/items", token, nil, &listed)
	if len(listed) != 2 {
		t.Fatalf("listed %d items, want 2", len(listed))
	}

	needles := []string{"fake-name-alpha", "fake-name-beta", "fake-passphrase-123", "fake-passphrase-456", "fake-note-xyz", "fake-user-xyz", "fake-master-123"}
	filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		for _, n := range needles {
			if bytes.Contains(data, []byte(n)) {
				t.Errorf("%s contains %q", path, n)
			}
		}
		return nil
	})
}

func TestNoTokenGets401(t *testing.T) {
	ts, _, _ := setup(t)
	for _, token := range []string{"", "0000000000000000000000000000000000000000000000000000000000000000"} {
		if code := call(t, ts, "GET", "/api/v1/items", token, nil, nil); code != http.StatusUnauthorized {
			t.Errorf("token %q: got %d, want 401", token, code)
		}
	}
}

func TestWrongAnswerGetsNoToken(t *testing.T) {
	ts, _, _ := setup(t)
	var ch challengeResp
	call(t, ts, "POST", "/api/v1/challenge", "", nil, &ch)
	var s struct{ Token string }
	code := call(t, ts, "POST", "/api/v1/session", "", map[string]any{"id": ch.ID, "answer": make([]byte, 32)}, &s)
	if code != http.StatusUnauthorized || s.Token != "" {
		t.Fatalf("got %d and token %q, want 401 and no token", code, s.Token)
	}
}

func TestForeignHostAndCrossSiteWriteGet403(t *testing.T) {
	ts, _, _ := setup(t)
	rebind, _ := http.NewRequest("GET", ts.URL+"/api/v1/identity", nil)
	rebind.Host = "evil.example"
	crossSite, _ := http.NewRequest("POST", ts.URL+"/api/v1/challenge", nil)
	crossSite.Header.Set("Origin", "http://evil.example")
	for name, req := range map[string]*http.Request{"foreign host": rebind, "cross-site write": crossSite} {
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Errorf("%s: got %d, want 403", name, resp.StatusCode)
		}
	}
}

// getIdentity fetches the encrypted identity with an optional session and TOTP code.
func getIdentity(t *testing.T, ts *httptest.Server, token, code string, out any) int {
	t.Helper()
	req, _ := http.NewRequest("GET", ts.URL+"/api/v1/identity", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if code != "" {
		req.Header.Set("X-TOTP-Code", code)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if out != nil {
		json.NewDecoder(resp.Body).Decode(out)
	}
	return resp.StatusCode
}

// enableTOTP turns the second factor on at the given time and returns its secret.
func enableTOTP(t *testing.T, ts *httptest.Server, token string, at time.Time) string {
	t.Helper()
	var setup struct{ Secret string }
	if code := call(t, ts, "POST", "/api/v1/totp/setup", token, nil, &setup); code != http.StatusOK || setup.Secret == "" {
		t.Fatalf("setup: %d", code)
	}
	if code := getIdentity(t, ts, "", "", nil); code != http.StatusOK {
		t.Fatalf("a pending TOTP is enforced: %d", code)
	}
	otp, _ := totp.GenerateCode(setup.Secret, at)
	if code := call(t, ts, "POST", "/api/v1/totp/enable", token, map[string]string{"code": otp}, nil); code != http.StatusNoContent {
		t.Fatalf("enable: %d", code)
	}
	return setup.Secret
}

func TestTOTPGatesIdentity(t *testing.T) {
	ts, s, id, _ := setupServer(t)
	clock := time.Unix(1_800_000_000, 0)
	s.now = func() time.Time { return clock }
	token := login(t, ts, id)
	secret := enableTOTP(t, ts, token, clock)
	clock = clock.Add(30 * time.Second)
	good, _ := totp.GenerateCode(secret, clock)

	if code := getIdentity(t, ts, "", "", nil); code != http.StatusForbidden {
		t.Errorf("no code: got %d, want 403", code)
	}
	if code := getIdentity(t, ts, "", "000000", nil); code != http.StatusForbidden {
		t.Errorf("wrong code: got %d, want 403", code)
	}
	if code := getIdentity(t, ts, "", good, nil); code != http.StatusOK {
		t.Errorf("good code: got %d, want 200", code)
	}
	if code := getIdentity(t, ts, "", good, nil); code != http.StatusForbidden {
		t.Errorf("replayed code: got %d, want 403", code)
	}
	if code := getIdentity(t, ts, token, "", nil); code != http.StatusOK {
		t.Errorf("live session: got %d, want 200", code)
	}
	// A wrong code on a password change must not end the session (403, not 401).
	if code := call(t, ts, "PUT", "/api/v1/identity", token, map[string]any{"identity": []byte(ageHeader + "x")}, nil); code != http.StatusForbidden {
		t.Errorf("password change without code: got %d, want 403", code)
	}
	if code := call(t, ts, "GET", "/api/v1/items", token, nil, nil); code != http.StatusOK {
		t.Errorf("session ended by a wrong code: %d", code)
	}
}

func TestTOTPLockout(t *testing.T) {
	ts, s, id, _ := setupServer(t)
	clock := time.Unix(1_800_000_000, 0)
	s.now = func() time.Time { return clock }
	secret := enableTOTP(t, ts, login(t, ts, id), clock)
	clock = clock.Add(30 * time.Second)
	for range totpMaxFailures {
		getIdentity(t, ts, "", "000000", nil)
	}
	good, _ := totp.GenerateCode(secret, clock)
	if code := getIdentity(t, ts, "", good, nil); code != http.StatusTooManyRequests {
		t.Fatalf("after %d wrong codes: got %d, want 429", totpMaxFailures, code)
	}
	clock = clock.Add(totpLockout + 30*time.Second)
	good, _ = totp.GenerateCode(secret, clock)
	if code := getIdentity(t, ts, "", good, nil); code != http.StatusOK {
		t.Fatalf("after the lockout: got %d, want 200", code)
	}
}

func TestDisableTOTP(t *testing.T) {
	ts, s, id, _ := setupServer(t)
	clock := time.Unix(1_800_000_000, 0)
	s.now = func() time.Time { return clock }
	token := login(t, ts, id)
	secret := enableTOTP(t, ts, token, clock)
	clock = clock.Add(30 * time.Second)
	good, _ := totp.GenerateCode(secret, clock)
	if code := call(t, ts, "POST", "/api/v1/totp/disable", token, map[string]string{"code": good}, nil); code != http.StatusNoContent {
		t.Fatalf("disable: %d", code)
	}
	if code := getIdentity(t, ts, "", "", nil); code != http.StatusOK {
		t.Fatalf("identity after disable: got %d, want 200", code)
	}
}

func TestChangePasswordKeepsItems(t *testing.T) {
	ts, id, _ := setup(t)
	token := login(t, ts, id)
	ct, err := vault.EncryptItem(vault.Item{V: vault.ItemVersion, Name: "fake-name", Kind: "token", Value: "fake-value-123"}, id.Recipient())
	if err != nil {
		t.Fatal(err)
	}
	call(t, ts, "PUT", "/api/v1/items/00000000000000000000000000000001", token, map[string]any{"ciphertext": ct}, nil)

	var before struct{ Identity []byte }
	getIdentity(t, ts, token, "", &before)
	current, err := vault.UnwrapIdentity(before.Identity, "fake-master-123")
	if err != nil {
		t.Fatal(err)
	}
	rewrapped, err := vault.WrapIdentity(current, "fake-new-master-456")
	if err != nil {
		t.Fatal(err)
	}
	if code := call(t, ts, "PUT", "/api/v1/identity", token, map[string]any{"identity": rewrapped}, nil); code != http.StatusNoContent {
		t.Fatalf("change password: %d", code)
	}

	var after struct{ Identity []byte }
	getIdentity(t, ts, token, "", &after)
	if _, err := vault.UnwrapIdentity(after.Identity, "fake-master-123"); err == nil {
		t.Error("the old master password still opens the vault")
	}
	opened, err := vault.UnwrapIdentity(after.Identity, "fake-new-master-456")
	if err != nil {
		t.Fatal(err)
	}
	var listed []store.Entry
	call(t, ts, "GET", "/api/v1/items", token, nil, &listed)
	if len(listed) != 1 {
		t.Fatalf("listed %d items", len(listed))
	}
	if it, err := vault.DecryptItem(listed[0].Ciphertext, opened); err != nil || it.Value != "fake-value-123" {
		t.Fatalf("item unreadable after the change: %v", err)
	}
}

func TestPutIfMatch(t *testing.T) {
	ts, id, _ := setup(t)
	token := login(t, ts, id)
	path := "/api/v1/items/00000000000000000000000000000001"
	put := func(value, ifMatch string) int {
		t.Helper()
		ct, err := vault.EncryptItem(vault.Item{V: vault.ItemVersion, Name: "fake-name", Kind: "token", Value: value}, id.Recipient())
		if err != nil {
			t.Fatal(err)
		}
		b, _ := json.Marshal(map[string]any{"ciphertext": ct})
		req, _ := http.NewRequest("PUT", ts.URL+path, bytes.NewReader(b))
		req.Header.Set("Authorization", "Bearer "+token)
		if ifMatch != "" {
			req.Header.Set("If-Match", ifMatch)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	etag := func() string {
		t.Helper()
		var listed []store.Entry
		call(t, ts, "GET", "/api/v1/items", token, nil, &listed)
		return listed[0].ETag
	}

	if code := put("fake-value-1", "deadbeef"); code != http.StatusPreconditionFailed {
		t.Fatalf("If-Match on a missing item: %d, want 412", code)
	}
	if code := put("fake-value-1", ""); code != http.StatusNoContent {
		t.Fatalf("create: %d", code)
	}
	first := etag()
	if code := put("fake-value-2", first); code != http.StatusNoContent {
		t.Fatalf("update with the current ETag: %d", code)
	}
	if code := put("fake-value-3", first); code != http.StatusPreconditionFailed {
		t.Fatalf("update with a stale ETag: %d, want 412", code)
	}

	del := func(ifMatch string) int {
		t.Helper()
		req, _ := http.NewRequest("DELETE", ts.URL+path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("If-Match", ifMatch)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if code := del(first); code != http.StatusPreconditionFailed {
		t.Fatalf("delete with a stale ETag: %d, want 412", code)
	}
	if code := del(etag()); code != http.StatusNoContent {
		t.Fatalf("delete with the current ETag: %d", code)
	}
}

func TestChallengeFloodDoesNotLockOut(t *testing.T) {
	ts, s, id, _ := setupServer(t)
	now := time.Now()
	s.now = func() time.Time { return now }
	for range maxChallenges * 2 {
		now = now.Add(time.Millisecond)
		if code := call(t, ts, "POST", "/api/v1/challenge", "", nil, nil); code != http.StatusOK {
			t.Fatalf("challenge: %d", code)
		}
	}
	s.mu.Lock()
	pending := len(s.challenges)
	s.mu.Unlock()
	if pending != maxChallenges {
		t.Fatalf("%d pending challenges, want %d", pending, maxChallenges)
	}
	login(t, ts, id) // the owner still gets in
}

// rawCall sends body as is, for attachments.
func rawCall(t *testing.T, ts *httptest.Server, method, path, token string, body []byte) (int, []byte) {
	t.Helper()
	req, _ := http.NewRequest(method, ts.URL+path, bytes.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, out
}

func TestBlobOverOneMiB(t *testing.T) {
	ts, s, id, _ := setupServer(t)
	token := login(t, ts, id)
	plain := bytes.Repeat([]byte("fake-attachment "), 200_000) // 3.2 MB, past the 1 MiB item limit
	ct, err := vault.Encrypt(plain, id.Recipient())
	if err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/blobs/00000000000000000000000000000009"
	if code, _ := rawCall(t, ts, "PUT", path, "", ct); code != http.StatusUnauthorized {
		t.Fatalf("put without a session: %d", code)
	}
	if code, _ := rawCall(t, ts, "PUT", path, token, []byte("fake-plaintext")); code != http.StatusBadRequest {
		t.Fatalf("put of a non-age body: %d", code)
	}
	if code, out := rawCall(t, ts, "PUT", path, token, ct); code != http.StatusNoContent {
		t.Fatalf("put: %d %s", code, out)
	}
	code, got := rawCall(t, ts, "GET", path, token, nil)
	if code != http.StatusOK || !bytes.Equal(got, ct) {
		t.Fatalf("get: %d, %d bytes, want %d", code, len(got), len(ct))
	}

	s.maxBlob = 1 << 20
	if code, _ := rawCall(t, ts, "PUT", "/api/v1/blobs/0000000000000000000000000000000a", token, ct); code != http.StatusRequestEntityTooLarge {
		t.Fatalf("put over -max-blob: %d", code)
	}
	if code, _ := rawCall(t, ts, "GET", "/api/v1/blobs/0000000000000000000000000000000a", token, nil); code != http.StatusNotFound {
		t.Fatalf("a refused upload left a blob: %d", code)
	}
	if code, _ := rawCall(t, ts, "DELETE", path, token, nil); code != http.StatusNoContent {
		t.Fatalf("delete: %d", code)
	}
	if code, _ := rawCall(t, ts, "GET", path, token, nil); code != http.StatusNotFound {
		t.Fatalf("get after delete: %d", code)
	}
}

func TestItemBodyStillLimited(t *testing.T) {
	ts, id, _ := setup(t)
	token := login(t, ts, id)
	big := map[string]any{"ciphertext": bytes.Repeat([]byte("x"), 2<<20)}
	if code := call(t, ts, "PUT", "/api/v1/items/00000000000000000000000000000001", token, big, nil); code != http.StatusBadRequest {
		t.Fatalf("2 MiB item body: %d", code)
	}
}

func TestHealth(t *testing.T) {
	ts, id, _ := setup(t)
	if code := call(t, ts, "GET", "/api/v1/health", "", nil, nil); code != http.StatusUnauthorized {
		t.Fatalf("health without a session: %d", code)
	}
	token := login(t, ts, id)
	ct, _ := vault.EncryptItem(vault.Item{V: vault.ItemVersion, Name: "fake-name", Kind: "login", Value: "fake-value"}, id.Recipient())
	call(t, ts, "PUT", "/api/v1/items/00000000000000000000000000000001", token, map[string]any{"ciphertext": ct}, nil)
	blob, _ := vault.Encrypt([]byte("fake-attachment"), id.Recipient())
	rawCall(t, ts, "PUT", "/api/v1/blobs/00000000000000000000000000000002", token, blob)

	var h map[string]any
	if code := call(t, ts, "GET", "/api/v1/health", token, nil, &h); code != http.StatusOK {
		t.Fatalf("health: %d", code)
	}
	if h["items"] != 1.0 || h["blobs"] != 1.0 || h["blob_bytes"] != float64(len(blob)) || h["sessions"] != 1.0 || h["free_bytes"].(float64) <= 0 {
		t.Fatalf("health = %v", h)
	}
}
