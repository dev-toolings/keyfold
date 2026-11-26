package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"filippo.io/age"

	"keyfold/internal/vault"
)

// Deposit mode: the MCP holds a deposit key, made in the web UI, instead of
// the unlocked identity. It encrypts new items for the vault's public key and
// deposits them; it cannot read a value, not even one it deposited. The
// owner's web UI moves deposits into the vault when it opens. Item names come
// from a catalog the web UI encrypts for the deposit key.

// depositKeyPrefix starts the KEYFOLD_DEPOSIT_KEY value the web UI shows once:
// kfdep1.<token>.<deposit identity>.<vault recipient>.
const depositKeyPrefix = "kfdep1"

type depositKey struct {
	token     string
	identity  *age.X25519Identity  // decrypts the catalog
	recipient *age.X25519Recipient // the vault's, pinned when the key was made
}

func parseDepositKey(s string) (depositKey, error) {
	parts := strings.Split(strings.TrimSpace(s), ".")
	if len(parts) != 4 || parts[0] != depositKeyPrefix {
		return depositKey{}, errors.New("KEYFOLD_DEPOSIT_KEY is not a deposit key: copy it again from the web UI (Settings, deposit keys)")
	}
	id, err := age.ParseX25519Identity(parts[2])
	if err != nil {
		return depositKey{}, errors.New("KEYFOLD_DEPOSIT_KEY: invalid identity part")
	}
	rcpt, err := age.ParseX25519Recipient(parts[3])
	if err != nil {
		return depositKey{}, errors.New("KEYFOLD_DEPOSIT_KEY: invalid vault recipient part")
	}
	return depositKey{token: parts[1], identity: id, recipient: rcpt}, nil
}

// depositID names a deposit made from known content, so a retry or a second
// import of the same value finds the first deposit instead of making a copy.
// It is keyed with the deposit identity: the server cannot test guesses of a
// value against it.
func (k depositKey) depositID(name, value string) string {
	key := sha256.Sum256([]byte("keyfold deposit id\x00" + k.identity.String()))
	mac := hmac.New(sha256.New, key[:])
	mac.Write([]byte(name + "\x00" + value))
	return hex.EncodeToString(mac.Sum(nil)[:16])
}

func (k depositKey) client(ctx context.Context, base string) *client {
	return &client{base: base, ctx: ctx, deposit: k.token}
}

// deposit encrypts it for the vault and deposits it under id. It reports
// false when that deposit was already made.
func (k depositKey) deposit(c *client, id string, it vault.Item) (bool, error) {
	ct, err := vault.EncryptItem(it, k.recipient)
	if err != nil {
		return false, err
	}
	var out struct {
		Status string `json:"status"`
	}
	if err := c.do("POST", "/api/v1/inbox", map[string]any{"id": id, "ciphertext": ct}, &out); err != nil {
		return false, err
	}
	return out.Status == "deposited", nil
}

// catalog returns the item names the web UI left for this key, and when.
func (k depositKey) catalog(c *client) ([]listedItem, string, error) {
	var r struct {
		Ciphertext []byte    `json:"ciphertext"`
		Updated    time.Time `json:"updated"`
	}
	if err := c.do("GET", "/api/v1/inbox/catalog", nil, &r); err != nil {
		return nil, "", err
	}
	plain, err := vault.Decrypt(r.Ciphertext, k.identity)
	if err != nil {
		return nil, "", errors.New("the catalog cannot be decrypted with this deposit key")
	}
	var cat struct {
		Items []listedItem `json:"items"`
	}
	if err := json.Unmarshal(plain, &cat); err != nil {
		return nil, "", fmt.Errorf("the catalog is not readable: %w", err)
	}
	return cat.Items, r.Updated.UTC().Format(time.RFC3339), nil
}

