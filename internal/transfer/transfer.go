// Package transfer converts vault items to and from other password managers'
// export files. It works on plaintext: callers keep it off disk and terminals.
package transfer

import (
	"archive/zip"
	"bytes"
	"cmp"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"time"

	"keyfold/internal/vault"
)

// Formats lists the import formats; export knows "keyfold" and "bitwarden-json".
var Formats = []string{"keyfold", "bitwarden-json", "1password-1pux", "csv"}

// kindField carries a kf kind through a Bitwarden login, so a token or an SSH
// passphrase comes back as itself.
const kindField = "keyfold:kind"

// Import parses an export file. Skipped lists the entries it cannot hold
// (payment cards, unknown types), by name.
func Import(format string, data []byte, now time.Time) (items []vault.Item, skipped []string, err error) {
	stamp := now.UTC().Format(time.RFC3339)
	switch format {
	case "keyfold":
		err = json.Unmarshal(data, &items)
		for i := range items {
			items[i], _ = vault.Upgrade(items[i])
			items[i].Attachments = nil // their files are not in an export
		}
	case "bitwarden-json":
		items, skipped, err = fromBitwarden(data, stamp)
	case "1password-1pux":
		items, skipped, err = from1PUX(data, stamp)
	case "csv":
		items, err = fromCSV(data, stamp)
	default:
		return nil, nil, fmt.Errorf("unknown format %q (want one of %s)", format, strings.Join(Formats, ", "))
	}
	if err != nil {
		return nil, nil, err
	}
	for i := range items {
		if err := vault.Check(items[i]); err != nil {
			return nil, nil, err
		}
	}
	return items, skipped, nil
}

// Export encodes items as "keyfold" (the items themselves) or "bitwarden-json".
// Attachments are left out: their files are not part of an export, and a
// reference to a file of this server would dangle anywhere else.
func Export(format string, items []vault.Item) ([]byte, error) {
	items = slices.Clone(items)
	for i := range items {
		items[i].Attachments = nil
	}
	switch format {
	case "keyfold":
		return json.MarshalIndent(items, "", "  ")
	case "bitwarden-json":
		return toBitwarden(items)
	}
	return nil, fmt.Errorf("unknown export format %q (want keyfold or bitwarden-json)", format)
}

func newItem(name, kind, stamp string) vault.Item {
	return vault.Item{V: vault.ItemVersion, Name: name, Kind: kind, CreatedAt: stamp, UpdatedAt: stamp}
}

// --- Bitwarden (unencrypted JSON export) ---

type bwExport struct {
	Encrypted bool       `json:"encrypted"`
	Folders   []bwFolder `json:"folders"`
	Items     []bwItem   `json:"items"`
}

type bwFolder struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type bwItem struct {
	ID              string         `json:"id"`
	FolderID        *string        `json:"folderId"`
	Type            int            `json:"type"`
	Name            string         `json:"name"`
	Notes           *string        `json:"notes"`
	Favorite        bool           `json:"favorite"`
	Fields          []bwField      `json:"fields,omitempty"`
	Login           *bwLogin       `json:"login,omitempty"`
	SecureNote      *bwSecureNote  `json:"secureNote,omitempty"`
	Identity        map[string]any `json:"identity,omitempty"`
	SSHKey          *bwSSHKey      `json:"sshKey,omitempty"`
	PasswordHistory []bwHistory    `json:"passwordHistory,omitempty"`
	CreationDate    string         `json:"creationDate,omitempty"`
	RevisionDate    string         `json:"revisionDate,omitempty"`
}

type bwSecureNote struct {
	Type int `json:"type"`
}

type bwField struct {
	Name  string `json:"name"`
	Value string `json:"value"`
	Type  int    `json:"type"` // 0 text, 1 hidden, 2 boolean
}

type bwLogin struct {
	URIs     []bwURI `json:"uris,omitempty"`
	Username string  `json:"username,omitempty"`
	Password string  `json:"password,omitempty"`
	TOTP     string  `json:"totp,omitempty"`
}

type bwURI struct {
	URI string `json:"uri"`
}

type bwSSHKey struct {
	PrivateKey     string `json:"privateKey"`
	PublicKey      string `json:"publicKey"`
	KeyFingerprint string `json:"keyFingerprint"`
}

