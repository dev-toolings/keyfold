package vault

import (
	"reflect"
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
