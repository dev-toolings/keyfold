package vault

import (
	"encoding/json"
	"maps"
	"reflect"
	"strings"
	"testing"

	"filippo.io/age"
)

func init() { ScryptWorkFactor = 10 }

func TestRoundTrip(t *testing.T) {
	id, err := age.GenerateX25519Identity()
	if err != nil {
		t.Fatal(err)
	}
	wrapped, err := WrapIdentity(id, "fake-master-123")
	if err != nil {
		t.Fatal(err)
	}
	got, err := UnwrapIdentity(wrapped, "fake-master-123")
	if err != nil {
		t.Fatal(err)
	}
	if got.String() != id.String() {
		t.Fatal("unwrapped identity differs")
	}

	in := Item{
		V: ItemVersion, Name: "fake-name", Kind: "login", Value: "fake-passphrase-123", Note: "fake note",
		Username: "fake-user", URLs: []string{"https://fake.example"}, Fields: []Field{{Name: "pin", Value: "fake-0000", Hidden: true}},
		UpdatedAt: "2026-01-01T00:00:00Z",
	}
	ct, err := EncryptItem(in, id.Recipient())
	if err != nil {
		t.Fatal(err)
	}
	out, err := DecryptItem(ct, got)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(out, in) {
		t.Fatalf("got %+v, want %+v", out, in)
	}
}

func TestItemEnvironmentRoundTrip(t *testing.T) {
	id, err := age.GenerateX25519Identity()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, project, environment string
		version                    int
	}{
		{name: "plain", version: 2},
		{name: "project only", project: "fake-project", version: 3},
		{name: "environment only", environment: "prod", version: 5},
		{name: "both", project: "fake-project", environment: "preprod", version: 5},
	} {
		t.Run(tc.name, func(t *testing.T) {
			in := Item{V: ItemVersion, Name: "fake-name", Kind: "token", Project: tc.project, Environment: tc.environment}
			ct, err := EncryptItem(in, id.Recipient())
			if err != nil {
				t.Fatal(err)
			}
			out, err := DecryptItem(ct, id)
			if err != nil {
				t.Fatal(err)
			}
			in.V = tc.version
			if !reflect.DeepEqual(out, in) {
				t.Fatalf("got %+v, want %+v", out, in)
			}
		})
	}
}

func TestCheckRejectsUnknownEnvironment(t *testing.T) {
	it := Item{V: environmentItemVersion, Name: "fake-name", Kind: "token", Environment: "staging"}
	if err := Check(it); err == nil || !strings.Contains(err.Error(), "prod, preprod, local") {
		t.Fatalf("Check returned %v, want an error listing the allowed environments", err)
	}
}

func TestDecryptV5RequiredFields(t *testing.T) {
	id, err := age.GenerateX25519Identity()
	if err != nil {
		t.Fatal(err)
	}
	valid := map[string]any{"v": 5, "name": "fake-name", "kind": "token", "value": "", "note": "", "updated_at": "", "environment": nil}
	for _, field := range []string{"", "name", "kind", "value", "note", "updated_at"} {
		name := field
		if name == "" {
			name = "null environment"
		}
		t.Run(name, func(t *testing.T) {
			record := maps.Clone(valid)
			delete(record, field)
			plain, err := json.Marshal(record)
			if err != nil {
				t.Fatal(err)
			}
			ct, err := Encrypt(plain, id.Recipient())
			if err != nil {
				t.Fatal(err)
			}
			it, err := DecryptItem(ct, id)
			if field == "" {
				if err != nil || it.Environment != "" {
					t.Fatalf("null environment: got %q, %v", it.Environment, err)
				}
			} else if err == nil {
				t.Fatalf("accepted v5 without %s", field)
			}
		})
	}
}

func TestWrongMasterPassword(t *testing.T) {
	id, _ := age.GenerateX25519Identity()
	wrapped, err := WrapIdentity(id, "fake-master-123")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := UnwrapIdentity(wrapped, "fake-wrong-456"); err == nil {
		t.Fatal("wrong master password unwrapped the identity")
	}
}

func TestTamperedItemRejected(t *testing.T) {
	id, _ := age.GenerateX25519Identity()
	ct, err := EncryptItem(Item{V: ItemVersion, Name: "fake-name", Kind: "token", Value: "fake-value"}, id.Recipient())
	if err != nil {
		t.Fatal(err)
	}
	ct[len(ct)-1] ^= 1 // flip a bit in the payload
	if _, err := DecryptItem(ct, id); err == nil {
		t.Fatal("tampered item decrypted")
	}
}

func TestCheckMasterPassword(t *testing.T) {
	if err := CheckMasterPassword("fake-15-chars-x"); err == nil {
		t.Error("a 15 character master password was accepted")
	}
	if err := CheckMasterPassword("fake-16-chars-xy"); err != nil {
		t.Errorf("a 16 character master password was refused: %v", err)
	}
}

func TestOldFormatIsUpgradedNeverWritten(t *testing.T) {
	id, _ := age.GenerateX25519Identity()
	v1 := Item{Name: "fake-name", Kind: "password", Value: "fake-value-123"}
	if _, err := EncryptItem(v1, id.Recipient()); err == nil {
		t.Fatal("a v1 item was encrypted")
	}
	v2, changed := Upgrade(v1)
	if !changed || v2.V != ItemVersion || v2.Kind != "login" || v2.Value != v1.Value {
		t.Fatalf("Upgrade(v1) = %+v, %v", v2, changed)
	}
	if _, changed := Upgrade(v2); changed {
		t.Error("Upgrade changed a current item")
	}
	if _, err := EncryptItem(v2, id.Recipient()); err != nil {
		t.Fatalf("upgraded item refused: %v", err)
	}
}
