package transfer

import (
	"archive/zip"
	"bytes"
	"reflect"
	"testing"
	"time"

	"keyfold/internal/vault"
)

var now = time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)

func TestBitwardenRoundTrip(t *testing.T) {
	stamp := "2026-01-01T00:00:00Z"
	items := []vault.Item{
		{V: 2, Name: "fake-login", Kind: "login", Value: "fake-pw", Note: "fake-note", Username: "fake-user",
			URLs: []string{"https://fake.example"}, TOTP: "otpauth://totp/fake?secret=JBSWY3DPEHPK3PXP",
			Fields:   []vault.Field{{Name: "pin", Value: "fake-pin", Hidden: true}},
			History:  []vault.Revision{{Value: "fake-old", ChangedAt: stamp}},
			Favorite: true, Folder: "fake-folder", CreatedAt: stamp, UpdatedAt: stamp},
		{V: 2, Name: "fake-token", Kind: "token", Value: "fake-tok", CreatedAt: stamp, UpdatedAt: stamp},
		{V: 2, Name: "fake-note", Kind: "note", Value: "fake-text", CreatedAt: stamp, UpdatedAt: stamp},
		{V: 2, Name: "fake-key", Kind: "ssh-key", CreatedAt: stamp, UpdatedAt: stamp,
			SSHKey: &vault.SSHKey{Private: "fake-priv", Public: "fake-pub", Fingerprint: "fake-fp"}},
	}
	data, err := Export("bitwarden-json", items)
	if err != nil {
		t.Fatal(err)
	}
	got, skipped, err := Import("bitwarden-json", data, now)
	if err != nil || len(skipped) != 0 {
		t.Fatal(err, skipped)
	}
	if !reflect.DeepEqual(got, items) {
		t.Fatalf("round trip:\n got %+v\nwant %+v", got, items)
	}
}

func TestBitwardenSkipsCards(t *testing.T) {
	data := []byte(`{"encrypted":false,"items":[{"type":3,"name":"fake-card"},{"type":1,"name":"fake-site","login":{"password":"fake-pw"}}]}`)
	got, skipped, err := Import("bitwarden-json", data, now)
	if err != nil || len(got) != 1 || got[0].Value != "fake-pw" || !reflect.DeepEqual(skipped, []string{"fake-card"}) {
		t.Fatalf("got %+v, skipped %v, err %v", got, skipped, err)
	}
}

func TestImport1PUX(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("export.data")
	w.Write([]byte(`{"accounts":[{"vaults":[{"attrs":{"name":"fake-vault"},"items":[
	 {"categoryUuid":"001","favIndex":1,"createdAt":1700000000,"updatedAt":1700000100,"state":"active",
	  "overview":{"title":"fake-site","urls":[{"url":"https://fake.example"}]},
	  "details":{"loginFields":[{"value":"fake-user","designation":"username"},{"value":"fake-pw","designation":"password"}],
	   "notesPlain":"fake-note",
	   "sections":[{"fields":[{"title":"one-time","id":"x","value":{"totp":"otpauth://totp/fake?secret=JBSWY3DPEHPK3PXP"}},
	                          {"title":"pin","id":"y","value":{"concealed":"fake-pin"}}]}],
	   "passwordHistory":[{"value":"fake-old","time":1600000000}]}},
	 {"categoryUuid":"002","overview":{"title":"fake-card"},"details":{}}
	]}]}]}`))
	zw.Close()
	got, skipped, err := Import("1password-1pux", buf.Bytes(), now)
	if err != nil || len(got) != 1 || !reflect.DeepEqual(skipped, []string{"fake-card"}) {
		t.Fatalf("got %+v, skipped %v, err %v", got, skipped, err)
	}
	it := got[0]
	if it.Kind != "login" || it.Username != "fake-user" || it.Value != "fake-pw" || it.Note != "fake-note" ||
		it.TOTP == "" || !it.Favorite || it.Folder != "fake-vault" || len(it.URLs) != 1 ||
		len(it.Fields) != 1 || !it.Fields[0].Hidden || len(it.History) != 1 || it.CreatedAt != "2023-11-14T22:13:20Z" {
		t.Fatalf("item %+v", it)
	}
}

func TestImportCSV(t *testing.T) {
	// Chrome's header, with a byte order mark and a quoted note.
	data := []byte("\xef\xbb\xbfname,url,username,password,note\nfake-site,https://fake.example,fake-user,fake-pw,\"fake, note\"\n")
	got, _, err := Import("csv", data, now)
	if err != nil || len(got) != 1 {
		t.Fatal(err, got)
	}
	if it := got[0]; it.Name != "fake-site" || it.Value != "fake-pw" || it.Note != "fake, note" || it.URLs[0] != "https://fake.example" {
		t.Fatalf("item %+v", it)
	}
}

func TestExportLeavesAttachmentsOut(t *testing.T) {
	items := []vault.Item{{V: 2, Name: "fake", Kind: "login", Attachments: []vault.BlobRef{{ID: "00000000000000000000000000000001", Name: "fake.txt"}}}}
	for _, f := range []string{"keyfold", "bitwarden-json"} {
		data, err := Export(f, items)
		if err != nil {
			t.Fatal(err)
		}
		got, _, err := Import(f, data, now)
		if err != nil || len(got) != 1 || got[0].Attachments != nil {
			t.Fatalf("%s: %+v %v", f, got, err)
		}
	}
	if items[0].Attachments == nil {
		t.Fatal("Export changed its input")
	}
}
