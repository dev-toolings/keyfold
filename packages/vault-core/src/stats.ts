// Vault statistics, computed in the browser from decrypted entries. The health
// rules match internal/vault/health.go (used by the MCP tool vault_health):
// internal/vault/testdata/health.json holds cases both test suites check.
// Every function is pure: it takes the entries and, when time matters, a `now` date.
import { createdAt, type Entry, KINDS, type Kind } from "./item";

/** An item not modified for more than this many days is due for renewal. */
export const STALE_DAYS = 90;
/** A password or SSH passphrase shorter than this many characters is short. */
export const SHORT_LENGTH = 16;
/** A password or SSH passphrase estimated below this many bits of entropy is weak. */
export const WEAK_BITS = 60;
/** Window, in days, for "recently modified". */
export const RECENT_DAYS = 7;
/** A time chart needs at least this many months; below it, only the number is shown. */
export const MIN_TIME_POINTS = 4;

const DAY_MS = 86_400_000;
/** Kinds whose value is a secret worth comparing for reuse. */
const SECRET_KINDS: readonly Kind[] = ["login", "token", "ssh-passphrase"];
/** Kinds whose value length matters. */
const PASSWORD_KINDS: readonly Kind[] = ["login", "ssh-passphrase"];

export const FILTERS = ["stale", "reused", "short", "weak", "no2fa"] as const;
export type Filter = (typeof FILTERS)[number];

export type MonthPoint = { month: string; count: number };

/** Whole days elapsed between an ISO date and now. */
export function ageDays(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS);
}

/** Entries not modified for more than STALE_DAYS, oldest first. */
export function staleEntries(entries: Entry[], now: Date): Entry[] {
  return entries
    .filter((e) => ageDays(e.item.updated_at, now) > STALE_DAYS)
    .sort((a, b) => a.item.updated_at.localeCompare(b.item.updated_at));
}

/** Groups of secret entries (password, token, SSH passphrase) sharing the exact same, non-empty value. */
export function reusedGroups(entries: Entry[]): Entry[][] {
  const byValue = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!SECRET_KINDS.includes(e.item.kind) || e.item.value === "") continue;
    const group = byValue.get(e.item.value);
    if (group) group.push(e);
    else byValue.set(e.item.value, [e]);
  }
  return [...byValue.values()].filter((g) => g.length > 1);
}

/** Passwords and SSH passphrases. A login without one (an imported bookmark) is not counted. */
export function passwordEntries(entries: Entry[]): Entry[] {
  return entries.filter((e) => PASSWORD_KINDS.includes(e.item.kind) && e.item.value !== "");
}

/** Passwords and SSH passphrases with fewer than SHORT_LENGTH characters. */
export function shortEntries(entries: Entry[]): Entry[] {
  return passwordEntries(entries).filter((e) => [...e.item.value].length < SHORT_LENGTH);
}

/**
 * Estimated entropy of a value, in bits: length times log2 of the character
 * classes it uses (lowercase, uppercase, digits, others). A passphrase of EFF
 * words ("a-b-c") counts 12.9 bits per word. An upper bound for a human-chosen
 * password, exact for a generated one.
 */
export function strengthBits(value: string): number {
  const words = value.split("-");
  if (words.length >= 4 && words.every((w) => /^[a-z]+$/.test(w))) return words.length * Math.log2(7776);
  let pool = 0;
  if (/[a-z]/.test(value)) pool += 26;
  if (/[A-Z]/.test(value)) pool += 26;
  if (/[0-9]/.test(value)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(value)) pool += 33;
  return pool === 0 ? 0 : [...value].length * Math.log2(pool);
}

/** Passwords and SSH passphrases estimated below WEAK_BITS. */
export function weakEntries(entries: Entry[]): Entry[] {
  return passwordEntries(entries).filter((e) => strengthBits(e.item.value) < WEAK_BITS);
}

/** Logins for a website (with a URL) that hold no TOTP secret. */
export function noTotpEntries(entries: Entry[]): Entry[] {
  return entries.filter((e) => e.item.kind === "login" && (e.item.urls?.length ?? 0) > 0 && !e.item.totp);
}

/** Entries modified within the last RECENT_DAYS days. */
export function recentEntries(entries: Entry[], now: Date): Entry[] {
  return entries.filter((e) => ageDays(e.item.updated_at, now) < RECENT_DAYS);
}

export function countByKind(entries: Entry[]): Record<Kind, number> {
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>;
  for (const e of entries) counts[e.item.kind]++;
  return counts;
}

/** The ids of the entries matching each health filter. */
export function flaggedIds(entries: Entry[], now: Date): Record<Filter, Set<string>> {
  return {
    stale: new Set(staleEntries(entries, now).map((e) => e.id)),
    reused: new Set(reusedGroups(entries).flatMap((g) => g.map((e) => e.id))),
    short: new Set(shortEntries(entries).map((e) => e.id)),
    weak: new Set(weakEntries(entries).map((e) => e.id)),
    no2fa: new Set(noTotpEntries(entries).map((e) => e.id)),
  };
}

/** "YYYY-MM" in local time. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Every month from the earliest date to now's month, inclusive. Empty without dates. */
function monthRange(isoDates: string[], now: Date): string[] {
  if (isoDates.length === 0) return [];
  const first = new Date(Math.min(...isoDates.map((d) => new Date(d).getTime())));
  const months: string[] = [];
  const cursor = new Date(first.getFullYear(), first.getMonth(), 1);
  const last = monthKey(now);
  while (monthKey(cursor) <= last) {
    months.push(monthKey(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

/** Cumulative item count at the end of each month, from the first creation to now. */
export function growthByMonth(entries: Entry[], now: Date): MonthPoint[] {
  const created = entries.map((e) => monthKey(new Date(createdAt(e.item))));
  return monthRange(
    entries.map((e) => createdAt(e.item)),
    now,
  ).map((month) => ({ month, count: created.filter((m) => m <= month).length }));
}

/** Items whose last modification falls in each month, from the earliest one to now. */
export function updatesByMonth(entries: Entry[], now: Date): MonthPoint[] {
  const updated = entries.map((e) => monthKey(new Date(e.item.updated_at)));
  return monthRange(
    entries.map((e) => e.item.updated_at),
    now,
  ).map((month) => ({ month, count: updated.filter((m) => m === month).length }));
}

/** Mean count per month; 0 for an empty series. */
export function monthlyAverage(series: MonthPoint[]): number {
  if (series.length === 0) return 0;
  return series.reduce((sum, p) => sum + p.count, 0) / series.length;
}

/** Whether a time series has enough months to be drawn as a chart. */
export function hasEnoughHistory(series: MonthPoint[]): boolean {
  return series.length >= MIN_TIME_POINTS;
}
