package api

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"
	"time"

	"github.com/pquerna/otp/totp"

	"keyfold/internal/logger"
)

const setupTestOwner = "owner@example.com"

type sentMail struct{ to, subject, body string }

// fakeMailer hands each email to the test: the server sends in the background.
type fakeMailer struct{ sent chan sentMail }

func newFakeMailer() *fakeMailer { return &fakeMailer{sent: make(chan sentMail, 10)} }

func (m *fakeMailer) Send(to, subject, body string) error {
	m.sent <- sentMail{to, subject, body}
	return nil
}

// next returns the next email, or false when none comes within a second.
func (m *fakeMailer) next() (sentMail, bool) {
	select {
	case mail := <-m.sent:
		return mail, true
	case <-time.After(time.Second):
		return sentMail{}, false
	}
}

// none reports whether no email arrives within 100 ms.
func (m *fakeMailer) none() bool {
	select {
	case <-m.sent:
		return false
	case <-time.After(100 * time.Millisecond):
		return true
	}
}

// setupTestServer returns a server on an empty vault with email setup on and a
// clock the test moves.
func setupTestServer(t *testing.T) (*server, http.Handler, *fakeMailer, *time.Time) {
	t.Helper()
	s := newServer(newInitTestStore(t))
	m := newFakeMailer()
	s.ownerEmail, s.mailer, s.installToken = setupTestOwner, m, ""
	now := time.Date(2026, 11, 26, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	return s, s.handler(), m, &now
}

// remote sends a JSON request as a client behind the local proxy, with an
// optional setup token, and returns the recorder.
func remote(t *testing.T, h http.Handler, method, path, setupToken string, in any) *httptest.ResponseRecorder {
	t.Helper()
	r := clientRequest(method, path, "192.0.2.1")
	if in != nil {
		b, _ := json.Marshal(in)
		r.Body = io.NopCloser(bytes.NewReader(b))
		r.Header.Set("Content-Type", "application/json")
	}
	if setupToken != "" {
		r.Header.Set(setupHeader, setupToken)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

var setupCodePattern = regexp.MustCompile(`\b[0-9]{6}\b`)

// askCode requests a code for the owner and returns the one in the email.
func askCode(t *testing.T, h http.Handler, m *fakeMailer) string {
	t.Helper()
	if w := remote(t, h, "POST", "/api/v1/setup/email", "", map[string]string{"email": "Owner@Example.com "}); w.Code != http.StatusNoContent {
		t.Fatalf("setup/email: got %d %s", w.Code, w.Body)
	}
	mail, ok := m.next()
	if !ok || mail.to != setupTestOwner {
		t.Fatal("no email sent to the owner")
	}
	code := setupCodePattern.FindString(mail.body)
	if code == "" {
		t.Fatal("the email holds no 6 digit code")
	}
	return code
}

func verifyCode(t *testing.T, h http.Handler, code string) (int, string) {
	t.Helper()
	w := remote(t, h, "POST", "/api/v1/setup/verify", "", map[string]string{"code": code})
	var out struct{ Token string }
	json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out.Token
}

func remoteInit(t *testing.T, h http.Handler, setupToken string) int {
	t.Helper()
	r, _ := initTestRequest(t, "192.0.2.1", "")
	if setupToken != "" {
		r.Header.Set(setupHeader, setupToken)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w.Code
}

func TestEmailSetupFromAnotherDevice(t *testing.T) {
	s, h, m, now := setupTestServer(t)
	var st map[string]bool
	json.Unmarshal(remote(t, h, "GET", "/api/v1/status", "", nil).Body.Bytes(), &st)
	if !st["emailSetup"] {
		t.Fatal("status must announce email setup")
	}
	if code := remoteInit(t, h, ""); code != http.StatusForbidden {
		t.Fatalf("remote init without an email code: got %d, want 403", code)
	}

	code, token := verifyCode(t, h, askCode(t, h, m))
	if code != http.StatusOK || token == "" {
		t.Fatalf("verify: got %d", code)
	}
	if code := remoteInit(t, h, token); code != http.StatusCreated {
		t.Fatalf("remote init with the setup token: got %d, want 201", code)
	}
	if w := remote(t, h, "GET", "/api/v1/identity", "", nil); w.Code != http.StatusForbidden {
		t.Fatalf("remote identity without the setup token: got %d, want 403", w.Code)
	}
	if w := remote(t, h, "GET", "/api/v1/identity", token, nil); w.Code != http.StatusOK {
		t.Fatalf("remote identity with the setup token: got %d, want 200", w.Code)
	}

	// A code still pending when TOTP turns on must not survive it.
	*now = now.Add(setupResendWait)
	pending := askCode(t, h, m)

	// Turn TOTP on: the setup token stops working and setup closes.
	session := randomHex(32)
	s.sessions[session] = sessionState{lastUsed: *now, expires: now.Add(time.Hour)}
	var totpSetup struct{ Secret string }
	r := clientRequest("POST", "/api/v1/totp/setup", "192.0.2.1")
	r.Header.Set("Authorization", "Bearer "+session)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	json.Unmarshal(w.Body.Bytes(), &totpSetup)
	otp, _ := totp.GenerateCode(totpSetup.Secret, *now)
	b, _ := json.Marshal(map[string]string{"code": otp})
	r = clientRequest("POST", "/api/v1/totp/enable", "192.0.2.1")
	r.Header.Set("Authorization", "Bearer "+session)
	r.Header.Set("Content-Type", "application/json")
	r.Body = io.NopCloser(bytes.NewReader(b))
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusNoContent {
		t.Fatalf("totp enable: got %d %s", w.Code, w.Body)
	}
	if s.validSetupToken(clientRequestWithSetup(token)) {
		t.Fatal("the setup token must end when TOTP is on")
	}
	if w := remote(t, h, "POST", "/api/v1/setup/email", "", map[string]string{"email": setupTestOwner}); w.Code != http.StatusConflict {
		t.Fatalf("setup/email once TOTP is on: got %d, want 409", w.Code)
	}
	if err := s.store.ClearTOTP(); err != nil {
		t.Fatal(err)
	}
	if code, _ := verifyCode(t, h, pending); code != http.StatusForbidden {
		t.Fatalf("a code from before TOTP was on, after TOTP is off again: got %d, want 403", code)
	}
}

func clientRequestWithSetup(token string) *http.Request {
	r := clientRequest("GET", "/", "192.0.2.1")
	r.Header.Set(setupHeader, token)
	return r
}

func TestEmailSetupOtherAddressGetsNoEmail(t *testing.T) {
	_, h, m, _ := setupTestServer(t)
	w := remote(t, h, "POST", "/api/v1/setup/email", "", map[string]string{"email": "intruder@example.com"})
	if w.Code != http.StatusNoContent || !m.none() {
		t.Fatalf("another address: got %d or an email, want 204 and none", w.Code)
	}
}

func TestEmailSetupCodeIsUsedOnce(t *testing.T) {
	_, h, m, _ := setupTestServer(t)
	c := askCode(t, h, m)
	if code, _ := verifyCode(t, h, c); code != http.StatusOK {
		t.Fatalf("first use: got %d", code)
	}
	if code, _ := verifyCode(t, h, c); code != http.StatusForbidden {
		t.Fatalf("second use: got %d, want 403", code)
	}
}

func TestEmailSetupCodeExpires(t *testing.T) {
	_, h, m, now := setupTestServer(t)
	c := askCode(t, h, m)
	*now = now.Add(setupCodeTTL)
	if code, _ := verifyCode(t, h, c); code != http.StatusForbidden {
		t.Fatalf("expired code: got %d, want 403", code)
	}
}

func TestEmailSetupCodeDroppedAfterFiveFailures(t *testing.T) {
	_, h, m, _ := setupTestServer(t)
	c := askCode(t, h, m)
	wrong := "000000"
	if c == wrong {
		wrong = "111111"
	}
	for range setupCodeMaxFailures {
		if code, _ := verifyCode(t, h, wrong); code != http.StatusForbidden {
			t.Fatalf("wrong code: got %d, want 403", code)
		}
	}
	if code, _ := verifyCode(t, h, c); code != http.StatusForbidden {
		t.Fatalf("right code after 5 failures: got %d, want 403", code)
	}
}

func TestEmailSetupResendWaits(t *testing.T) {
	_, h, m, now := setupTestServer(t)
	first := askCode(t, h, m)
	if w := remote(t, h, "POST", "/api/v1/setup/email", "", map[string]string{"email": setupTestOwner}); w.Code != http.StatusNoContent || !m.none() {
		t.Fatalf("second request within a minute: got %d or an email, want 204 and none", w.Code)
	}
	if code, _ := verifyCode(t, h, first); code != http.StatusOK {
		t.Fatalf("the first code must stay valid: got %d", code)
	}
	*now = now.Add(setupResendWait)
	askCode(t, h, m)
}

func TestEmailSetupTokenExpires(t *testing.T) {
	_, h, m, now := setupTestServer(t)
	_, token := verifyCode(t, h, askCode(t, h, m))
	*now = now.Add(setupTokenTTL)
	if code := remoteInit(t, h, token); code != http.StatusForbidden {
		t.Fatalf("init with an expired setup token: got %d, want 403", code)
	}
}

func TestEmailSetupTurnsInstallTokenOff(t *testing.T) {
	var log bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(logger.New("production", &log))
	t.Cleanup(func() { slog.SetDefault(previous) })
	New(newInitTestStore(t), Options{OwnerEmail: setupTestOwner, Mailer: newFakeMailer()})
	if bytes.Contains(log.Bytes(), []byte("installToken")) {
		t.Fatal("with email setup on, startup must not log an install token")
	}
}
