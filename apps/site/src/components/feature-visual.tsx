import { CircleCheck, Clock, type LucideIcon, Repeat2, Ruler, TriangleAlert } from "lucide-react";
import type { CSSProperties } from "react";
import type { Feature, Lang } from "@/content/landing";

/** The Health tab of the vault dashboard (apps/web/src/pages/dashboard.tsx), with sample values. */
const DASHBOARD = {
  fr: {
    tabs: ["Santé", "Sécurité", "Contenu"],
    kpis: [
      { icon: Clock, label: "À renouveler", value: 5, helper: "Le plus ancien : 214 jours" },
      { icon: Repeat2, label: "Valeurs réutilisées", value: 2, helper: "1 groupe de valeurs identiques" },
      { icon: Ruler, label: "Mots de passe courts", value: 0, helper: "Moins de 16 caractères" },
    ],
    todo: "À traiter",
    clear: "Rien à signaler",
    chart: "Modifications par mois",
    average: "Moyenne : 3",
    months: ["avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov."],
  },
  en: {
    tabs: ["Health", "Security", "Content"],
    kpis: [
      { icon: Clock, label: "To renew", value: 5, helper: "Oldest: 214 days" },
      { icon: Repeat2, label: "Reused values", value: 2, helper: "1 group of identical values" },
      { icon: Ruler, label: "Short passwords", value: 0, helper: "Under 16 characters" },
    ],
    todo: "To fix",
    clear: "All clear",
    chart: "Changes per month",
    average: "Average: 3",
    months: ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"],
  },
} satisfies Record<
  Lang,
  {
    tabs: string[];
    kpis: { icon: LucideIcon; label: string; value: number; helper: string }[];
    todo: string;
    clear: string;
    chart: string;
    average: string;
    months: string[];
  }
>;

/** Items changed per month, sample data: the average of these eight months is 3. */
const UPDATES = [2, 1, 3, 4, 2, 5, 3, 4];
const UPDATES_MAX = 6;

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
    const d = DASHBOARD[lang];
    const average = UPDATES.reduce((sum, n) => sum + n, 0) / UPDATES.length;
    return (
      <div className="flex h-full flex-col gap-2.5 text-[11px] leading-[16px] min-[810px]:gap-3">
        <div style={at(0)} className="lp-row flex self-start rounded-[10px] bg-white/[0.06] p-0.5">
          {d.tabs.map((tab, i) => (
            <span
              key={tab}
              className={`rounded-[8px] px-2.5 py-1 ${i === 0 ? "bg-white/[0.12] text-white" : "text-white/50"}`}
            >
              {tab}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {d.kpis.map(({ icon: Icon, label, value, helper }, i) => (
            <div
              key={label}
              style={at(i + 1)}
              className="lp-row min-w-0 rounded-[12px] bg-white/[0.06] p-2.5 min-[810px]:p-3"
            >
              <p className="flex min-h-8 min-w-0 items-start gap-1.5 text-white/85 min-[810px]:min-h-0 min-[810px]:items-center">
                <Icon aria-hidden="true" className="hidden size-3.5 shrink-0 text-white/50 min-[810px]:block" />
                <span className="font-medium min-[810px]:truncate">{label}</span>
              </p>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-[22px] leading-none font-semibold tracking-[-0.8px] tabular-nums min-[810px]:text-[26px]">
                  {value}
                </span>
                <span
                  className={`hidden items-center gap-1 truncate rounded-full px-1.5 py-0.5 text-[10px] leading-[14px] min-[810px]:inline-flex ${value > 0 ? "bg-[#ffb86b]/[0.12] text-[#ffb86b]" : "bg-[#6ee7a8]/[0.12] text-[#6ee7a8]"}`}
                >
                  {value > 0 ? (
                    <TriangleAlert aria-hidden="true" className="size-3 shrink-0" />
                  ) : (
                    <CircleCheck aria-hidden="true" className="size-3 shrink-0" />
                  )}
                  {value > 0 ? d.todo : d.clear}
                </span>
              </div>
              <p className="mt-1.5 hidden truncate text-white/45 min-[810px]:block">{helper}</p>
            </div>
          ))}
        </div>
        <div
          style={at(4)}
          className="lp-row flex min-h-0 flex-1 flex-col rounded-[12px] bg-white/[0.04] p-2.5 min-[810px]:p-3"
        >
          <p className="font-medium text-white/85">{d.chart}</p>
          <div className="relative mt-2 flex min-h-0 flex-1 items-end gap-1.5 border-b border-white/10 min-[810px]:gap-2">
            {UPDATES.map((count, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed sample bars.
                key={i}
                className="lp-bar flex-1 rounded-t-[3px] bg-[#3b9bff]"
                style={{ ...at(i), height: `${(count / UPDATES_MAX) * 100}%` }}
              />
            ))}
            <span
              className="absolute inset-x-0 border-t border-dashed border-white/40"
              style={{ bottom: `${(average / UPDATES_MAX) * 100}%` }}
            >
              <span className="absolute -top-4 left-0 rounded-[4px] bg-[#1b1b1b] px-1 text-[10px] text-white/60">
                {d.average}
              </span>
            </span>
          </div>
          <div className="mt-1 hidden gap-2 text-center text-[10px] text-white/40 min-[810px]:flex">
            {d.months.map((month) => (
              <span key={month} className="flex-1">
                {month}
              </span>
            ))}
          </div>
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
