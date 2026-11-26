// Package api serves the JSON API. It only ever handles ciphertext: the
// master password and the decrypted identity never reach the server.
package api

import (
	"bytes"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image/png"
	"io"
	"log/slog"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"filippo.io/age"
	"github.com/pquerna/otp/totp"

	"keyfold/internal/hosts"
	"keyfold/internal/logger"
	"keyfold/internal/store"
	"keyfold/internal/vault"
	"keyfold/internal/version"
)

// DefaultMaxBlob is the attachment size limit when none is given.
const DefaultMaxBlob = 100 << 20

const (
	alivePath    = "/api/v1/alive"
	maxBody      = 1 << 20
	challengeTTL = 60 * time.Second
	// maxChallenges bounds the memory held by unanswered challenges, which
	// anyone can request: past it, the oldest is dropped.
	maxChallenges     = 100
	sessionIdle       = 15 * time.Minute
	sessionMaxAge     = 12 * time.Hour
	maxClients        = 1024
	maxCallsPerMinute = 60

	// TOTP: a code is a 6 digit number, so guesses are rationed.
	totpMaxFailures = 5
	totpLockout     = 15 * time.Minute
	totpPeriod      = 30 // seconds, the RFC 6238 default
	totpHeader      = "X-TOTP-Code"
	ageHeader       = "age-encryption.org/v1\n"
	installHeader   = "X-Install-Token"

	// contentSecurityPolicy is sent with every response. The web UI loads its
	// own files only; the one outside call is the breach check (HIBP_RANGE_URL
	// in packages/vault-core/src/hibp.ts). Styles may be inline (chart colors,
	// React style attributes), scripts may not.
	contentSecurityPolicy = "default-src 'self'; connect-src 'self' https://api.pwnedpasswords.com; " +
		"img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; " +
		"base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
)

type challenge struct {
	answer  []byte
	expires time.Time
}

type sessionState struct {
	lastUsed time.Time
	expires  time.Time
}

type clientState struct {
	windowEnd    time.Time
	calls        int
	totpFailures int
	totpUntil    time.Time // expires both the failure count and any resulting lockout
}

type server struct {
	store   *store.Store
	maxBlob int64        // attachment size limit, in bytes
	hosts   []string     // host names accepted besides loopback ones
	web     http.Handler // built web UI, nil when the API is served alone

	now     func() time.Time // replaced by tests
	started time.Time

	initMu       sync.Mutex // guards vault creation and the install token
	installToken string
	initStore    func(identity []byte, recipient string) error // replaced by tests

	mu          sync.Mutex
	challenges  map[string]challenge
	sessions    map[string]sessionState
	clients     map[string]*clientState // remote clients only
	localClient clientState             // reserved for requests that pass hosts.Local

	totpLastStep int64 // last accepted time step: a code is used once
}

// Options configures the handler New returns.
type Options struct {
	// MaxBlob limits the size of one attachment, in bytes. Zero means DefaultMaxBlob.
	MaxBlob int64
	// Hosts are the host names accepted besides loopback ones, lower case and
	// without a port: the names a TLS reverse proxy in front of the server answers to.
	Hosts []string
	// Web serves the built web UI on every path outside /api/. Optional.
	Web http.Handler
}

// New returns the handler for the given store: the API under /api/ and, when
// o.Web is set, the web UI everywhere else, behind the same host check and
// access log.
func New(st *store.Store, o Options) http.Handler {
	s := newServer(st)
	if o.MaxBlob > 0 {
		s.maxBlob = o.MaxBlob
	}
	s.hosts = o.Hosts
	s.web = o.Web
	if s.installToken != "" {
		slog.Info("Use this install token to create the vault from a non-local device", "installToken", s.installToken)
	}
	return s.handler()
}

func newServer(st *store.Store) *server {
	s := &server{
		store: st, maxBlob: DefaultMaxBlob, now: time.Now, started: time.Now(),
		initStore:  st.Init,
		challenges: map[string]challenge{}, sessions: map[string]sessionState{}, clients: map[string]*clientState{},
	}
	if !st.Initialized() {
		s.installToken = randomHex(16)
	}
	return s
}

