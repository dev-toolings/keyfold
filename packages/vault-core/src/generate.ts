// Random secrets, item history and TOTP codes. Same rules as
// internal/vault/generate.go.
import type { Item } from "./item";
import { EFF_WORDS } from "./wordlist";

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?/";
/** Number of previous values an item keeps. */
export const MAX_HISTORY = 20;

/** Uniform random integer in [0, n), without modulo bias. */
function pick(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % n;
}

export function generatePassword(length = 24, symbols = true): string {
  const set = symbols ? ALNUM + SYMBOLS : ALNUM;
  return Array.from({ length }, () => set[pick(set.length)]).join("");
}

/** words EFF words joined by "-": about 12.9 bits each. */
export function generatePassphrase(words = 6): string {
  return Array.from({ length: words }, () => EFF_WORDS[pick(EFF_WORDS.length)]).join("-");
}

/** The item holding value: a changed value pushes the old one on top of history. */
export function withValue(item: Item, value: string, now: string): Item {
  if (!item.value || item.value === value) return { ...item, value };
  const history = [{ value: item.value, changed_at: now }, ...(item.history ?? [])].slice(0, MAX_HISTORY);
  return { ...item, value, history };
}

function base32(s: string): Uint8Array<ArrayBuffer> {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = s.toUpperCase().replace(/[\s=]/g, "");
  const out: number[] = [];
  let bits = 0;
  let acc = 0;
  for (const c of clean) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error("Secret TOTP invalide.");
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

export type TotpCode = { code: string /** Seconds before the next code. */; remaining: number; period: number };

/** Current code of an otpauth:// URI or a bare base32 secret (6 digits, 30 s, SHA-1). */
export async function totpCode(spec: string, now = Date.now()): Promise<TotpCode> {
  let secret = spec;
  let digits = 6;
  let period = 30;
  let hash = "SHA-1";
  if (spec.startsWith("otpauth://")) {
    const p = new URL(spec).searchParams;
    secret = p.get("secret") ?? "";
    digits = Number(p.get("digits") ?? 6);
    period = Number(p.get("period") ?? 30);
    hash = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" }[(p.get("algorithm") ?? "SHA1").toUpperCase()] ?? "";
    if (!hash || !(digits >= 6 && digits <= 8) || !(period > 0)) throw new Error("URI TOTP invalide.");
  }
  const counter = Math.floor(now / 1000 / period);
  const msg = new DataView(new ArrayBuffer(8));
  msg.setUint32(0, Math.floor(counter / 0x1_0000_0000));
  msg.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey("raw", base32(secret), { name: "HMAC", hash }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const off = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  const code = String(bin % 10 ** digits).padStart(digits, "0");
  return { code, remaining: period - (Math.floor(now / 1000) % period), period };
}
