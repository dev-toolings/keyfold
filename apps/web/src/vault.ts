// The web UI's single vault client, on the same origin as the server. Pages
// call these functions; the crypto and the API live in @keyfold/vault-core.
import { type BlobRef, type Entry, type Item, VaultClient } from "@keyfold/vault-core";

export * from "@keyfold/vault-core";

const client = new VaultClient();

export const isUnlocked = () => client.isUnlocked();
export const status = () => client.status();
export const health = () => client.health();
export const create = (password: string) => client.create(password);
export const hasDownloadedIdentity = () => client.hasDownloadedIdentity();
export const unlock = (password: string, code?: string) => client.unlock(password, code);
export const changePassword = (current: string, next: string, code?: string) =>
  client.changePassword(current, next, code);
export const totpSetup = () => client.totpSetup();
export const totpEnable = (code: string) => client.totpEnable(code);
export const totpDisable = (code: string) => client.totpDisable(code);
export const lock = () => client.lock();
export const listItems = () => client.listItems();
export const saveItem = (entry: Entry | null, item: Item) => client.saveItem(entry, item);
export const deleteItem = (entry: Entry, keep?: string[]) => client.deleteItem(entry, keep);
export const uploadAttachment = (name: string, data: Uint8Array) => client.uploadAttachment(name, data);
export const downloadAttachment = (ref: BlobRef) => client.downloadAttachment(ref);
export const deleteAttachment = (id: string) => client.deleteAttachment(id);
