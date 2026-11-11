import {
  ArrowUpRight,
  Bot,
  ChartColumn,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Dices,
  EyeOff,
  FileCode,
  FileLock,
  Fingerprint,
  Gauge,
  HeartPulse,
  Hourglass,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  type LucideIcon,
  Sparkles,
  SquareTerminal,
  TimerReset,
} from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { REPO_URL, SITE_ONLY } from "@/lib/site";
import { CONTENT, type Content, type Feature, type Lang, STACK } from "./landing-content";
import "./landing.css";

/** Public product page: "/" in French, "/en" in English. */
export function LandingPage({ lang }: { lang: Lang }) {
  const t = CONTENT[lang];

  // Scroll reveal: each [data-reveal] element animates in once, the first time it is seen.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-visible", "");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -80px 0px" },
    );
    for (const el of root.current?.querySelectorAll("[data-reveal]") ?? []) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="lp" ref={root}>
      <header className="lp-container lp-fade pt-6 min-[810px]:pt-8">
        <div className="relative flex h-9 items-center justify-between">
          <Logo />
          <nav className="lp-mono absolute left-1/2 hidden -translate-x-1/2 gap-10 text-[color:var(--lp-ink-soft)] min-[810px]:flex">
            <a href="#features" className="transition-colors hover:text-[color:var(--lp-ink)]">
              {t.nav.features}
            </a>
            <a href="#security" className="transition-colors hover:text-[color:var(--lp-ink)]">
              {t.nav.security}
            </a>
            <a href="#stack" className="transition-colors hover:text-[color:var(--lp-ink)]">
              {t.nav.stack}
            </a>
          </nav>
          <div className="flex items-center gap-1">
            {/* Under 360 px the row has no room left: the footer link switches the language there. */}
            <Button asChild variant="ghost" size="icon-lg" className="lp-mono max-[359px]:hidden">
              <Link
                to={t.otherLang.to}
                hrefLang={lang === "fr" ? "en" : "fr"}
                aria-label={t.otherLang.label}
                title={t.otherLang.label}
              >
                {lang === "fr" ? "EN" : "FR"}
              </Link>
            </Button>
            {/* From 960 px only: below, it would run into the centered nav or the logo. */}
            <Button asChild variant="ghost" size="icon-lg" className="max-[959px]:hidden">
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 16 16" fill="currentColor">
                  <title>GitHub</title>
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
                </svg>
              </a>
            </Button>
            <LpButton to={SITE_ONLY ? REPO_URL : "/personal/dashboard"} variant="primary" size="sm">
              {SITE_ONLY ? t.getIt : t.open}
            </LpButton>
          </div>
        </div>
      </header>

      <main>
        <section className="relative">
          <div className="lp-columns" aria-hidden="true" />
          <div className="lp-container relative flex flex-col items-center pt-[42px] pb-[47px] text-center min-[810px]:pt-24">
            <h1 className="lp-h1 relative max-w-[955px]">
              <span className="lp-line">
                <span>{t.heroLine1}</span>
              </span>
              <span className="lp-badge lp-mono">{t.badge}</span>
              <span className="lp-line" style={{ "--i": 1 } as CSSProperties}>
                <span>{t.heroLine2}</span>
              </span>
            </h1>
            <p className="lp-rise mt-5 max-w-[658px] text-[color:var(--lp-ink-soft)] [animation-delay:260ms] min-[810px]:text-[18px] min-[810px]:leading-[25.2px]">
              {t.heroSub}
            </p>
            <div className="lp-rise mt-10 flex w-full flex-col gap-2.5 [animation-delay:340ms] min-[810px]:mt-[72px] min-[810px]:w-auto min-[810px]:flex-row">
              <LpButton to={SITE_ONLY ? REPO_URL : "/personal/dashboard"} variant="primary">
                {SITE_ONLY ? t.getIt : t.open}
              </LpButton>
              <LpButton to="#features" variant="ghost">
                {t.seeFeatures}
              </LpButton>
            </div>
            <p className="lp-rise mt-12 font-['Geist_Mono',ui-monospace,monospace] text-[14px] text-[color:var(--lp-ink-soft)] [animation-delay:420ms]">
              <span className="select-none opacity-50">$ </span>
              <span className="lp-typed" style={{ "--chars": t.command.length } as CSSProperties}>
                {t.command}
              </span>
            </p>
            <div className="lp-rise mt-8 inline-flex h-10 items-center gap-3 rounded-[14px] bg-[var(--lp-surface)] py-1 pr-1 pl-3 text-[14px] [animation-delay:500ms]">
              {t.chipLabel}
              <span className="inline-flex h-8 items-center gap-1.5 rounded-[10px] bg-white px-2.5 font-medium shadow-[0_1px_2px_rgb(0_0_0/0.06)]">
                <LockKeyhole className="size-4" />
                {t.chipValue}
              </span>
            </div>
          </div>
        </section>

        <section id="stack" className="lp-container scroll-mt-8 py-10">
          <p data-reveal className="mx-auto mb-10 max-w-[658px] text-center">
            {t.definition}
          </p>
          <p data-reveal className="text-center text-[14px] leading-[19.6px] text-[color:var(--lp-ink-soft)]">
            {t.stackCaption}
          </p>
          <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-12 gap-y-5 min-[1200px]:justify-between min-[1200px]:px-6">
            {STACK.map((name, i) => (
              <li
                key={name}
                data-reveal
                style={{ "--i": i } as CSSProperties}
                className="text-[22px] leading-none font-semibold tracking-[-0.6px] text-[rgb(28_28_28/0.8)]"
              >
                {name}
              </li>
            ))}
          </ul>
        </section>

        <section id="features" className="lp-container scroll-mt-8 pt-20 min-[810px]:pt-[120px]">
          <div className="flex flex-col gap-6 min-[1200px]:flex-row min-[1200px]:items-end min-[1200px]:justify-between">
            <h2 className="lp-h2" data-reveal="lines">
              <span className="lp-line">
                <span>{t.sectionLine1}</span>
              </span>
              <span className="lp-line" style={{ "--i": 1 } as CSSProperties}>
                <span>{t.sectionLine2}</span>
              </span>
            </h2>
            <div
              data-reveal
              style={{ "--i": 2 } as CSSProperties}
              className="flex flex-col gap-2.5 min-[810px]:flex-row"
            >
              <LpButton to={SITE_ONLY ? REPO_URL : "/personal/dashboard"} variant="primary">
                {SITE_ONLY ? t.getIt : t.open}
              </LpButton>
              <LpButton to="/personal/vault" variant="ghost">
                {t.seeVault}
              </LpButton>
            </div>
          </div>
          <Showcase features={t.features} lang={lang} previous={t.previous} next={t.next} />
        </section>

        <section id="security" className="lp-container scroll-mt-8 pt-20 min-[810px]:pt-[120px]">
          <h2 className="lp-h2 max-w-[760px]" data-reveal>
            {t.securityTitle}
          </h2>
          <div className="mt-12 grid gap-10 min-[810px]:grid-cols-3">
            {t.security.map((item, i) => {
              const Icon = SECURITY_ICONS[i];
              return (
                <div
                  key={item.title}
                  data-reveal
                  style={{ "--i": i } as CSSProperties}
                  className="border-t border-[rgb(28_28_28/0.1)] pt-6"
                >
                  <span className="grid size-10 place-items-center rounded-[12px] bg-[var(--lp-surface)]">
                    <Icon className="size-5" />
                  </span>
                  <h3 className="mt-5 text-[20px] leading-[26px] font-semibold tracking-[-0.4px]">{item.title}</h3>
                  <p className="mt-3 text-[color:var(--lp-ink-soft)]">{item.text}</p>
                </div>
              );
            })}
          </div>
        </section>

        <Faq title={t.faqTitle} items={t.faq} lang={lang} />
      </main>

      <footer data-reveal className="lp-container pt-24 pb-10 min-[810px]:pt-[120px]">
        <Logo />
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 text-[14px] leading-[19.6px]">
          <p>
            © {new Date().getFullYear()} Keyfold. {t.footer}
          </p>
          <Link
            to={t.otherLang.to}
            className="text-[color:var(--lp-ink-soft)] transition-colors hover:text-[color:var(--lp-ink)]"
          >
            {t.otherLang.label}
          </Link>
        </div>
      </footer>
    </div>
  );
}

