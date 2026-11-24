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

/**
 * The items of the vault that could be read, and the ids of the others: a
 * damaged file, one that is not an item, or a format newer than this code.
 */
export type Listing = { entries: Entry[]; unreadable: string[] };

/**
 * Checks the full shape of an upgraded item. Optional fields may be omitted,
 * but null is outside the Item type. Extra keys are allowed.
 */
export function isItem(x: unknown): x is Item {
  const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  const isString = (v: unknown) => typeof v === "string";
  const isBoolean = (v: unknown) => typeof v === "boolean";
  const hasStrings = (v: Record<string, unknown>, ...keys: string[]) => keys.every((key) => isString(v[key]));
  const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);
  const optionalList = (v: unknown, check: (v: unknown) => boolean) =>
    optional(v, (list) => Array.isArray(list) && list.every(check));

  return (
    isObject(x) &&
    x.v === ITEM_VERSION &&
    KINDS.some((kind) => kind === x.kind) &&
    hasStrings(x, "name", "value", "note", "updated_at") &&
    [x.username, x.totp, x.folder, x.created_at].every((v) => optional(v, isString)) &&
    optional(x.favorite, isBoolean) &&
    optionalList(x.urls, isString) &&
    optionalList(x.fields, (f) => isObject(f) && hasStrings(f, "name", "value") && optional(f.hidden, isBoolean)) &&
    optionalList(
      x.attachments,
      (a) => isObject(a) && hasStrings(a, "id", "name", "sha256") && typeof a.size === "number",
    ) &&
    optionalList(x.history, (r) => isObject(r) && hasStrings(r, "value", "changed_at")) &&
    optionalList(
      x.passkeys,
      (p) =>
        isObject(p) &&
        hasStrings(p, "credential_id", "rp_id", "user_handle", "user_name", "private_key", "created_at") &&
        typeof p.counter === "number",
    ) &&
    optional(
      x.ssh_key,
      (key) => isObject(key) && hasStrings(key, "private", "public", "fingerprint") && optional(key.agent, isBoolean),
    )
  );
}

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
