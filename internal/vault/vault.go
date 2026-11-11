// Package vault wraps the age operations shared by the CLI and the tests:
// the passphrase-protected identity and the encrypted items.
package vault

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"slices"

	"filippo.io/age"
)

// ScryptWorkFactor is the scrypt logN used to protect the identity.
// Tests lower it; 18 is the age default.
var ScryptWorkFactor = 18

// MinMasterPasswordLength is enforced when a vault is created. The encrypted
// identity can be downloaded by anyone who reaches the server, so the master
// password is the only barrier against an offline attack.
const MinMasterPasswordLength = 16

// CheckMasterPassword rejects a master password too short for a new vault.
func CheckMasterPassword(password string) error {
	if len([]rune(password)) < MinMasterPasswordLength {
		return fmt.Errorf("the master password needs at least %d characters", MinMasterPasswordLength)
	}
	return nil
}

// ItemVersion is the item format written by this code. Version 1 items have
// no "v" field; `kf migrate` rewrites them.
const ItemVersion = 2

// Item is the plaintext of one items/<id>.age file. Value is the main secret:
// the password of a login, the token, the note text is in Note.
type Item struct {
	V           int        `json:"v,omitempty"`
	Name        string     `json:"name"`
	Kind        string     `json:"kind"`
	Value       string     `json:"value"`
	Note        string     `json:"note"`
	Username    string     `json:"username,omitempty"`
	URLs        []string   `json:"urls,omitempty"`
	TOTP        string     `json:"totp,omitempty"` // otpauth:// URI
	Fields      []Field    `json:"fields,omitempty"`
	Attachments []BlobRef  `json:"attachments,omitempty"`
	History     []Revision `json:"history,omitempty"`
	Passkeys    []Passkey  `json:"passkeys,omitempty"`
	SSHKey      *SSHKey    `json:"ssh_key,omitempty"`
	Favorite    bool       `json:"favorite,omitempty"`
	Folder      string     `json:"folder,omitempty"`
	CreatedAt   string     `json:"created_at"`
	UpdatedAt   string     `json:"updated_at"`
}

// Field is a custom field. Hidden fields are masked like a password.
type Field struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Hidden bool   `json:"hidden,omitempty"`
}

// BlobRef points to an encrypted attachment stored apart from the item.
type BlobRef struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

// Revision is a previous value of the item.
type Revision struct {
	Value     string `json:"value"`
	ChangedAt string `json:"changed_at"`
}

// Passkey is a WebAuthn credential kept in the vault. PrivateKey is a
// base64 PKCS#8 ES256 key.
type Passkey struct {
	CredentialID string `json:"credential_id"`
	RPID         string `json:"rp_id"`
	UserHandle   string `json:"user_handle"`
	UserName     string `json:"user_name"`
	PrivateKey   string `json:"private_key"`
	Counter      uint32 `json:"counter"`
	CreatedAt    string `json:"created_at"`
}

// SSHKey is an SSH key pair. Agent marks the keys the SSH agent may serve.
type SSHKey struct {
	Private     string `json:"private"`
	Public      string `json:"public"`
	Fingerprint string `json:"fingerprint"`
	Agent       bool   `json:"agent,omitempty"`
}

// Kinds lists the item kinds of the current format.
var Kinds = []string{"login", "token", "note", "identity", "ssh-key", "ssh-passphrase"}

// Upgrade returns it in the current format and whether anything changed.
// Version 1 differs only by its "password" kind, now "login".
func Upgrade(it Item) (Item, bool) {
	if it.V >= ItemVersion {
		return it, false
	}
	if it.Kind == "password" {
		it.Kind = "login"
	}
	it.V = ItemVersion
	return it, true
}

// Check rejects an item that is not in the current format: old versions are
// read, never written.
func Check(it Item) error {
	if it.V != ItemVersion {
		return fmt.Errorf("item %q is format v%d, want v%d", it.Name, it.V, ItemVersion)
	}
	if !slices.Contains(Kinds, it.Kind) {
		return fmt.Errorf("unknown kind %q", it.Kind)
	}
	return nil
}

// Encrypt encrypts plaintext to the given recipient.
func Encrypt(plaintext []byte, r age.Recipient) ([]byte, error) {
	var buf bytes.Buffer
	w, err := age.Encrypt(&buf, r)
	if err != nil {
		return nil, err
	}
	if _, err := w.Write(plaintext); err != nil {
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// Decrypt decrypts an age file with the given identity.
func Decrypt(ciphertext []byte, id age.Identity) ([]byte, error) {
	r, err := age.Decrypt(bytes.NewReader(ciphertext), id)
	if err != nil {
		return nil, err
	}
	return io.ReadAll(r)
}

// WrapIdentity encrypts the identity string with the master password.
func WrapIdentity(id *age.X25519Identity, password string) ([]byte, error) {
	r, err := age.NewScryptRecipient(password)
	if err != nil {
		return nil, err
	}
	r.SetWorkFactor(ScryptWorkFactor)
	return Encrypt([]byte(id.String()), r)
}

// UnwrapIdentity decrypts the identity file with the master password.
// The error never contains the password or the identity.
func UnwrapIdentity(data []byte, password string) (*age.X25519Identity, error) {
	sid, err := age.NewScryptIdentity(password)
	if err != nil {
		return nil, err
	}
	plain, err := Decrypt(data, sid)
	if err != nil {
		return nil, fmt.Errorf("wrong master password or damaged identity file")
	}
	id, err := age.ParseX25519Identity(string(plain))
	if err != nil {
		return nil, fmt.Errorf("identity file does not hold an X25519 identity")
	}
	return id, nil
}

// EncryptItem encodes and encrypts an item to the recipient. Only items in
// the current format are accepted.
func EncryptItem(it Item, r age.Recipient) ([]byte, error) {
	if err := Check(it); err != nil {
		return nil, err
	}
	plain, err := json.Marshal(it)
	if err != nil {
		return nil, err
	}
	return Encrypt(plain, r)
}

// DecryptItem decrypts and decodes an item file.
func DecryptItem(ciphertext []byte, id age.Identity) (Item, error) {
	var it Item
	plain, err := Decrypt(ciphertext, id)
	if err != nil {
		return it, err
	}
	if err := json.Unmarshal(plain, &it); err != nil {
		return it, fmt.Errorf("item is not valid JSON")
	}
	if it.V > ItemVersion {
		return it, fmt.Errorf("item is format v%d, newer than this program (v%d)", it.V, ItemVersion)
	}
	return it, nil
}
