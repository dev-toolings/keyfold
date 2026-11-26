// The web UI's single vault client, on the same origin as the server. Pages
// call these functions; the crypto and the API live in @keyfold/vault-core.
import {
  type BlobRef,
  type DepositChoice,
  type DepositConflict,
  type Entry,
  type Item,
  type Project,
  type ProjectEntry,
  VaultClient,
  type VaultSession,
} from "@keyfold/vault-core";

export * from "@keyfold/vault-core";

const SESSION_KEY = "keyfold.vault-session";

class WebVaultClient extends VaultClient {
  constructor() {
    super();
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored === null) return;
      const session: Partial<VaultSession> | null = JSON.parse(stored);
      if (
        typeof session?.identity === "string" &&
        session.identity &&
        typeof session.recipient === "string" &&
        session.recipient &&
        typeof session.token === "string" &&
        session.token
      ) {
        super.setSession({ identity: session.identity, recipient: session.recipient, token: session.token });
        return;
      }
    } catch {
      // The tab may block storage or contain an invalid session.
    }
    this.setSession(null);
  }

  protected override setSession(session: VaultSession | null): void {
    super.setSession(session);
    try {
      if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // The vault still works in memory if the browser blocks storage.
    }
  }

  protected override async unwrapIdentityForUnlock(wrappedIdentity: string, password: string): Promise<string | null> {
    const worker = new Worker(new URL("./unlock.worker.ts", import.meta.url), { type: "module" });
    try {
      return await new Promise<string | null>((resolve, reject) => {
        worker.onmessage = ({ data }: MessageEvent<string | null>) => resolve(data);
        worker.onerror = worker.onmessageerror = () => {
          reject(new Error("Le déchiffrement du coffre a échoué. Réessayez."));
        };
        worker.postMessage({ wrappedIdentity, password });
      });
    } finally {
      worker.terminate();
    }
  }
}

const client = new WebVaultClient();

export const isUnlocked = () => client.isUnlocked();
export const status = () => client.status();
export const health = () => client.health();
export const requestSetupCode = (email: string) => client.requestSetupCode(email);
export const verifySetupCode = (code: string) => client.verifySetupCode(code);
export const create = (password: string, installToken?: string) => client.create(password, installToken);
export const hasDownloadedIdentity = () => client.hasDownloadedIdentity();
export const unlock = (password: string, code?: string) => client.unlock(password, code);
export const changePassword = (current: string, next: string, code?: string) =>
  client.changePassword(current, next, code);
export const depositKeys = () => client.depositKeys();
export const createDepositKey = (name: string) => client.createDepositKey(name);
export const revokeDepositKey = (id: string) => client.revokeDepositKey(id);
export const processDeposits = (entries: Entry[]) => client.processDeposits(entries);
export const resolveDeposit = (c: DepositConflict, choice: DepositChoice, entries: Entry[]) =>
  client.resolveDeposit(c, choice, entries);
export const refreshCatalogs = (entries: Entry[]) => client.refreshCatalogs(entries);
export const totpSetup = () => client.totpSetup();
export const totpEnable = (code: string) => client.totpEnable(code);
export const totpDisable = (code: string) => client.totpDisable(code);
export const lock = () => client.lock();
export const listItems = () => client.listItems();
export const saveItem = (entry: Entry | null, item: Item) => client.saveItem(entry, item);
export const createProject = (project: Project) => client.createProject(project);
export const deleteProject = (entry: ProjectEntry) => client.deleteProject(entry);
export const deleteItem = (entry: Entry, keep?: string[]) => client.deleteItem(entry, keep);
export const uploadAttachment = (name: string, data: Uint8Array) => client.uploadAttachment(name, data);
export const downloadAttachment = (ref: BlobRef) => client.downloadAttachment(ref);
export const deleteAttachment = (id: string) => client.deleteAttachment(id);