func (s *server) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+alivePath, alive)
	mux.HandleFunc("GET /api/v1/status", s.limitCalls(s.status))
	mux.HandleFunc("POST /api/v1/init", s.limitCalls(s.initVault))
	mux.HandleFunc("GET /api/v1/identity", s.limitCalls(s.identity))
	mux.HandleFunc("POST /api/v1/challenge", s.limitCalls(s.challenge))
	mux.HandleFunc("POST /api/v1/session", s.limitCalls(s.session))
	mux.HandleFunc("GET /api/v1/health", s.auth(s.health))
	mux.HandleFunc("GET /api/v1/items", s.auth(s.listItems))
	mux.HandleFunc("PUT /api/v1/items/{id}", s.auth(s.putItem))
	mux.HandleFunc("DELETE /api/v1/items/{id}", s.auth(s.deleteItem))
	mux.HandleFunc("PUT /api/v1/blobs/{id}", s.auth(s.putBlob))
	mux.HandleFunc("GET /api/v1/blobs/{id}", s.auth(s.getBlob))
	mux.HandleFunc("DELETE /api/v1/blobs/{id}", s.auth(s.deleteBlob))
	mux.HandleFunc("POST /api/v1/lock", s.auth(s.lock))
	mux.HandleFunc("PUT /api/v1/identity", s.auth(s.putIdentity))
	mux.HandleFunc("POST /api/v1/totp/setup", s.auth(s.totpSetup))
	mux.HandleFunc("POST /api/v1/totp/enable", s.auth(s.totpEnable))
	mux.HandleFunc("POST /api/v1/totp/disable", s.auth(s.totpDisable))
	if s.web != nil {
		mux.Handle("/api/", http.NotFoundHandler()) // an unknown API path is not a page of the UI
		mux.Handle("/", s.web)
	}
	return logger.Access(s.allowedHost(secure(http.NewCrossOriginProtection().Handler(s.limitBody(mux)))))
}

// limitsFor returns a client's state, or the wait for an available slot, with s.mu held.
func (s *server) limitsFor(r *http.Request, now time.Time) (*clientState, time.Duration) {
	if hosts.Local(r) {
		return &s.localClient, 0
	}
	address := hosts.Client(r)
	if client := s.clients[address]; client != nil {
		return client, 0
	}
	if len(s.clients) >= maxClients {
		var retry time.Duration
		for addr, client := range s.clients {
			// A slot frees when both the call window and the TOTP restriction expire.
			remaining := max(client.windowEnd.Sub(now), client.totpUntil.Sub(now))
			if remaining <= 0 {
				delete(s.clients, addr)
			} else if retry == 0 || remaining < retry {
				retry = remaining
			}
		}
		if len(s.clients) >= maxClients {
			// New remote clients wait while all slots have active restrictions.
			// This preserves call budgets and TOTP limits under address churn.
			return nil, retry
		}
	}
	client := &clientState{}
	s.clients[address] = client
	return client, 0
}

func retryAfter(wait time.Duration) string {
	return strconv.Itoa(int((wait + time.Second - 1) / time.Second))
}

// limitCalls gives each remote client one budget shared by the session-free routes.
func (s *server) limitCalls(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if hosts.Local(r) {
			next(w, r)
			return
		}
		s.mu.Lock()
		now := s.now()
		client, retry := s.limitsFor(r, now)
		if client != nil {
			if !now.Before(client.windowEnd) {
				client.windowEnd = now.Add(time.Minute)
				client.calls = 0
			}
			if client.calls < maxCallsPerMinute {
				client.calls++
				s.mu.Unlock()
				next(w, r)
				return
			}
			retry = client.windowEnd.Sub(now)
		}
		s.mu.Unlock()
		w.Header().Set("Retry-After", retryAfter(retry))
		fail(w, http.StatusTooManyRequests, "too many requests, try again later")
	}
}

