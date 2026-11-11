// Talks to the vault server. The decrypted identity and the session token live
// in this object's memory only: never in localStorage, sessionStorage or cookies.
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
import { type BlobRef, type Entry, type Item, upgrade } from "./item";

/** Thrown when the session is gone (lock, idle expiry, server restart). */
export class LockedError extends Error {}

/** Thrown when an item changed on the server since it was read (HTTP 412). */
export class ConflictError extends Error {}

export type Status = { initialized: boolean; totp: boolean };
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

/** Same rule as the CLI (vault.MinMasterPasswordLength in Go). */
export const MIN_MASTER_PASSWORD_LENGTH = 16;

type Wrapped = { identity: string; recipient: string };

export class VaultClient {
  private identity: string | null = null;
  private recipient: string | null = null;
  private token: string | null = null;
  // The encrypted identity, kept after a download that cost a TOTP code: the
  // password is checked here, after the download, so a typo must not spend the
  // code (the server refuses it twice). It is ciphertext, dropped on success.
  private downloaded: Wrapped | null = null;

  /** baseURL: "" for the same origin, or the server URL (browser extension). */
  constructor(private readonly baseURL = "") {}

  /** Sends a request with the session token and turns error statuses into errors. */
  private async send(method: string, path: string, body?: BodyInit, extra?: Record<string, string>): Promise<Response> {
    const headers: Record<string, string> = { ...extra };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(this.baseURL + path, { method, headers, body });
    if (res.status === 401 && this.token) {
      this.forget();
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

  private forget() {
    this.identity = null;
    this.recipient = null;
    this.token = null;
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

  /** First run: creates the identity, uploads it wrapped, then unlocks. */
  async create(password: string): Promise<void> {
    if ([...password].length < MIN_MASTER_PASSWORD_LENGTH) {
      throw new Error(`Le mot de passe principal doit faire au moins ${MIN_MASTER_PASSWORD_LENGTH} caractères.`);
    }
    const id = await generateX25519Identity();
    const wrapped = await wrapIdentity(id, password);
    await this.api("POST", "/api/v1/init", {
      identity: toBase64(wrapped),
      recipient: await identityToRecipient(id),
    });
    await this.unlock(password);
  }

  /** True when a retry needs no new TOTP code. */
  hasDownloadedIdentity(): boolean {
    return this.downloaded !== null;
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
    let id: string;
    try {
      id = await unwrapIdentity(fromBase64(r.identity), password);
    } catch {
      throw new Error("Mot de passe incorrect.");
    }
    if ((await identityToRecipient(id)) !== r.recipient) {
      throw new Error("L'identité ne correspond pas au coffre.");
    }
    const ch = await this.api<{ id: string; ciphertext: string }>("POST", "/api/v1/challenge");
    const answer = await decrypt(fromBase64(ch.ciphertext), id);
    const s = await this.api<{ token: string }>("POST", "/api/v1/session", { id: ch.id, answer: toBase64(answer) });
    this.identity = id;
    this.recipient = r.recipient;
    this.token = s.token;
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
  }

  async totpDisable(code: string): Promise<void> {
    await this.api("POST", "/api/v1/totp/disable", { code });
  }

  async lock(): Promise<void> {
    if (this.token) await this.api("POST", "/api/v1/lock").catch(() => {});
    this.forget();
  }

  async listItems(): Promise<Entry[]> {
    const raw = await this.api<{ id: string; etag: string; ciphertext: string }[]>("GET", "/api/v1/items");
    const id = this.identity as string;
    const entries = await Promise.all(
      raw.map(async (r) => {
        const { item, old } = upgrade((await decryptItem(fromBase64(r.ciphertext), id)) as Item);
        return { id: r.id, etag: r.etag, item, oldFormat: old };
      }),
    );
    return entries.sort((a, b) => a.item.name.localeCompare(b.item.name));
  }

  /**
   * Stores an item over the entry it was read from (refused if the server copy
   * changed since), or under a new random id when entry is null. Returns the id used.
   */
  async saveItem(entry: Entry | null, item: Item): Promise<string> {
    const itemId = entry?.id ?? randomId();
    const ct = await encryptItem(item, this.recipient as string);
    await this.api(
      "PUT",
      `/api/v1/items/${itemId}`,
      { ciphertext: toBase64(ct) },
      entry ? { "If-Match": entry.etag } : undefined,
    );
    return itemId;
  }

  /**
   * Deletes the entry as it was read (refused if the server copy changed since),
   * then its attachments but those listed in keep (still used by another item).
   */
  async deleteItem(entry: Entry, keep: string[] = []): Promise<void> {
    await this.api("DELETE", `/api/v1/items/${entry.id}`, undefined, { "If-Match": entry.etag });
    for (const a of entry.item.attachments ?? []) if (!keep.includes(a.id)) await this.deleteAttachment(a.id);
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

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}