/**
 * The only button of the page. Same action, same look everywhere:
 * primary opens the vault and is the app's own Button (36 px or 50 px);
 * ghost leads anywhere else. The icon is set by the variant.
 */
function LpButton({
  to,
  variant,
  size = "lg",
  children,
}: {
  to: string;
  variant: "primary" | "ghost";
  size?: "sm" | "lg";
  children: ReactNode;
}) {
  const content = (
    <>
      {children}
      {variant === "primary" ? <ArrowUpRight /> : <ChevronRight />}
    </>
  );
  // The public site has no vault: a link into it is dropped.
  if (SITE_ONLY && to.startsWith("/personal")) return null;
  // In-page anchors and other sites are plain links; everything else goes through the router.
  const link = to.startsWith("#") ? (
    <a href={to}>{content}</a>
  ) : to.startsWith("https://") ? (
    <a href={to} target="_blank" rel="noopener noreferrer">
      {content}
    </a>
  ) : (
    <Link to={to}>{content}</Link>
  );
  if (variant === "primary") {
    return (
      <Button asChild size={size === "sm" ? "lg" : "xl"}>
        {link}
      </Button>
    );
  }
  return to.startsWith("#") ? (
    <a href={to} className={`lp-btn lp-btn-ghost lp-btn-${size}`}>
      {content}
    </a>
  ) : (
    <Link to={to} className={`lp-btn lp-btn-ghost lp-btn-${size}`}>
      {content}
    </Link>
  );
}

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 text-[20px] leading-none font-semibold tracking-[-0.6px]">
      <img src="/brand/logo-tile.png" alt="" className="size-8" />
      Keyfold
    </Link>
  );
}

