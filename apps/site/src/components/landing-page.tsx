import { EyeOff, KeyRound, LockKeyhole, type LucideIcon, TimerReset } from "lucide-react";
import type { CSSProperties } from "react";
import { Faq } from "@/components/faq";
import { LpButton } from "@/components/lp-button";
import { Reveal } from "@/components/reveal";
import { Showcase } from "@/components/showcase";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StackLogo } from "@/components/stack-logos";
import { CONTENT, type Lang, STACK } from "@/content/landing";
import { REPO_URL } from "@/lib/site";

/** One per security claim, in the order of the copy: read a secret, know the password, keep a session. */
const SECURITY_ICONS: LucideIcon[] = [EyeOff, KeyRound, TimerReset];

/** Public product page: "/" in French, "/en" in English. */
export function LandingPage({ lang }: { lang: Lang }) {
  const t = CONTENT[lang];

  return (
    <div className="lp">
      <Reveal />
      <SiteHeader lang={lang} otherHref={t.otherLang.to} home />

      <main>
        <section className="relative">
          <div className="lp-columns" aria-hidden="true" />
          <div className="lp-container relative flex flex-col items-center pt-[72px] pb-[47px] text-center min-[810px]:pt-28">
            {/* The label reads after the headline and is drawn above it. */}
            <div className="relative max-w-[955px]">
              <h1 className="lp-h1">
                <span className="lp-line">
                  <span>{t.heroLine1}</span>
                </span>
                <span className="lp-line" style={{ "--i": 1 } as CSSProperties}>
                  <span>{t.heroLine2}</span>
                </span>
              </h1>
              <span className="lp-badge lp-mono">{t.badge}</span>
            </div>
            <p className="lp-rise mt-5 max-w-[658px] text-[color:var(--lp-ink-soft)] [animation-delay:260ms] min-[810px]:text-[18px] min-[810px]:leading-[25.2px]">
              {t.heroSub}
            </p>
            <div className="lp-rise mt-10 flex w-full flex-col gap-2.5 [animation-delay:340ms] min-[810px]:mt-12 min-[810px]:w-auto min-[810px]:flex-row">
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

        <section id="stack" className="lp-container scroll-mt-8 pt-12 min-[810px]:pt-20">
          <p
            data-reveal
            className="mx-auto max-w-[658px] text-center text-balance min-[810px]:text-[18px] min-[810px]:leading-[25.2px]"
          >
            {t.definition}
          </p>
          <p
            data-reveal
            className="mt-12 text-center text-[14px] leading-[19.6px] text-[color:var(--lp-ink-soft)] min-[810px]:mt-16"
          >
            {t.stackCaption}
          </p>
          {/* One cell per brick, edge to edge on the page grid: the hairlines are the gaps. */}
          <ul data-reveal className="lp-stack mt-6 grid grid-cols-2 min-[640px]:grid-cols-3 min-[1024px]:grid-cols-6">
            {STACK.map((name) => (
              <li key={name}>
                <StackLogo name={name} />
                {name}
              </li>
            ))}
          </ul>
        </section>

        <section id="features" className="lp-container scroll-mt-8 pt-20 min-[810px]:pt-[120px]">
          <div className="flex flex-col gap-8 min-[1024px]:flex-row min-[1024px]:items-end min-[1024px]:justify-between">
            <h2 id="features-title" className="lp-h2" data-reveal="lines">
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
          <Showcase features={t.features} lang={lang} labelledBy="features-title" />
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

      <SiteFooter lang={lang} otherHref={t.otherLang.to} reveal />
    </div>
  );
}
