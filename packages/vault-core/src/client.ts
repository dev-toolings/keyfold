// Talks to the vault server. By default the decrypted identity and token live only in memory.
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import {
  decrypt,
  decryptItem,
  encryptBytes,
  encryptItem,
  fromBase64,
  toBase64,
  unwrapIdentity,
  wrapIdentity,
} from "./crypto";
import { withValue } from "./generate";
import {
  type BlobRef,
  type Entry,
  type Item,
  isItem,
  isProject,
  type Listing,
  type Project,
  type ProjectEntry,
  upgrade,
} from "./item";

/** Thrown when the session is gone (lock, idle expiry, server restart). */
export class LockedError extends Error {}

/** Thrown when an item changed since it was read (HTTP 412), or an unseen item holds the requested name. */
export class ConflictError extends Error {}

/** Thrown when a deposit shown on the page is gone: its key was revoked, or another client settled it. */
export class GoneDepositError extends Error {}

/** Thrown when vault creation requires a valid install token. */
export class InstallTokenError extends Error {}

/** Checks the hostname of the page. The server decides whether the request is local. */
export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname.toLowerCase() === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    /^127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(hostname)
  );
}

/** Rejects any unseen name holder, then uses the page entry for the edited holder or the first holder. */
export function selectSaveTarget(
  entries: readonly Entry[],
  fresh: readonly Entry[],
  editedId: string | null,
  name: string,
): Entry | null {
  let target: Entry | undefined;
  for (const holder of fresh) {
    if (holder.item.name !== name) continue;
    const entry = entries.find((e) => e.id === holder.id);
    if (!entry) {
      throw new ConflictError(
        "Un élément portant ce nom a été ajouté ou renommé ailleurs entre-temps : rechargez la page et recommencez.",
      );
    }
    if (!target || entry.id === editedId) target = entry;
  }
  return target ?? entries.find((e) => e.id === editedId) ?? null;
}

/** emailSetup: a code sent to the owner's email can stand in for server access during setup. */
export type Status = { initialized: boolean; totp: boolean; emailSetup?: boolean };
/** GET /api/v1/health: what the server sees, ciphertext only. */
export type ServerHealth = {
  api: string;
  items: number;
  blobs: number;
  blob_bytes: number;
  free_bytes: number;
  max_blob: number;
  totp: boolean;
  sessions: number;
  uptime_seconds: number;
};
export type TotpSetup = { secret: string; uri: string; qr: string };

/** A deposit key as the server lists it: an agent that deposits items without unlocking the vault. */
export type DepositKeyInfo = { id: string; name: string; recipient: string; created: string };
/** A deposit whose name is taken by an item holding another value: the owner chooses. */
export type DepositConflict = { keyId: string; id: string; keyName: string; created: string; item: Item };
/**
 * What processDeposits did: names added to the vault, deposits dropped, conflicts left for the owner.
 * reload: the vault changed (here or by another client): list it again.
 * incomplete: an unreadable item stopped the run; the other deposits wait for the next opening.
 */
export type DepositReport = {
  added: string[];
  dropped: number;
  conflicts: DepositConflict[];
  reload: boolean;
  incomplete: boolean;
};
type RawDeposit = { keyId: string; keyName: string; id: string; ciphertext: string; created: string };
/** How the owner settles a conflict: new value with the old one in the history, a second item, or nothing. */
export type DepositChoice = "replace" | "keep-both" | "reject";

/** Same rule as the CLI (vault.MinMasterPasswordLength in Go). */
export const MIN_MASTER_PASSWORD_LENGTH = 16;

type Wrapped = { identity: string; recipient: string };

/** One item as GET /api/v1/items returns it. */
export type StoredItem = { id: string; etag: string; ciphertext: string };

/**
 * Decrypts every stored item it can, sorted by name. One that cannot be read
 * must not hide the others: its id goes to unreadable.
 */
export async function decryptEntries(raw: StoredItem[], identity: string): Promise<Listing> {
  const unreadable: string[] = [];
  const entries: Entry[] = [];
  const projects: ProjectEntry[] = [];
  await Promise.all(
    raw.map(async (r) => {
      try {
        const record = await decryptItem(fromBase64(r.ciphertext), identity);
        if (isProject(record)) {
          projects.push({ id: r.id, etag: r.etag, project: record });
          return;
        }
        const { item, old } = upgrade(record as Item);
        if (!isItem(item)) throw new Error("not an item");
        entries.push({ id: r.id, etag: r.etag, item, oldFormat: old });
      } catch {
        unreadable.push(r.id);
      }
    }),
  );
  entries.sort((a, b) => a.item.name.localeCompare(b.item.name));
  projects.sort((a, b) => a.project.name.localeCompare(b.project.name) || a.id.localeCompare(b.id));
  return { entries, projects, unreadable: unreadable.sort() };
}

