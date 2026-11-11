// age operations shared by every client. No DOM and no framework: it runs in a
// page, a browser extension and Bun.
import { Decrypter, Encrypter } from "age-encryption";
import { ITEM_VERSION, type Item, KINDS } from "./item";

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

/** Encrypts the identity string with the master password (scrypt, logN 18 by default). */
export async function wrapIdentity(id: string, password: string, logN = 18): Promise<Uint8Array> {
  const e = new Encrypter();
  e.setPassphrase(password);
  e.setScryptWorkFactor(logN);
  return e.encrypt(id);
}

export async function unwrapIdentity(file: Uint8Array, password: string): Promise<string> {
  const d = new Decrypter();
  d.addPassphrase(password);
  return (await d.decrypt(file, "text")).trim();
}

/** Encrypts an item to the recipient. Only the current format is written. */
export async function encryptItem(item: Item, to: string): Promise<Uint8Array> {
  if (item.v !== ITEM_VERSION)
    throw new Error(`Élément « ${item.name} » au format v${item.v}, attendu v${ITEM_VERSION}.`);
  if (!KINDS.includes(item.kind)) throw new Error(`Type inconnu : ${item.kind}.`);
  const e = new Encrypter();
  e.addRecipient(to);
  return e.encrypt(JSON.stringify(item));
}

/** Encrypts raw bytes (an attachment) to the recipient. */
export async function encryptBytes(data: Uint8Array, to: string): Promise<Uint8Array> {
  const e = new Encrypter();
  e.addRecipient(to);
  return e.encrypt(data);
}

/** Decrypts an item file as stored: it may be an older format (see upgrade). */
export async function decryptItem(file: Uint8Array, id: string): Promise<unknown> {
  const d = new Decrypter();
  d.addIdentity(id);
  return JSON.parse(await d.decrypt(file, "text"));
}

export async function decrypt(file: Uint8Array, id: string): Promise<Uint8Array> {
  const d = new Decrypter();
  d.addIdentity(id);
  return d.decrypt(file);
}
