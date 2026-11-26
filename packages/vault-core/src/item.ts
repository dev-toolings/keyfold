// The item format, shared with Go (internal/vault/vault.go). Version 1 items
// have no "v" field: they are read and upgraded in memory, never written.

export const ITEM_VERSION = 2;
// Older clients must refuse classified items rather than drop their fields on save.
export const CLASSIFIED_ITEM_VERSION = 3;
export const PROJECT_VERSION = 4;
// Older clients must refuse items with an environment to avoid dropping it on save.
export const ENVIRONMENT_ITEM_VERSION = 5;

export const ENVIRONMENTS = ["prod", "preprod", "local"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

function isEnvironment(value: unknown): value is Environment {
  return ENVIRONMENTS.some((environment) => environment === value);
}

export function checkEnvironment(value: unknown): Environment | undefined {
  if (value === undefined || value === "") return undefined;
  if (isEnvironment(value)) return value;
  throw new Error(`Environnement inconnu : ${String(value)}. Valeurs autorisées : ${ENVIRONMENTS.join(", ")}.`);
}

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
  project?: string;
  environment?: Environment;
  specialty?: string;
  languages?: string[];
  tags?: string[];
  /** ISO date set once at creation. Older items lack it (or hold ""): read it through createdAt(). */
  created_at?: string;
  updated_at: string;
};

/** A decrypted item. oldFormat: stored as v1, shown upgraded until `kf migrate -apply` rewrites it. */
export type Entry = { id: string; etag: string; item: Item; oldFormat: boolean };

export type Project = {
  v: typeof PROJECT_VERSION;
  kind: "project";
  name: string;
  /** Canonical name used by every client when checking native imports. */
  name_key: string;
  specialty?: string;
  languages?: string[];
  tags?: string[];
  created_at: string;
  updated_at: string;
};
export type ProjectEntry = { id: string; etag?: string; project: Project };

/**
 * The items of the vault that could be read, and the ids of the others: a
 * damaged file, one that is not an item, or a format newer than this code.
 */
export type Listing = { entries: Entry[]; projects: ProjectEntry[]; unreadable: string[] };

export function classificationKey(value: string): string {
  return value.trim().normalize().toLocaleLowerCase("fr");
}

export function isProject(value: unknown): value is Project {
  if (typeof value !== "object" || value === null) return false;
  const project = value as Record<string, unknown>;
  return (
    project.kind === "project" &&
    project.v === PROJECT_VERSION &&
    typeof project.name === "string" &&
    project.name.trim().length > 0 &&
    project.name_key === classificationKey(project.name) &&
    typeof project.created_at === "string" &&
    project.created_at !== "" &&
    typeof project.updated_at === "string" &&
    project.updated_at !== "" &&
    (project.value === undefined || project.value === "") &&
    (project.note === undefined || project.note === "") &&
    ["username", "totp", "folder", "project", "environment"].every(
      (key) => project[key] === undefined || project[key] === "",
    ) &&
    ["urls", "fields", "attachments", "history", "passkeys"].every((key) => {
      const value = project[key];
      return value === undefined || (Array.isArray(value) && value.length === 0);
    }) &&
    project.ssh_key === undefined &&
    (project.favorite === undefined || project.favorite === false) &&
    (project.specialty === undefined || typeof project.specialty === "string") &&
    [project.languages, project.tags].every(
      (labels) => labels === undefined || (Array.isArray(labels) && labels.every((label) => typeof label === "string")),
    )
  );
}

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
    (x.v === ITEM_VERSION || x.v === CLASSIFIED_ITEM_VERSION || x.v === ENVIRONMENT_ITEM_VERSION) &&
    KINDS.some((kind) => kind === x.kind) &&
    hasStrings(x, "name", "value", "note", "updated_at") &&
    [x.username, x.totp, x.folder, x.project, x.specialty, x.created_at].every((v) => optional(v, isString)) &&
    optional(x.environment, isEnvironment) &&
    optional(x.favorite, isBoolean) &&
    optionalList(x.urls, isString) &&
    optionalList(x.languages, isString) &&
    optionalList(x.tags, isString) &&
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

/**
 * Upgrades older items before validation by isItem and reports whether they were older.
 * Missing legacy strings default to empty strings, matching Go's JSON decoder.
 */
export function upgrade(
  raw: Omit<Item, "v" | "kind" | "value" | "note" | "updated_at" | "environment"> &
    Partial<Pick<Item, "value" | "note" | "updated_at">> & { v?: number; kind: string; environment?: unknown },
) {
  const v = raw.v ?? 1;
  if (v > ENVIRONMENT_ITEM_VERSION) throw new Error(`Élément au format v${v}, plus récent que cette application.`);
  if (v === PROJECT_VERSION) throw new Error("Le format v4 est réservé aux projets.");
  const { environment, ...fields } = raw;
  const checked = environment === null ? undefined : checkEnvironment(environment);
  const item = checked === undefined ? fields : { ...fields, environment: checked };
  if (v === ITEM_VERSION || v === CLASSIFIED_ITEM_VERSION || v === ENVIRONMENT_ITEM_VERSION)
    return { item, old: false };
  const kind = raw.kind === "password" ? "login" : raw.kind;
  const { value = "", note = "", updated_at = "" } = raw;
  return { item: { ...item, v: ITEM_VERSION, kind, value, note, updated_at }, old: true };
}
