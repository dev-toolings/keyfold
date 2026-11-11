import type { CSSProperties } from "react";
import type { Feature, Lang } from "@/content/landing";

const TILES: Record<Lang, [string, string, string]> = {
  fr: ["À renouveler", "Réutilisées", "Courts"],
  en: ["To renew", "Reused", "Short"],
};

type Tone = "dim" | "ok" | "warn" | "accent";
type Row = [text: string, tone?: Tone] | [prompt: string, tone: "accent", rest: string];

const TONES: Record<Tone, string> = {
  dim: "text-white/45",
  ok: "text-[#6ee7a8]",
  warn: "text-[#ffb86b]",
  accent: "text-[#3b9bff]",
};

const CLI_ROWS: Row[] = [
  ["$ kf unlock"],
  ["Master password: ••••••••••••••••", "dim"],
  ["unlocked for 1h0m0s", "ok"],
  ["$ kf list"],
  ["ssh/prod-web-01   ssh-passphrase"],
  ["ssh/prod-db-01    ssh-passphrase"],
  ["$ kf get ssh/prod-web-01"],
  ["kf: refusing to print a secret to a terminal", "warn"],
];

const MCP_ROWS: Row[] = [
  ["tool", "accent", " list_items"],
  ['  { "name": "ssh/prod-web-01",', "dim"],
  ['    "kind": "ssh-passphrase" }', "dim"],
  [" "],
  ["tool", "accent", " generate_item"],
  ['  { "created": "api/staging",', "dim"],
  ['    "kind": "token" }', "dim"],
  [" "],
  ["value: never returned", "ok"],
];

const CRYPTO_STEPS = ["master password", "scrypt", "age identity (X25519)", "items/*.age"];

/** Illustrations drawn in markup, with sample names and numbers. No screenshot, no real data. */
export function FeatureVisual({ id, lang }: { id: Feature["id"]; lang: Lang }) {
  const mono = "font-['Geist_Mono',ui-monospace,monospace] text-[12px] leading-[20px] min-[810px]:text-[13px]";
  const at = (i: number) => ({ "--i": i }) as CSSProperties;

  if (id === "dashboard") {
    const bars = [24, 0, 24, 48, 48, 24, 72, 100];
    return (
      <div className="flex h-full flex-col gap-4">
        <div className="grid grid-cols-3 gap-3">
          {TILES[lang].map((label, i) => (
            <div key={label} style={at(i)} className="lp-row rounded-[12px] bg-white/[0.06] p-3">
              <p className="truncate text-[11px] leading-[16px] text-white/60">{label}</p>
              <p className="mt-1 text-[26px] leading-none font-semibold tracking-[-1px]">{[5, 2, 2][i]}</p>
            </div>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 items-end gap-2 rounded-[12px] bg-white/[0.04] p-4">
          {bars.map((height, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative bars.
              key={i}
              className="lp-bar flex-1 rounded-t-[4px] bg-[#3b9bff]"
              style={{ ...at(i), height: `${Math.max(height, 3)}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (id === "cli" || id === "mcp") {
    const rows = id === "cli" ? CLI_ROWS : MCP_ROWS;
    return (
      <div className={`${mono} h-full overflow-hidden whitespace-pre-wrap text-white/85`}>
        {rows.map(([text, tone, rest], i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed illustrative lines.
          <p key={i} style={at(i)} className="lp-row">
            <span className={tone && TONES[tone]}>{text}</span>
            {rest}
          </p>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col justify-center gap-2">
      {CRYPTO_STEPS.map((step, i) => (
        <div key={step} style={at(i)} className="lp-row flex items-center gap-3">
          <span
            className={`${mono} grid size-7 shrink-0 place-items-center rounded-full bg-white/[0.08] text-white/60`}
          >
            {i + 1}
          </span>
          <span
            className={`${mono} flex-1 rounded-[10px] px-3 py-2 ${i === CRYPTO_STEPS.length - 1 ? "bg-[#3b9bff]/15 text-[#8cc4ff]" : "bg-white/[0.06] text-white/85"}`}
          >
            {step}
          </span>
        </div>
      ))}
      <p style={at(CRYPTO_STEPS.length)} className={`${mono} lp-row mt-2 text-white/45`}>
        age-encryption.org/v1
      </p>
    </div>
  );
}