type bwHistory struct {
	LastUsedDate string `json:"lastUsedDate"`
	Password     string `json:"password"`
}

const (
	bwLoginType    = 1
	bwNoteType     = 2
	bwIdentityType = 4
	bwSSHKeyType   = 5
)

func fromBitwarden(data []byte, stamp string) ([]vault.Item, []string, error) {
	var ex bwExport
	if err := json.Unmarshal(data, &ex); err != nil {
		return nil, nil, errors.New("not a Bitwarden JSON export")
	}
	if ex.Encrypted {
		return nil, nil, errors.New("encrypted Bitwarden exports are not supported: export as unencrypted JSON")
	}
	folders := map[string]string{}
	for _, f := range ex.Folders {
		folders[f.ID] = f.Name
	}
	var items []vault.Item
	var skipped []string
	for _, b := range ex.Items {
		it := newItem(b.Name, "login", stamp)
		it.CreatedAt = cmp.Or(b.CreationDate, stamp)
		it.UpdatedAt = cmp.Or(b.RevisionDate, stamp)
		it.Favorite = b.Favorite
		if b.FolderID != nil {
			it.Folder = folders[*b.FolderID]
		}
		note := ""
		if b.Notes != nil {
			note = *b.Notes
		}
		switch b.Type {
		case bwLoginType:
			it.Note = note
			if b.Login != nil {
				it.Username, it.Value, it.TOTP = b.Login.Username, b.Login.Password, b.Login.TOTP
				for _, u := range b.Login.URIs {
					it.URLs = append(it.URLs, u.URI)
				}
			}
		case bwNoteType:
			it.Kind, it.Value = "note", note
		case bwIdentityType:
			it.Kind, it.Note = "identity", note
			keys := make([]string, 0, len(b.Identity))
			for k := range b.Identity {
				keys = append(keys, k)
			}
			slices.Sort(keys)
			for _, k := range keys {
				if s, ok := b.Identity[k].(string); ok && s != "" {
					it.Fields = append(it.Fields, vault.Field{Name: k, Value: s})
				}
			}
		case bwSSHKeyType:
			it.Kind, it.Note = "ssh-key", note
			if b.SSHKey != nil {
				it.SSHKey = &vault.SSHKey{Private: b.SSHKey.PrivateKey, Public: b.SSHKey.PublicKey, Fingerprint: b.SSHKey.KeyFingerprint}
			}
		default: // payment cards and types this vault does not hold
			skipped = append(skipped, b.Name)
			continue
		}
		for _, f := range b.Fields {
			if f.Name == kindField && slices.Contains(vault.Kinds, f.Value) {
				it.Kind = f.Value
				continue
			}
			it.Fields = append(it.Fields, vault.Field{Name: f.Name, Value: f.Value, Hidden: f.Type == 1})
		}
		for _, h := range b.PasswordHistory {
			if len(it.History) < vault.MaxHistory {
				it.History = append(it.History, vault.Revision{Value: h.Password, ChangedAt: h.LastUsedDate})
			}
		}
		items = append(items, it)
	}
	return items, skipped, nil
}

func toBitwarden(items []vault.Item) ([]byte, error) {
	ex := bwExport{Folders: []bwFolder{}, Items: []bwItem{}}
	folderIDs := map[string]string{}
	for i, it := range items {
		b := bwItem{
			ID: fmt.Sprintf("kf-%d", i), Name: it.Name, Favorite: it.Favorite,
			CreationDate: it.CreatedAt, RevisionDate: it.UpdatedAt,
		}
		if it.Folder != "" {
			id, ok := folderIDs[it.Folder]
			if !ok {
				id = fmt.Sprintf("kf-folder-%d", len(folderIDs))
				folderIDs[it.Folder] = id
				ex.Folders = append(ex.Folders, bwFolder{ID: id, Name: it.Folder})
			}
			b.FolderID = &id
		}
		note := it.Note
		switch it.Kind {
		case "note":
			b.Type, b.SecureNote = bwNoteType, &bwSecureNote{}
			note = strings.Join(slices.DeleteFunc([]string{it.Value, it.Note}, func(s string) bool { return s == "" }), "\n\n")
		case "ssh-key":
			b.Type = bwSSHKeyType
			if it.SSHKey != nil {
				b.SSHKey = &bwSSHKey{PrivateKey: it.SSHKey.Private, PublicKey: it.SSHKey.Public, KeyFingerprint: it.SSHKey.Fingerprint}
			}
		default:
			b.Type = bwLoginType
			b.Login = &bwLogin{Username: it.Username, Password: it.Value, TOTP: it.TOTP}
			for _, u := range it.URLs {
				b.Login.URIs = append(b.Login.URIs, bwURI{URI: u})
			}
			if it.Kind != "login" {
				b.Fields = append(b.Fields, bwField{Name: kindField, Value: it.Kind})
			}
		}
		if note != "" {
			b.Notes = &note
		}
		for _, f := range it.Fields {
			t := 0
			if f.Hidden {
				t = 1
			}
			b.Fields = append(b.Fields, bwField{Name: f.Name, Value: f.Value, Type: t})
		}
		for _, h := range it.History {
			b.PasswordHistory = append(b.PasswordHistory, bwHistory{LastUsedDate: h.ChangedAt, Password: h.Value})
		}
		ex.Items = append(ex.Items, b)
	}
	return json.MarshalIndent(ex, "", "  ")
}