export type VaultSession = { identity: string; recipient: string; token: string };

export class VaultClient {
  private identity: string | null = null;
  private recipient: string | null = null;
  private token: string | null = null;
  // Granted by a valid email code: lets this device create the vault and turn TOTP on.
  private setupToken: string | null = null;
  // The encrypted identity, kept after a download that cost a TOTP code: the
  // password is checked here, after the download, so a typo must not spend the
  // code (the server refuses it twice). It is ciphertext, dropped on success.
  private downloaded: Wrapped | null = null;

  /** baseURL: "" for the same origin, or the server URL (browser extension). */
  constructor(private readonly baseURL = "") {}

  /** Sends a request with the session token and turns error statuses into errors. */
  private async send(method: string, path: string, body?: BodyInit, extra?: Record<string, string>): Promise<Response> {
    const headers: Record<string, string> = { ...extra };
    const token = this.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (this.setupToken) headers["X-Setup-Token"] = this.setupToken;
    const res = await fetch(this.baseURL + path, { method, headers, body });
    if (res.status === 401 && token) {
      if (this.token === token) this.setSession(null);
      throw new LockedError("session expirée");
    }
    if (res.status === 404 && path === "/api/v1/status") {
      // A server started before the API moved under /api/v1 answers 404 here.
      throw new Error("Le serveur du coffre ne connaît pas cette version de l'API. Relancez-le (make dev).");
    }
    if (res.status === 412) {
      throw new ConflictError("Cet élément a été modifié ailleurs entre-temps : rechargez la page et recommencez.");
    }
    if (res.status === 413) {
      throw new Error("Pièce jointe trop volumineuse pour ce serveur (option -max-blob).");
    }
    if (res.status === 429) {
      throw new Error("Trop de codes incorrects : réessayez dans 15 minutes.");
    }
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 403 && path === "/api/v1/init" && e.error?.includes("X-Install-Token")) {
        throw new InstallTokenError(
          "Jeton d'installation manquant ou incorrect. Il figure dans le journal du serveur au premier démarrage.",
        );
      }
      if (path.startsWith("/api/v1/setup/")) {
        if (e.error === "wrong code") throw new Error("Code incorrect.");
        if (e.error === "no valid code, ask for a new one") {
          throw new Error("Ce code n'est plus valable : demandez-en un nouveau.");
        }
      }
      if (res.status === 403 && path === "/api/v1/init" && e.error?.includes("owner email")) {
        this.setupToken = null;
        throw new InstallTokenError("La vérification par email a expiré : demandez un nouveau code.");
      }
      if (res.status === 403 && e.error?.includes("TOTP")) {
        throw new Error(
          e.error === "TOTP code required" ? "Code de double authentification requis." : "Code incorrect.",
        );
      }
      throw new Error(e.error ?? `erreur serveur ${res.status}`);
    }
    return res;
  }

  private async api<T>(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<T> {
    const headers: Record<string, string> = { ...extra };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await this.send(method, path, body === undefined ? undefined : JSON.stringify(body), headers);
    return (res.status === 204 || res.status === 201 ? undefined : await res.json()) as T;
  }

  protected setSession(session: VaultSession | null): void {
    this.identity = session?.identity ?? null;
    this.recipient = session?.recipient ?? null;
    this.token = session?.token ?? null;
  }

  isUnlocked(): boolean {
    return this.token !== null;
  }

  status(): Promise<Status> {
    return this.api<Status>("GET", "/api/v1/status");
  }

  health(): Promise<ServerHealth> {
    return this.api<ServerHealth>("GET", "/api/v1/health");
  }

  /** Asks the server to email a setup code to the owner. The answer is the same for any address. */
  async requestSetupCode(email: string): Promise<void> {
    await this.api("POST", "/api/v1/setup/email", { email });
  }

  /** Trades the emailed code for a setup token, sent with the next requests until TOTP is on. */
  async verifySetupCode(code: string): Promise<void> {
    const r = await this.api<{ token: string }>("POST", "/api/v1/setup/verify", { code });
    this.setupToken = r.token;
  }

  /** First run: creates the identity, uploads it wrapped, then unlocks. */
  async create(password: string, installToken?: string): Promise<void> {
    if ([...password].length < MIN_MASTER_PASSWORD_LENGTH) {
      throw new Error(`Le mot de passe principal doit faire au moins ${MIN_MASTER_PASSWORD_LENGTH} caractères.`);
    }
    const id = await generateX25519Identity();
    const wrapped = await wrapIdentity(id, password);
    await this.api(
      "POST",
      "/api/v1/init",
      { identity: toBase64(wrapped), recipient: await identityToRecipient(id) },
      installToken ? { "X-Install-Token": installToken } : undefined,
    );
    await this.unlock(password);
  }

  /** True when a retry needs no new TOTP code. */
  hasDownloadedIdentity(): boolean {
    return this.downloaded !== null;
  }

  protected async unwrapIdentityForUnlock(wrappedIdentity: string, password: string): Promise<string | null> {
    try {
      return await unwrapIdentity(fromBase64(wrappedIdentity), password);
    } catch {
      return null;
    }
  }

  /** Decrypts the identity with the master password and opens a session. code: the TOTP code, when it is on. */
  async unlock(password: string, code?: string): Promise<void> {
    this.downloaded ??= await this.api<Wrapped>(
      "GET",
      "/api/v1/identity",
      undefined,
      code ? { "X-TOTP-Code": code } : undefined,
    );
    const r = this.downloaded;
    const id = await this.unwrapIdentityForUnlock(r.identity, password);
    if (id === null) {
      throw new Error("Mot de passe incorrect.");
    }
    if ((await identityToRecipient(id)) !== r.recipient) {
      throw new Error("L'identité ne correspond pas au coffre.");
    }
    const ch = await this.api<{ id: string; ciphertext: string }>("POST", "/api/v1/challenge");
    const answer = await decrypt(fromBase64(ch.ciphertext), id);
    const s = await this.api<{ token: string }>("POST", "/api/v1/session", { id: ch.id, answer: toBase64(answer) });
    this.setSession({ identity: id, recipient: r.recipient, token: s.token });
    this.downloaded = null;
  }

  /**
   * Wraps the same identity with a new master password. Items are untouched: they
   * stay encrypted to the same recipient. The new file is checked before upload.
   */
  async changePassword(current: string, next: string, code?: string): Promise<void> {
    if ([...next].length < MIN_MASTER_PASSWORD_LENGTH) {
      throw new Error(`Le nouveau mot de passe doit faire au moins ${MIN_MASTER_PASSWORD_LENGTH} caractères.`);
    }
    const r = await this.api<Wrapped>("GET", "/api/v1/identity");
    let id: string;
    try {
      id = await unwrapIdentity(fromBase64(r.identity), current);
    } catch {
      throw new Error("Mot de passe actuel incorrect.");
    }
    const wrapped = await wrapIdentity(id, next);
    if ((await identityToRecipient(await unwrapIdentity(wrapped, next))) !== r.recipient) {
      throw new Error("Le nouveau fichier d'identité ne correspond pas au coffre : rien n'a été changé.");
    }
    await this.api("PUT", "/api/v1/identity", { identity: toBase64(wrapped), code: code ?? "" });
  }

  /** Creates a pending TOTP secret. It is enforced only after totpEnable with a first valid code. */
  totpSetup(): Promise<TotpSetup> {
    return this.api<TotpSetup>("POST", "/api/v1/totp/setup");
  }

  async totpEnable(code: string): Promise<void> {
    await this.api("POST", "/api/v1/totp/enable", { code });
    this.setupToken = null;
  }

  async totpDisable(code: string): Promise<void> {
    await this.api("POST", "/api/v1/totp/disable", { code });
  }

  async lock(): Promise<void> {
    const revoke = this.token ? this.api("POST", "/api/v1/lock").catch(() => {}) : undefined;
    this.setSession(null);
    await revoke;
  }

  async listItems(): Promise<Listing> {
    const raw = await this.api<StoredItem[]>("GET", "/api/v1/items");
    return decryptEntries(raw, this.identity as string);
  }

  /**
   * Stores an item over the entry it was read from (refused if the server copy
   * changed since), or under a new random id when entry is null. Returns the id used.
   */
  async saveItem(entry: Entry | null, item: Item): Promise<string> {
    const ct = await encryptItem(item, this.recipient as string);
    return this.storeRecord(entry?.id ?? randomId(), ct, entry?.etag);
  }

  /** Stores a project as its own encrypted record in the vault. */
  async createProject(project: Project): Promise<string> {
    if (!isProject(project)) throw new Error("Fiche projet invalide.");
    const ct = await encryptBytes(new TextEncoder().encode(JSON.stringify(project)), this.recipient as string);
    return this.storeRecord(randomId(), ct);
  }

  async deleteProject(entry: ProjectEntry): Promise<void> {
    if (!entry.etag) throw new Error("Rechargez le coffre avant de supprimer ce projet.");
    await this.api("DELETE", `/api/v1/items/${entry.id}`, undefined, { "If-Match": entry.etag });
  }

  private async storeRecord(id: string, ciphertext: Uint8Array, etag?: string): Promise<string> {
    await this.api(
      "PUT",
      `/api/v1/items/${id}`,
      { ciphertext: toBase64(ciphertext) },
      etag === undefined ? undefined : { "If-Match": etag },
    );
    return id;
  }

  /**
   * Deletes the entry as it was read (refused if the server copy changed since),
   * then its attachments but those listed in keep (still used by another item).
   */
  async deleteItem(entry: Entry, keep: string[] = []): Promise<void> {
    await this.api("DELETE", `/api/v1/items/${entry.id}`, undefined, { "If-Match": entry.etag });
    for (const a of entry.item.attachments ?? []) if (!keep.includes(a.id)) await this.deleteAttachment(a.id);
  }

  depositKeys(): Promise<DepositKeyInfo[]> {
    return this.api<DepositKeyInfo[]>("GET", "/api/v1/deposit-keys");
  }

  /**
   * Makes a deposit key in this browser and registers it. Returns the value of
   * KEYFOLD_DEPOSIT_KEY, shown once: the server keeps only the token's hash.
   * It pins the vault's public key, so a server cannot swap in its own later.
   */
  async createDepositKey(name: string): Promise<string> {
    const token = randomHex(32);
    const identity = await generateX25519Identity();
    await this.api("POST", "/api/v1/deposit-keys", {
      name,
      token,
      recipient: await identityToRecipient(identity),
    });
    return ["kfdep1", token, identity, this.recipient as string].join(".");
  }

  async revokeDepositKey(id: string): Promise<void> {
    await this.api("DELETE", `/api/v1/deposit-keys/${id}`);
  }

  private async deleteDeposit(d: { keyId: string; id: string }): Promise<void> {
    await this.api("DELETE", `/api/v1/deposits/${d.keyId}/${d.id}`);
  }

  /** Decrypts a deposit; null when it is not an item this client reads (a key holder can send anything). */
  private async depositItem(d: RawDeposit): Promise<Item | null> {
    try {
      const { item } = upgrade((await decryptItem(fromBase64(d.ciphertext), this.identity as string)) as Item);
      return isItem(item) ? item : null;
    } catch {
      return null;
    }
  }

  /**
   * Stores the item a deposit becomes under an id derived from the deposit, and
   * only if that id is free: two clients moving it at once, or a retry after a
   * failure, find the item already stored and leave it as it is, edits
   * included. The deposit key holder cannot choose that id. Returns false
   * when the item was already there: its current content is then unknown here.
   */
  private async saveDepositItem(d: { keyId: string; id: string }, item: Item): Promise<boolean> {
    const ct = await encryptItem(item, this.recipient as string);
    try {
      await this.api(
        "PUT",
        `/api/v1/items/${await depositItemId(d)}`,
        { ciphertext: toBase64(ct) },
        { "If-None-Match": "*" },
      );
      return true;
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      return false;
    }
  }

  /**
   * Moves the waiting deposits into the vault: a new name is added, a value
   * equal to the stored one is dropped, a deposit that cannot be read is
   * dropped, and a name holding another value is left for the owner. Each
   * deposit is deleted after the item is stored: a run cut short is finished
   * by the next one, which then finds the value already stored.
   */
  async processDeposits(entries: Entry[]): Promise<DepositReport> {
    const raw = await this.api<RawDeposit[]>("GET", "/api/v1/deposits");
    const report: DepositReport = { added: [], dropped: 0, conflicts: [], reload: false, incomplete: false };
    let names = new Map(entries.map((e) => [e.item.name, e.item.value]));
    for (const d of raw) {
      const item = await this.depositItem(d);
      if (!item) {
        await this.deleteDeposit(d);
        report.dropped++;
      } else if (!names.has(item.name)) {
        report.reload = true;
        if (await this.saveDepositItem(d, item)) {
          names.set(item.name, item.value);
          report.added.push(item.name);
        } else {
          // Stored already, by another client or an earlier run, and maybe
          // renamed or edited since: the deposits that follow are compared with
          // the vault as it is now. One unreadable item stops the run: a deposit
          // could take its unknown name.
          const fresh = await this.listItems();
          if (fresh.unreadable.length > 0) return { ...report, incomplete: true };
          names = new Map(fresh.entries.map((e) => [e.item.name, e.item.value]));
        }
        await this.deleteDeposit(d);
      } else if (names.get(item.name) === item.value) {
        await this.deleteDeposit(d);
        report.dropped++;
      } else {
        report.conflicts.push({ keyId: d.keyId, id: d.id, keyName: d.keyName, created: d.created, item });
      }
    }
    return report;
  }

  /**
   * Settles a conflict against the current entries, then deletes the deposit.
   * The deposit is read again first: one revoked or settled elsewhere since the
   * page listed it is refused, and its stored content is what gets applied.
   */
  async resolveDeposit(c: DepositConflict, choice: DepositChoice, entries: Entry[]): Promise<void> {
    const raw = await this.api<RawDeposit[]>("GET", "/api/v1/deposits");
    const d = raw.find((r) => r.keyId === c.keyId && r.id === c.id);
    if (!d) throw new GoneDepositError("Ce dépôt n'existe plus : sa clé a été révoquée ou il a déjà été traité.");
    const item = choice === "reject" ? null : await this.depositItem(d);
    const stamp = new Date().toISOString();
    if (choice === "replace" && item) {
      const target = entries.find((e) => e.item.name === item.name) ?? null;
      const next = target ? withValue({ ...target.item, updated_at: stamp }, item.value, stamp) : item;
      await this.saveItem(target, next);
    } else if (choice === "keep-both" && item) {
      // A retry finds the copy it stored before under the same id, and keeps its name.
      const id = await depositItemId(d);
      const taken = new Set(entries.map((e) => e.item.name));
      let n = 2;
      while (taken.has(`${item.name} (${n})`)) n++;
      const name = entries.find((e) => e.id === id)?.item.name ?? `${item.name} (${n})`;
      await this.saveDepositItem(d, { ...item, name, created_at: stamp, updated_at: stamp });
    }
    await this.deleteDeposit(d);
  }

  /**
   * Encrypts, for each deposit key, the catalog its agent lists: name, kind,
   * project and environment of each item. Never a value, a note or a date.
   */
  async refreshCatalogs(entries: Entry[]): Promise<void> {
    const keys = await this.depositKeys();
    if (keys.length === 0) return;
    const items = entries.map(({ item }) => ({
      name: item.name,
      kind: item.kind,
      project: item.project,
      environment: item.environment,
    }));
    const plain = new TextEncoder().encode(JSON.stringify({ items }));
    for (const k of keys) {
      const ct = await encryptBytes(plain, k.recipient);
      await this.api("PUT", `/api/v1/deposit-keys/${k.id}/catalog`, { ciphertext: toBase64(ct) });
    }
  }

  /** Encrypts a file to the vault and uploads it. The item that lists the returned ref is saved separately. */
  async uploadAttachment(name: string, data: Uint8Array): Promise<BlobRef> {
    const id = randomId();
    const ct = await encryptBytes(data, this.recipient as string);
    await this.send("PUT", `/api/v1/blobs/${id}`, ct as Uint8Array<ArrayBuffer>, {
      "Content-Type": "application/octet-stream",
    });
    return { id, name, size: data.length, sha256: await sha256Hex(data) };
  }

  /** Downloads and decrypts an attachment, checking it is the file that was attached. */
  async downloadAttachment(ref: BlobRef): Promise<Uint8Array> {
    const res = await this.send("GET", `/api/v1/blobs/${ref.id}`);
    const data = await decrypt(new Uint8Array(await res.arrayBuffer()), this.identity as string);
    if ((await sha256Hex(data)) !== ref.sha256) throw new Error(`La pièce jointe « ${ref.name} » est altérée.`);
    return data;
  }

  /** Deletes an attachment. One already gone is not an error: nothing points to it any more. */
  async deleteAttachment(id: string): Promise<void> {
    await this.send("DELETE", `/api/v1/blobs/${id}`).catch((e) => {
      if (e instanceof LockedError) throw e;
    });
  }
}

/** The item id a deposit becomes: derived from its key and id, so every client and retry uses the same. */
async function depositItemId(d: { keyId: string; id: string }): Promise<string> {
  return (await sha256Hex(new TextEncoder().encode(`keyfold deposit item\0${d.keyId}\0${d.id}`))).slice(0, 32);
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}
