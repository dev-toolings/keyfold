// French labels and formatters shared by the pages.
import { Braces, IdCard, Key, KeyRound, type LucideIcon, StickyNote, Terminal } from "lucide-react";
import type { Filter, Kind } from "@/vault";

export const KIND_LABELS: Record<Kind, string> = {
  login: "Identifiant",
  token: "Jeton d'API",
  note: "Note",
  identity: "Identité",
  "ssh-key": "Clé SSH",
  "ssh-passphrase": "Phrase de passe SSH",
};

export const KIND_PLURALS: Record<Kind, string> = {
  login: "Identifiants",
  token: "Jetons d'API",
  note: "Notes",
  identity: "Identités",
  "ssh-key": "Clés SSH",
  "ssh-passphrase": "Phrases SSH",
};

export const KIND_ICONS: Record<Kind, LucideIcon> = {
  login: KeyRound,
  token: Braces,
  note: StickyNote,
  identity: IdCard,
  "ssh-key": Key,
  "ssh-passphrase": Terminal,
};

export const FILTER_LABELS: Record<Filter, string> = {
  stale: "À renouveler",
  reused: "Réutilisé",
  short: "Court",
  weak: "Faible",
  no2fa: "Sans 2FA",
};

/** Label of the main secret, by kind. */
export const VALUE_LABELS: Record<Kind, string> = {
  login: "Mot de passe",
  token: "Jeton",
  note: "Contenu",
  identity: "Valeur",
  "ssh-key": "Valeur",
  "ssh-passphrase": "Phrase de passe",
};

const SIZE_UNITS = ["Ko", "Mo", "Go", "To"];

/** "512 o", "1,2 Mo", "48,3 Go": the largest unit that keeps the number at 1 or more. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  let n = bytes / 1024;
  let unit = 0;
  while (n >= 1024 && unit < SIZE_UNITS.length - 1) {
    n /= 1024;
    unit++;
  }
  return `${formatNumber(n)} ${SIZE_UNITS[unit]}`;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Erreur inconnue.";
}

/** "1 élément", "3 éléments". */
export function plural(n: number, one: string, many: string): string {
  return `${formatNumber(n)} ${n > 1 ? many : one}`;
}

const numberFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
export function formatNumber(n: number): string {
  return numberFormat.format(n);
}

const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });
export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

const monthFormat = new Intl.DateTimeFormat("fr-FR", { month: "short", year: "2-digit" });
/** "2026-03" to "mars 26". */
export function formatMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return monthFormat.format(new Date(y, m - 1, 1));
}

const relativeFormat = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];
/** "il y a 3 jours", "hier", "à l'instant". */
export function formatRelative(iso: string, now: Date): string {
  const seconds = (new Date(iso).getTime() - now.getTime()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return "à l'instant";
}