// secure sets the response headers that keep the web UI, which holds the
// decrypted vault in memory, out of frames and free of foreign scripts. API
// answers (ciphertext, session tokens) are never cached. HSTS is sent on a
// declared host only: a loopback name is served over plain HTTP.
func secure(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h.Set("Cache-Control", "no-store")
		}
		if !hosts.Loopback(hosts.Name(r.Host)) {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		next.ServeHTTP(w, r)
	})
}

// limitBody caps request bodies: 1 MiB, or maxBlob for an attachment. It sets
// the limit on the request itself (no copy), so the route pattern the mux sets
// stays visible to logger.Access.
func (s *server) limitBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := int64(maxBody)
		if strings.HasPrefix(r.URL.Path, "/api/v1/blobs/") {
			n = s.maxBlob
		}
		r.Body = http.MaxBytesReader(w, r.Body, n)
		next.ServeHTTP(w, r)
	})
}

// allowedHost rejects requests whose Host is neither a loopback name nor one
// of the declared hosts. It stops DNS rebinding, where a hostile page reaches
// the server under its own domain name. Cross-site writes are rejected by
// http.CrossOriginProtection.
func (s *server) allowedHost(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if host := hosts.Name(r.Host); !hosts.Loopback(host) && !slices.Contains(s.hosts, host) {
			fail(w, http.StatusForbidden, "forbidden host")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// logInternalError logs err (paths and OS errors only, never content).
func logInternalError(w http.ResponseWriter, err error) {
	slog.Error("internal error", "err", err, "requestId", w.Header().Get("X-Request-Id"))
}

func internalError(w http.ResponseWriter, err error) {
	logInternalError(w, err)
	fail(w, http.StatusInternalServerError, "internal error")
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		fail(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}

func randomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *server) status(w http.ResponseWriter, r *http.Request) {
	t, err := s.store.TOTP()
	if err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"initialized": s.store.Initialized(), "totp": t.Enabled})
}

func (s *server) initVault(w http.ResponseWriter, r *http.Request) {
	s.initMu.Lock()
	defer s.initMu.Unlock()
	if s.store.Initialized() {
		fail(w, http.StatusConflict, "already initialized")
		return
	}
	if !hosts.Local(r) && (s.installToken == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get(installHeader)), []byte(s.installToken)) != 1) {
		fail(w, http.StatusForbidden, installHeader+" is required and must match the install token in the server log")
		return
	}
	var req struct {
		Identity  []byte `json:"identity"`
		Recipient string `json:"recipient"`
	}
	if !decode(w, r, &req) {
		return
	}
	if !bytes.HasPrefix(req.Identity, []byte(ageHeader)) {
		fail(w, http.StatusBadRequest, "identity is not an age file")
		return
	}
	if _, err := age.ParseX25519Recipient(req.Recipient); err != nil {
		fail(w, http.StatusBadRequest, "recipient is not an X25519 age recipient")
		return
	}
	if err := s.initStore(req.Identity, req.Recipient); err != nil {
		// A directory sync can fail after the identity has been written.
		if !s.store.Initialized() {
			internalError(w, err)
			return
		}
		logInternalError(w, err)
	}
	s.installToken = ""
	writeJSON(w, http.StatusCreated, map[string]bool{"initialized": true})
}

// identity hands out the encrypted identity. With TOTP off, only local
// requests can fetch it. With TOTP on, a valid code or live session is required.
func (s *server) identity(w http.ResponseWriter, r *http.Request) {
	if !s.store.Initialized() {
		fail(w, http.StatusNotFound, "not initialized")
		return
	}
	t, err := s.store.TOTP()
	if err != nil {
		internalError(w, err)
		return
	}
	if !t.Enabled && !hosts.Local(r) {
		fail(w, http.StatusForbidden, "Enable the second factor on the server machine first")
		return
	}
	if t.Enabled && !s.liveSession(r) {
		if code, msg := s.checkTOTP(w, r, t.Secret, r.Header.Get(totpHeader)); code != 0 {
			fail(w, code, msg)
			return
		}
	}
	id, rcpt, err := s.store.Identity()
	if err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"identity": id, "recipient": rcpt})
}

