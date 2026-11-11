// The item format, shared with Go (internal/vault/vault.go). Version 1 items
// have no "v" field: they are read and upgraded in memory, never written.

export const ITEM_VERSION = 2;

export const KINDS = ["login", "token", "note", "identity", "ssh-key", "ssh-passphrase"] as const;
export type Kind = (typeof KINDS)[number];

export type Field = { name: string; value: string; hidden?: boolean };
export type BlobRef = { id: string; name: string; size: number; sha256: string };
export type Revision = { value: string; changed_at: string };
export type Passkey = {
  credential_id: string;
  rp_id: string;
  user_handle: string;
  user_name: string;
  /** Base64 PKCS#8 ES256 key. */
  private_key: string;
  counter: number;
  created_at: string;
};
export type SSHKey = { private: string; public: string; fingerprint: string; agent?: boolean };

export type Item = {
  v: number;
  name: string;
  kind: Kind;
  /** The main secret: password of a login, token, passphrase. */
  value: string;
  note: string;
  username?: string;
  urls?: string[];
  /** otpauth:// URI. */
  totp?: string;
  fields?: Field[];
  attachments?: BlobRef[];
  history?: Revision[];
  passkeys?: Passkey[];
  ssh_key?: SSHKey;
  favorite?: boolean;
  folder?: string;
  /** ISO date set once at creation. Older items lack it (or hold ""): read it through createdAt(). */
  created_at?: string;
  updated_at: string;
};

/** A decrypted item. oldFormat: stored as v1, shown upgraded until `kf migrate -apply` rewrites it. */
export type Entry = { id: string; etag: string; item: Item; oldFormat: boolean };

/** Creation date of an item, falling back to its last update when created_at is missing or empty. */
export function createdAt(item: Item): string {
  return item.created_at || item.updated_at;
}

/** Returns the item in the current format and whether it was older. Same rule as vault.Upgrade in Go. */
export function upgrade(raw: Omit<Item, "v" | "kind"> & { v?: number; kind: string }): { item: Item; old: boolean } {
  const v = raw.v ?? 1;
  if (v > ITEM_VERSION) throw new Error(`Élément au format v${v}, plus récent que cette application.`);
  if (v === ITEM_VERSION) return { item: raw as Item, old: false };
  const kind = (raw.kind === "password" ? "login" : raw.kind) as Kind;
  return { item: { ...raw, v: ITEM_VERSION, kind }, old: true };
}
