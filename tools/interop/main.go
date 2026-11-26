// Command interop is a test helper for packages/vault-core/src/interop.test.ts.
//
//	interop encrypt <password>              prints JSON {identity, recipient, item} made by Go
//	interop encrypt-environment <password>  does the same with a v5 item
//	interop encrypt-null-v2 <password>      encrypts a v2 item with a null environment
//	interop encrypt-null-v3 <password>      encrypts a v3 item with a null environment
//	interop encrypt-raw <password>          encrypts the raw JSON on stdin
//	interop decrypt <password>              reads that JSON on stdin (made by TypeScript)
//	                                        and prints the decrypted item as JSON
//
// It uses a low scrypt work factor and must only ever see fake values.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"filippo.io/age"

	"keyfold/internal/vault"
)

type bundle struct {
	Identity  []byte `json:"identity"`
	Recipient string `json:"recipient"`
	Item      []byte `json:"item"`
}

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: interop encrypt|encrypt-environment|encrypt-null-v2|encrypt-null-v3|encrypt-raw|decrypt <password>")
		os.Exit(2)
	}
	vault.ScryptWorkFactor = 10
	if err := run(os.Args[1], os.Args[2]); err != nil {
		fmt.Fprintln(os.Stderr, "interop:", err)
		os.Exit(1)
	}
}

func run(mode, password string) error {
	switch mode {
	case "encrypt", "encrypt-environment", "encrypt-null-v2", "encrypt-null-v3", "encrypt-raw":
		id, err := age.GenerateX25519Identity()
		if err != nil {
			return err
		}
		wrapped, err := vault.WrapIdentity(id, password)
		if err != nil {
			return err
		}
		if mode == "encrypt-raw" || mode == "encrypt-null-v2" || mode == "encrypt-null-v3" {
			var plain []byte
			switch mode {
			case "encrypt-raw":
				plain, err = io.ReadAll(os.Stdin)
				if err != nil {
					return err
				}
			case "encrypt-null-v2":
				plain = []byte(`{"v":2,"name":"fake-token","kind":"token","value":"","note":"","created_at":"","updated_at":"","environment":null}`)
			case "encrypt-null-v3":
				plain = []byte(`{"v":3,"name":"fake-token","kind":"token","value":"","note":"","created_at":"","updated_at":"","environment":null}`)
			}
			ct, err := vault.Encrypt(plain, id.Recipient())
			if err != nil {
				return err
			}
			return json.NewEncoder(os.Stdout).Encode(bundle{wrapped, id.Recipient().String(), ct})
		}
		item := vault.Item{
			V: vault.ItemVersion, Name: "fake-go-name", Kind: "login", Value: "fake-go-value-123", Note: "fake note é",
			Username: "fake-go-user", URLs: []string{"https://fake.example"},
			Fields:  []vault.Field{{Name: "fake-field", Value: "fake-field-value", Hidden: true}},
			Project: "fake-project", Specialty: "Backend", Languages: []string{"Go"}, Tags: []string{"fake-tag"},
			CreatedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z",
		}
		if mode == "encrypt-environment" {
			item.Environment = "preprod"
		}
		ct, err := vault.EncryptItem(item, id.Recipient())
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(bundle{wrapped, id.Recipient().String(), ct})
	case "decrypt":
		var b bundle
		if err := json.NewDecoder(os.Stdin).Decode(&b); err != nil {
			return err
		}
		id, err := vault.UnwrapIdentity(b.Identity, password)
		if err != nil {
			return err
		}
		if id.Recipient().String() != b.Recipient {
			return fmt.Errorf("recipient mismatch")
		}
		item, err := vault.DecryptItem(b.Item, id)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(item)
	}
	return fmt.Errorf("unknown mode %q", mode)
}