/** Questions people ask about the product, and the same list as FAQPage JSON-LD for search and answer engines. */
function Faq({ title, items, lang }: { title: string; items: Content["faq"]; lang: Lang }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: lang,
    mainEntity: items.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
  return (
    <section id="faq" className="lp-container scroll-mt-8 pt-20 min-[810px]:pt-[120px]">
      <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      <h2 className="lp-h2 max-w-[760px]" data-reveal>
        {title}
      </h2>
      <div className="mt-12 max-w-[860px]">
        {items.map(({ question, answer }, i) => (
          <details key={question} data-reveal style={{ "--i": i } as CSSProperties} className="lp-faq">
            <summary>
              <h3>{question}</h3>
              <ChevronDown aria-hidden="true" />
            </summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/** One feature at a time: a dark visual on the left, its text on the right, arrows in between. */
function Showcase({
  features,
  lang,
  previous,
  next,
}: {
  features: Feature[];
  lang: Lang;
  previous: string;
  next: string;
}) {
  const [index, setIndex] = useState(0);
  // The new feature comes in from the side the arrow points to.
  const [from, setFrom] = useState("16px");
  const feature = features[index];
  const upcoming = features[index + 1];
  const icons = FEATURE_ICONS[feature.id];
  const go = (step: 1 | -1) => {
    setFrom(step === 1 ? "16px" : "-16px");
    setIndex(index + step);
  };
  const swap = { "--lp-from": from } as CSSProperties;

  return (
    <div
      data-reveal
      className="mt-12 flex flex-col gap-6 min-[1200px]:mt-6 min-[1200px]:h-[640px] min-[1200px]:flex-row min-[1200px]:items-center min-[1200px]:gap-0"
    >
      <div className="relative w-full shrink-0 min-[1200px]:w-[576px]">
        <div
          key={feature.id}
          style={swap}
          className="lp-card lp-swap aspect-[576/346] overflow-hidden p-6 min-[810px]:p-8"
        >
          <FeatureVisual id={feature.id} lang={lang} />
        </div>
        {upcoming && (
          <div
            aria-hidden="true"
            className="lp-card absolute inset-x-0 top-[calc(100%+25px)] hidden aspect-[576/346] scale-[0.88] opacity-40 [mask-image:linear-gradient(#000,transparent_45%)] min-[1200px]:block"
          />
        )}
      </div>

      <div className="flex gap-2 min-[1200px]:mx-[26px] min-[1200px]:flex-col">
        <button type="button" className="lp-arrow" aria-label={previous} disabled={index === 0} onClick={() => go(-1)}>
          <ChevronUp />
        </button>
        <button
          type="button"
          className="lp-arrow"
          aria-label={next}
          disabled={index === features.length - 1}
          onClick={() => go(1)}
        >
          <ChevronDown />
        </button>
      </div>

      <div key={feature.id} style={swap} className="lp-swap min-w-0 flex-1 min-[1200px]:pl-[22px]">
        <div className="flex items-center gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-[var(--lp-ink)] text-white">
            <icons.tile className="size-5" />
          </span>
          <h3 className="text-[32px] leading-[35.2px] font-semibold tracking-[-0.48px]">{feature.title}</h3>
        </div>
        <ul className="mt-6 flex flex-wrap gap-2">
          {feature.tags.map((tag, i) => {
            const TagIcon = icons.tags[i];
            return (
              <li key={tag} className="lp-tag">
                <TagIcon />
                {tag}
              </li>
            );
          })}
        </ul>
        <p className="mt-6 max-w-[530px] text-[color:var(--lp-ink-soft)]">{feature.description}</p>
        <div className="mt-8">
          <LpButton to={feature.link.to} variant="ghost" size="sm">
            {feature.link.label}
          </LpButton>
        </div>
      </div>
    </div>
  );
}

const FEATURE_ICONS: Record<Feature["id"], { tile: LucideIcon; tags: [LucideIcon, LucideIcon, LucideIcon] }> = {
  dashboard: { tile: LayoutDashboard, tags: [HeartPulse, Gauge, ChartColumn] },
  cli: { tile: SquareTerminal, tags: [KeyRound, FileCode, EyeOff] },
  mcp: { tile: Bot, tags: [Sparkles, EyeOff, Dices] },
  crypto: { tile: LockKeyhole, tags: [FileLock, Fingerprint, Hourglass] },
};

/** One per security claim, in the order of the copy: read a secret, know the password, keep a session. */
const SECURITY_ICONS: LucideIcon[] = [EyeOff, KeyRound, TimerReset];

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
function FeatureVisual({ id, lang }: { id: Feature["id"]; lang: Lang }) {
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