// --- 1Password (.1pux: a zip holding export.data) ---

type opExport struct {
	Accounts []struct {
		Vaults []struct {
			Attrs struct {
				Name string `json:"name"`
			} `json:"attrs"`
			Items []opItem `json:"items"`
		} `json:"vaults"`
	} `json:"accounts"`
}

type opItem struct {
	CategoryUUID string `json:"categoryUuid"`
	FavIndex     int    `json:"favIndex"`
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`
	State        string `json:"state"`
	Overview     struct {
		Title string `json:"title"`
		URL   string `json:"url"`
		URLs  []struct {
			URL string `json:"url"`
		} `json:"urls"`
	} `json:"overview"`
	Details struct {
		LoginFields []struct {
			Value       string `json:"value"`
			Designation string `json:"designation"`
		} `json:"loginFields"`
		NotesPlain string `json:"notesPlain"`
		Password   string `json:"password"`
		Sections   []struct {
			Fields []struct {
				Title string                     `json:"title"`
				ID    string                     `json:"id"`
				Value map[string]json.RawMessage `json:"value"`
			} `json:"fields"`
		} `json:"sections"`
		PasswordHistory []struct {
			Value string `json:"value"`
			Time  int64  `json:"time"`
		} `json:"passwordHistory"`
	} `json:"details"`
}

// 1Password category ids.
var opKinds = map[string]string{
	"001": "login", "005": "login", "003": "note", "004": "identity",
	"112": "token", "114": "ssh-key",
}

func unixDate(sec int64, fallback string) string {
	if sec <= 0 {
		return fallback
	}
	return time.Unix(sec, 0).UTC().Format(time.RFC3339)
}

func from1PUX(data []byte, stamp string) ([]vault.Item, []string, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, nil, errors.New("not a 1Password .1pux file")
	}
	var raw []byte
	for _, f := range zr.File {
		if f.Name == "export.data" {
			r, err := f.Open()
			if err != nil {
				return nil, nil, err
			}
			raw, err = io.ReadAll(io.LimitReader(r, 64<<20))
			r.Close()
			if err != nil {
				return nil, nil, err
			}
		}
	}
	var ex opExport
	if raw == nil || json.Unmarshal(raw, &ex) != nil {
		return nil, nil, errors.New("the .1pux file has no readable export.data")
	}
	var items []vault.Item
	var skipped []string
	for _, a := range ex.Accounts {
		for _, v := range a.Vaults {
			for _, o := range v.Items {
				kind, ok := opKinds[o.CategoryUUID]
				if !ok || o.State == "trashed" {
					skipped = append(skipped, o.Overview.Title)
					continue
				}
				it := newItem(o.Overview.Title, kind, stamp)
				it.CreatedAt = unixDate(o.CreatedAt, stamp)
				it.UpdatedAt = unixDate(o.UpdatedAt, it.CreatedAt)
				it.Favorite = o.FavIndex > 0
				it.Folder = v.Attrs.Name
				it.Value = o.Details.Password
				if kind == "note" {
					it.Value = o.Details.NotesPlain
				} else {
					it.Note = o.Details.NotesPlain
				}
				for _, f := range o.Details.LoginFields {
					switch f.Designation {
					case "username":
						it.Username = f.Value
					case "password":
						it.Value = f.Value
					}
				}
				for _, u := range o.Overview.URLs {
					it.URLs = append(it.URLs, u.URL)
				}
				if len(it.URLs) == 0 && o.Overview.URL != "" {
					it.URLs = []string{o.Overview.URL}
				}
				for _, s := range o.Details.Sections {
					for _, f := range s.Fields {
						opField(&it, f.Title, f.ID, f.Value)
					}
				}
				for _, h := range o.Details.PasswordHistory {
					if len(it.History) < vault.MaxHistory {
						it.History = append(it.History, vault.Revision{Value: h.Value, ChangedAt: unixDate(h.Time, stamp)})
					}
				}
				items = append(items, it)
			}
		}
	}
	return items, skipped, nil
}

// opField maps one section field: a TOTP, an SSH key, an API credential, or
// a custom field when its value is a plain string.
func opField(it *vault.Item, title, id string, value map[string]json.RawMessage) {
	for typ, raw := range value {
		if typ == "sshKey" {
			var k struct {
				PrivateKey string `json:"privateKey"`
				Metadata   struct {
					PublicKey   string `json:"publicKey"`
					Fingerprint string `json:"fingerprint"`
				} `json:"metadata"`
			}
			if json.Unmarshal(raw, &k) == nil && k.PrivateKey != "" {
				it.SSHKey = &vault.SSHKey{Private: k.PrivateKey, Public: k.Metadata.PublicKey, Fingerprint: k.Metadata.Fingerprint}
			}
			return
		}
		var s string
		if json.Unmarshal(raw, &s) != nil || s == "" {
			return
		}
		switch {
		case typ == "totp":
			it.TOTP = s
		case it.Kind == "token" && id == "credential" && it.Value == "":
			it.Value = s
		default:
			it.Fields = append(it.Fields, vault.Field{Name: cmp.Or(title, id), Value: s, Hidden: typ == "concealed"})
		}
	}
}

// --- CSV (Chrome, Firefox, Bitwarden, 1Password and others) ---

// csvColumns maps the header names used by the common exporters.
var csvColumns = map[string]string{
	"name": "name", "title": "name",
	"url": "url", "login_uri": "url", "website": "url", "origin": "url",
	"username": "username", "login_username": "username", "user": "username",
	"password": "password", "login_password": "password",
	"totp": "totp", "login_totp": "totp", "otpauth": "totp",
	"notes": "note", "note": "note", "extra": "note",
	"folder": "folder", "grouping": "folder",
	"favorite": "favorite", "fav": "favorite",
	"type": "type",
}

func fromCSV(data []byte, stamp string) ([]vault.Item, error) {
	r := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))))
	r.FieldsPerRecord = -1
	rows, err := r.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("invalid CSV: %w", err)
	}
	if len(rows) < 1 {
		return nil, errors.New("empty CSV")
	}
	col := map[string]int{}
	for i, h := range rows[0] {
		if k, ok := csvColumns[strings.ToLower(strings.TrimSpace(h))]; ok {
			if _, seen := col[k]; !seen {
				col[k] = i
			}
		}
	}
	if _, ok := col["name"]; !ok {
		if _, ok := col["url"]; !ok {
			return nil, errors.New("the CSV header has neither a name nor a url column")
		}
	}
	get := func(row []string, k string) string {
		if i, ok := col[k]; ok && i < len(row) {
			return strings.TrimSpace(row[i])
		}
		return ""
	}
	var items []vault.Item
	for n, row := range rows[1:] {
		name := cmp.Or(get(row, "name"), get(row, "url"), fmt.Sprintf("import-%d", n+1))
		it := newItem(name, "login", stamp)
		it.Username, it.Value, it.TOTP, it.Note, it.Folder = get(row, "username"), get(row, "password"), get(row, "totp"), get(row, "note"), get(row, "folder")
		if u := get(row, "url"); u != "" {
			it.URLs = []string{u}
		}
		fav := strings.ToLower(get(row, "favorite"))
		it.Favorite = fav == "1" || fav == "true" || fav == "yes"
		if strings.EqualFold(get(row, "type"), "note") {
			it.Kind, it.Value, it.Note = "note", it.Note, ""
		}
		items = append(items, it)
	}
	return items, nil
}
