package api

import (
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"regexp"
	"strings"
	"unicode/utf8"

	"filippo.io/age"

	"keyfold/internal/store"
)

// maxDeposit caps the ciphertext of one deposit: an item, never an attachment.
// The request carries it in base64, inside JSON: inboxBody leaves room for that.
const (
	maxDeposit = 64 << 10
	inboxBody  = maxDeposit*4/3 + 4<<10
)

// depositToken is the secret half of a deposit key: 32 random bytes in hex,
// made by the owner's browser and kept by the agent. The server keeps its hash.
var depositToken = regexp.MustCompile(`^[0-9a-f]{64}$`)

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// depositAuth runs next with the deposit key of an "Authorization: Deposit
// <token>" header. A deposit key reaches the inbox routes and nothing else:
// the session routes ask for "Bearer".
func (s *server) depositAuth(next func(http.ResponseWriter, *http.Request, store.DepositKey)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Deposit ")
		if !ok || !depositToken.MatchString(token) || !s.store.Initialized() {
			fail(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		keys, err := s.store.DepositKeys()
		if err != nil {
			internalError(w, err)
			return
		}
		sum := []byte(tokenHash(token))
		for _, k := range keys {
			if subtle.ConstantTimeCompare(sum, []byte(k.TokenHash)) == 1 {
				next(w, r, k)
				return
			}
		}
		fail(w, http.StatusUnauthorized, "unauthorized")
	}
}

// inboxPut stores a deposit. The id comes from the client, so a retry after a
// lost answer finds the deposit already there (200) instead of making a copy.
func (s *server) inboxPut(w http.ResponseWriter, r *http.Request, k store.DepositKey) {
	var req struct {
		ID         string `json:"id"`
		Ciphertext []byte `json:"ciphertext"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			fail(w, http.StatusRequestEntityTooLarge, "a deposit is 64 KiB at most")
		} else {
			fail(w, http.StatusBadRequest, "invalid JSON body")
		}
		return
	}
	if !store.ValidID(req.ID) {
		fail(w, http.StatusBadRequest, "invalid deposit id")
		return
	}
	if !bytes.HasPrefix(req.Ciphertext, []byte(ageHeader)) {
		fail(w, http.StatusBadRequest, "ciphertext is not an age file")
		return
	}
	if len(req.Ciphertext) > maxDeposit {
		fail(w, http.StatusRequestEntityTooLarge, "a deposit is 64 KiB at most")
		return
	}
	created, err := s.store.PutDeposit(k.ID, req.ID, req.Ciphertext)
	if errors.Is(err, store.ErrNoDepositKey) {
		fail(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if errors.Is(err, store.ErrDepositQuota) {
		fail(w, http.StatusInsufficientStorage, err.Error())
		return
	}
	if err != nil {
		internalError(w, err)
		return
	}
	if !created {
		writeJSON(w, http.StatusOK, map[string]string{"status": "already deposited"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"status": "deposited"})
}

// inboxCatalog returns the catalog the owner's client left for this key.
func (s *server) inboxCatalog(w http.ResponseWriter, r *http.Request, k store.DepositKey) {
	ct, updated, err := s.store.Catalog(k.ID)
	if errors.Is(err, os.ErrNotExist) {
		fail(w, http.StatusNotFound, "no catalog yet: the owner has not opened the vault since this key was created")
		return
	}
	if err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ciphertext": ct, "updated": updated})
}

func (s *server) listDepositKeys(w http.ResponseWriter, r *http.Request) {
	keys, err := s.store.DepositKeys()
	if err != nil {
		internalError(w, err)
		return
	}
	out := make([]map[string]any, 0, len(keys))
	for _, k := range keys {
		out = append(out, map[string]any{"id": k.ID, "name": k.Name, "recipient": k.Recipient, "created": k.Created})
	}
	writeJSON(w, http.StatusOK, out)
}

// createDepositKey registers a key the owner's browser made: the token's hash
// and the recipient of its catalog.
func (s *server) createDepositKey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name      string `json:"name"`
		Token     string `json:"token"`
		Recipient string `json:"recipient"`
	}
	if !decode(w, r, &req) {
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || utf8.RuneCountInString(name) > 64 {
		fail(w, http.StatusBadRequest, "name must hold 1 to 64 characters")
		return
	}
	if !depositToken.MatchString(req.Token) {
		fail(w, http.StatusBadRequest, "token must be 64 lowercase hex digits")
		return
	}
	if _, err := age.ParseX25519Recipient(req.Recipient); err != nil {
		fail(w, http.StatusBadRequest, "recipient is not an X25519 age recipient")
		return
	}
	k := store.DepositKey{ID: randomHex(16), Name: name, TokenHash: tokenHash(req.Token), Recipient: req.Recipient, Created: s.now().UTC()}
	if err := s.store.AddDepositKey(k); errors.Is(err, store.ErrDepositKeyQuota) {
		fail(w, http.StatusConflict, err.Error())
		return
	} else if err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": k.ID})
}

func (s *server) deleteDepositKey(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !store.ValidID(id) {
		fail(w, http.StatusBadRequest, "invalid deposit key id")
		return
	}
	if err := s.store.RemoveDepositKey(id); err != nil {
		internalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) putCatalog(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !store.ValidID(id) {
		fail(w, http.StatusBadRequest, "invalid deposit key id")
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
	if err := s.store.PutCatalog(id, req.Ciphertext); errors.Is(err, store.ErrNoDepositKey) {
		fail(w, http.StatusNotFound, "no such deposit key")
		return
	} else if err != nil {
		internalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// listDeposits returns the deposits waiting for review, with the name of the
// key that made each: the provenance comes from the server, not from the
// ciphertext a key holder writes.
func (s *server) listDeposits(w http.ResponseWriter, r *http.Request) {
	keys, err := s.store.DepositKeys()
	if err != nil {
		internalError(w, err)
		return
	}
	names := map[string]string{}
	for _, k := range keys {
		names[k.ID] = k.Name
	}
	deposits, err := s.store.Deposits()
	if err != nil {
		internalError(w, err)
		return
	}
	out := make([]map[string]any, 0, len(deposits))
	for _, d := range deposits {
		name, ok := names[d.KeyID]
		if !ok {
			continue // its key was revoked while it was listed
		}
		out = append(out, map[string]any{"keyId": d.KeyID, "keyName": name, "id": d.ID, "ciphertext": d.Ciphertext, "created": d.Created})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) deleteDeposit(w http.ResponseWriter, r *http.Request) {
	keyID, id := r.PathValue("key"), r.PathValue("id")
	if !store.ValidID(keyID) || !store.ValidID(id) {
		fail(w, http.StatusBadRequest, "invalid deposit id")
		return
	}
	if err := s.store.DeleteDeposit(keyID, id); err != nil {
		internalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
