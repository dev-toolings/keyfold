import { EyeOff, KeyRound, LockKeyhole, type LucideIcon, TimerReset } from "lucide-react";
import type { CSSProperties } from "react";
import { Faq } from "@/components/faq";
import { Logo } from "@/components/logo";
import { LpButton } from "@/components/lp-button";
import { Reveal } from "@/components/reveal";
import { Showcase } from "@/components/showcase";
import { Button } from "@/components/ui/button";
import { CONTENT, type Lang, STACK } from "@/content/landing";
import { REPO_URL } from "@/lib/site";

/** One per security claim, in the order of the copy: read a secret, know the password, keep a session. */
const SECURITY_ICONS: LucideIcon[] = [EyeOff, KeyRound, TimerReset];

/** Public product page: "/" in French, "/en" in English. */
export function LandingPage({ lang }: { lang: Lang }) {
  const t = CONTENT[lang];
  const otherLang = lang === "fr" ? "en" : "fr";

  return (
    <div className="lp">
      <Reveal />
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
              <a href={t.otherLang.to} hrefLang={otherLang} aria-label={t.otherLang.label} title={t.otherLang.label}>
                {lang === "fr" ? "EN" : "FR"}
              </a>
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
            <LpButton to={REPO_URL} variant="primary" size="sm">
              {t.getIt}
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
              <LpButton to={REPO_URL} variant="primary">
                {t.getIt}
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
              <LpButton to={REPO_URL} variant="primary">
                {t.getIt}
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
          <a
            href={t.otherLang.to}
            hrefLang={otherLang}
            className="text-[color:var(--lp-ink-soft)] transition-colors hover:text-[color:var(--lp-ink)]"
          >
            {t.otherLang.label}
          </a>
        </div>
      </footer>
    </div>
  );
}