func (s *server) challenge(w http.ResponseWriter, r *http.Request) {
	if !s.store.Initialized() {
		fail(w, http.StatusNotFound, "not initialized")
		return
	}
	_, rcptStr, err := s.store.Identity()
	if err != nil {
		internalError(w, err)
		return
	}
	rcpt, err := age.ParseX25519Recipient(rcptStr)
	if err != nil {
		internalError(w, errors.New("stored recipient is invalid"))
		return
	}
	answer := make([]byte, 32)
	rand.Read(answer)
	ct, err := vault.Encrypt(answer, rcpt)
	if err != nil {
		internalError(w, err)
		return
	}
	id := randomHex(16)
	now := s.now()
	s.mu.Lock()
	for k, c := range s.challenges {
		if now.After(c.expires) {
			delete(s.challenges, k)
		}
	}
	// Full: drop the oldest instead of refusing, so a flood of requests cannot
	// lock the owner out. A real login answers its challenge within a second.
	if len(s.challenges) >= maxChallenges {
		oldest := ""
		for k, c := range s.challenges {
			if oldest == "" || c.expires.Before(s.challenges[oldest].expires) {
				oldest = k
			}
		}
		delete(s.challenges, oldest)
	}
	s.challenges[id] = challenge{answer: answer, expires: now.Add(challengeTTL)}
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "ciphertext": ct})
}

func (s *server) session(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID     string `json:"id"`
		Answer []byte `json:"answer"`
	}
	if !decode(w, r, &req) {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	c, ok := s.challenges[req.ID]
	delete(s.challenges, req.ID) // single use, whatever the answer
	if !ok || now.After(c.expires) || subtle.ConstantTimeCompare(c.answer, req.Answer) != 1 {
		fail(w, http.StatusUnauthorized, "challenge failed")
		return
	}
	token := randomHex(32)
	s.sessions[token] = sessionState{lastUsed: now, expires: now.Add(sessionMaxAge)}
	writeJSON(w, http.StatusOK, map[string]string{"token": token})
}

// liveSession reports whether r carries a live bearer token, and refreshes its idle timer.
func (s *server) liveSession(r *http.Request) bool {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	for k, session := range s.sessions {
		if now.Sub(session.lastUsed) > sessionIdle || !now.Before(session.expires) {
			delete(s.sessions, k)
		}
	}
	session, live := s.sessions[token]
	if ok && live {
		session.lastUsed = now
		s.sessions[token] = session
	}
	return ok && live
}