const (
	depositListDescription = "List the items of the Keyfold vault from the catalog of this deposit key: name, kind, optional project and environment (no dates). catalog_updated_at is when the owner's web UI last wrote it (the vault opened, or an item changed there): deposits appear after the owner accepts them. Never returns a value. Works without unlocking the vault."

	depositGenerateDescription = "Deposit a new vault item holding a freshly generated random secret. The value is generated and encrypted locally for the vault and is never returned; this key cannot read it back. " +
		"The item waits for review: once the owner opens the vault in the web UI, a new name is added, a name already taken waits for the owner's choice. Then read it with `kf get <name>` or in the web UI. " +
		"Fails if the catalog already lists the name. Works without unlocking the vault."

	depositImportDescription = "Deposit variables of a remote env file for the vault, as token items named \"<source>.<KEY>\". source is an alias the user declared in ~/.config/keyfold/sources.json (host, absolute path, sudo); the tool cannot read any other host or file. The source can set optional project and environment fields. kf reads the file over ssh and encrypts the values locally for the vault: the result holds names and a status per key only (deposited, already deposited: the same value was deposited before with this key, missing: absent or empty in the file). " +
		"Empty keys deposits every variable of the file. Once the owner opens the vault in the web UI, new names are added, values equal to the stored ones are dropped and the others wait for the owner's choice. Works without unlocking the vault."
)

// depositOps runs the tools with a deposit key: no unlock, no value read.
func depositOps(base string, k depositKey) ops {
	return ops{
		list: func(ctx context.Context) (listOutput, error) {
			items, updated, err := k.catalog(k.client(ctx, base))
			if err != nil {
				return listOutput{}, err
			}
			return listOutput{Items: items, Unreadable: []string{}, CatalogUpdatedAt: updated}, nil
		},
		generate: func(ctx context.Context, in generateInput) (generateOutput, error) {
			name, kind, err := checkGenerate(in)
			if err != nil {
				return generateOutput{}, err
			}
			c := k.client(ctx, base)
			if items, _, err := k.catalog(c); err == nil {
				for _, it := range items {
					if it.Name == name {
						return generateOutput{}, fmt.Errorf("an item named %q already exists", name)
					}
				}
			}
			now := time.Now().UTC().Format(time.RFC3339)
			it := vault.Item{V: vault.ItemVersion, Name: name, Kind: kind, Value: rand.Text(), CreatedAt: now, UpdatedAt: now}
			if _, err := k.deposit(c, newEntry().id, it); err != nil {
				return generateOutput{}, err
			}
			return generateOutput{Created: name, Kind: kind, Pending: true}, nil
		},
		importEnv: func(ctx context.Context, in importInput) (importOutput, error) {
			env, err := readEnv(ctx, in)
			if err != nil {
				return importOutput{}, err
			}
			c := k.client(ctx, base)
			now := time.Now().UTC().Format(time.RFC3339)
			out := importOutput{Source: in.Source, Keys: []importedKey{}}
			for _, key := range env.keys {
				r := importedKey{Key: key, Item: in.Source + "." + key}
				value := env.values[key]
				if value == "" {
					r.Status = "missing"
					out.Keys = append(out.Keys, r)
					continue
				}
				it := env.item(r.Item, value, now)
				created, err := k.deposit(c, k.depositID(r.Item, value), it)
				if err != nil {
					return importOutput{}, fmt.Errorf("%s: %w", r.Item, err)
				}
				r.Status = "deposited"
				if !created {
					r.Status = "already deposited"
				}
				out.Keys = append(out.Keys, r)
			}
			return out, nil
		},
		listDescription:     depositListDescription,
		generateDescription: depositGenerateDescription,
		importDescription:   depositImportDescription,
		requirement:         "Works with a deposit key, without unlocking the vault; nothing deposited reaches the vault before the owner opens it in the web UI.",
	}
}

// depositKeyFromEnv reads KEYFOLD_DEPOSIT_KEY.
func depositKeyFromEnv() (depositKey, error) {
	s := os.Getenv("KEYFOLD_DEPOSIT_KEY")
	if s == "" {
		return depositKey{}, errors.New("kf mcp -deposit needs KEYFOLD_DEPOSIT_KEY: create a deposit key in the web UI (Settings)")
	}
	return parseDepositKey(s)
}