// auth rejects requests without a live bearer token.
func (s *server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.liveSession(r) {
			fail(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next(w, r)
	}
}

// checkTOTP returns 0 when code is valid for secret, else an HTTP status and a
// message. It accepts the previous, current and next 30 s window, refuses a
// code from a window already used, and locks the client out after 5 failures.
// The count and lockout expire 15 minutes after the last counted failure.
// A wrong code answers 403 so the caller's session stays open.
func (s *server) checkTOTP(w http.ResponseWriter, r *http.Request, secret, code string) (int, string) {
	s.mu.Lock()
	now := s.now()
	client, retry := s.limitsFor(r, now)
	if client == nil {
		s.mu.Unlock()
		w.Header().Set("Retry-After", retryAfter(retry))
		return http.StatusTooManyRequests, "too many requests, try again later"
	}
	defer s.mu.Unlock()
	if !now.Before(client.totpUntil) {
		client.totpFailures = 0
	}
	if client.totpFailures >= totpMaxFailures {
		return http.StatusTooManyRequests, "too many wrong TOTP codes, try again later"
	}
	if code == "" {
		return http.StatusForbidden, "TOTP code required"
	}
	for _, skew := range []int64{0, -1, 1} {
		at := now.Add(time.Duration(skew*totpPeriod) * time.Second)
		want, err := totp.GenerateCode(secret, at)
		if err != nil || subtle.ConstantTimeCompare([]byte(want), []byte(code)) != 1 {
			continue
		}
		if step := at.Unix() / totpPeriod; step > s.totpLastStep {
			s.totpLastStep = step
			client.totpFailures = 0
			client.totpUntil = time.Time{}
			return 0, ""
		}
		break // a replayed code counts as a failure
	}
	client.totpFailures++
	client.totpUntil = now.Add(totpLockout)
	return http.StatusForbidden, "invalid TOTP code"
}

// putIdentity stores the identity wrapped with a new master password. The
// browser checks the new file opens to the same recipient before sending it.
func (s *server) putIdentity(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Identity []byte `json:"identity"`
		Code     string `json:"code"`
	}
	if !decode(w, r, &req) {
		return
	}
	if !bytes.HasPrefix(req.Identity, []byte(ageHeader)) {
		fail(w, http.StatusBadRequest, "identity is not an age file")
		return
	}
	t, err := s.store.TOTP()
	if err != nil {
		internalError(w, err)
		return
	}
	if t.Enabled {
		if code, msg := s.checkTOTP(w, r, t.Secret, req.Code); code != 0 {
			fail(w, code, msg)
			return
		}
	}
	if err := s.store.SetIdentity(req.Identity); err != nil {
		internalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// totpSetup creates a pending secret and returns it with its QR code. It is
// only enforced once enabled with a first valid code.
var pngEncode = png.Encode

func (s *server) totpSetup(w http.ResponseWriter, r *http.Request) {
	t, err := s.store.TOTP()
	if err != nil {
		internalError(w, err)
		return
	}
	if t.Enabled {
		fail(w, http.StatusConflict, "TOTP is already enabled")
		return
	}
	key, err := totp.Generate(totp.GenerateOpts{Issuer: "Keyfold", AccountName: "vault"})
	if err != nil {
		internalError(w, err)
		return
	}
	img, err := key.Image(256, 256)
	if err != nil {
		internalError(w, err)
		return
	}
	var qr bytes.Buffer
	if err := pngEncode(&qr, img); err != nil {
		internalError(w, err)
		return
	}
	if err := s.store.SetTOTP(store.TOTP{Secret: key.Secret()}); err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"secret": key.Secret(),
		"uri":    key.URL(),
		"qr":     "data:image/png;base64," + base64.StdEncoding.EncodeToString(qr.Bytes()),
	})
}

func (s *server) totpEnable(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code string `json:"code"`
	}
	if !decode(w, r, &req) {
		return
	}
	t, err := s.store.TOTP()
	if err != nil {
		internalError(w, err)
		return
	}
	if t.Secret == "" || t.Enabled {
		fail(w, http.StatusConflict, "no pending TOTP setup")
		return
	}
	if code, msg := s.checkTOTP(w, r, t.Secret, req.Code); code != 0 {
		fail(w, code, msg)
		return
	}
	t.Enabled = true
	if err := s.store.SetTOTP(t); err != nil {
		internalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) totpDisable(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code string `json:"code"`
	}
	if !decode(w, r, &req) {
		return
	}
	t, err := s.store.TOTP()
	if err != nil {
		internalError(w, err)
		return
	}
	if !t.Enabled {
		fail(w, http.StatusConflict, "TOTP is not enabled")
		return
	}
	if code, msg := s.checkTOTP(w, r, t.Secret, req.Code); code != 0 {
		fail(w, code, msg)
		return
	}
	if err := s.store.ClearTOTP(); err != nil {
		internalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) listItems(w http.ResponseWriter, r *http.Request) {
	entries, err := s.store.Items()
	if err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, entries)
}

func (s *server) putItem(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !store.ValidID(id) {
		fail(w, http.StatusBadRequest, "invalid item id")
		return
	}
	var req struct {
		Ciphertext []byte `json:"ciphertext"`
	}
	if !decode(w, r, &req) {
		return
	}
	if !bytes.HasPrefix(req.Ciphertext, []byte(ageHeader)) {
		fail(w, http.StatusBadRequest, "ciphertext is not an age file")
		return
	}
	// If-Match carries the ETag the client read: a write over a newer
	// version fails instead of overwriting it in silence.
	if err := s.store.Put(id, req.Ciphertext, strings.Trim(r.Header.Get("If-Match"), `"`)); errors.Is(err, store.ErrConflict) {
		fail(w, http.StatusPreconditionFailed, "item changed since it was read")
		return
	} else if err != nil {
		internalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) deleteItem(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !store.ValidID(id) {
		fail(w, http.StatusBadRequest, "invalid item id")
		return
	}
	err := s.store.Delete(id, strings.Trim(r.Header.Get("If-Match"), `"`))
	if errors.Is(err, os.ErrNotExist) {
		fail(w, http.StatusNotFound, "no such item")
		return
	} else if errors.Is(err, store.ErrConflict) {
		fail(w, http.StatusPreconditionFailed, "item changed since it was read")
		return
	} else if err != nil {
		internalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) lock(w http.ResponseWriter, r *http.Request) {
	token, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	s.mu.Lock()
	delete(s.sessions, token)
	s.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

// putBlob stores an attachment, encrypted by the client, streamed to disk.
// Attachments are immutable: a new version gets a new id.
func (s *server) putBlob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !store.ValidID(id) {
		fail(w, http.StatusBadRequest, "invalid blob id")
		return
	}
	head := make([]byte, len(ageHeader))
	if _, err := io.ReadFull(r.Body, head); err != nil || string(head) != ageHeader {
		fail(w, http.StatusBadRequest, "attachment is not an age file")
		return
	}
	err := s.store.PutBlob(id, io.MultiReader(bytes.NewReader(head), r.Body))
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		fail(w, http.StatusRequestEntityTooLarge, "attachment too large")
		return
	} else if err != nil {
		internalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) getBlob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !store.ValidID(id) {
		fail(w, http.StatusBadRequest, "invalid blob id")
		return
	}
	f, err := s.store.Blob(id)
	if errors.Is(err, os.ErrNotExist) {
		fail(w, http.StatusNotFound, "no such attachment")
		return
	} else if err != nil {
		internalError(w, err)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	io.Copy(w, f)
}

func (s *server) deleteBlob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !store.ValidID(id) {
		fail(w, http.StatusBadRequest, "invalid blob id")
		return
	}
	err := s.store.DeleteBlob(id)
	if errors.Is(err, os.ErrNotExist) {
		fail(w, http.StatusNotFound, "no such attachment")
		return
	} else if err != nil {
		internalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func alive(w http.ResponseWriter, r *http.Request) {
	if !hosts.Local(r) {
		fail(w, http.StatusNotFound, "not found")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	io.WriteString(w, `{"alive":true}`)
}

// health reports what the server knows about the vault: counts and sizes of
// the ciphertext it stores, free disk space, sessions. It never sees a name
// or a value: content indicators are computed by the clients.
func (s *server) health(w http.ResponseWriter, r *http.Request) {
	u, err := s.store.Usage()
	if err != nil {
		internalError(w, err)
		return
	}
	t, err := s.store.TOTP()
	if err != nil {
		internalError(w, err)
		return
	}
	s.mu.Lock()
	sessions := len(s.sessions)
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"api":            "v1",
		"version":        version.Version,
		"items":          u.Items,
		"blobs":          u.Blobs,
		"blob_bytes":     u.BlobBytes,
		"free_bytes":     u.FreeBytes,
		"max_blob":       s.maxBlob,
		"totp":           t.Enabled,
		"sessions":       sessions,
		"uptime_seconds": int64(s.now().Sub(s.started).Seconds()),
	})
}
