import { Logo } from "@/components/logo";
import { LpButton } from "@/components/lp-button";
import { Button } from "@/components/ui/button";
import { CONTENT, type Lang } from "@/content/landing";
import { PATHS } from "@/lib/seo";
import { REPO_URL } from "@/lib/site";

/**
 * The header of every page. `otherHref` is the same page in the other language.
 * On the home page the nav scrolls to its sections; elsewhere it leads back to them.
 */
export function SiteHeader({ lang, otherHref, home = false }: { lang: Lang; otherHref: string; home?: boolean }) {
  const t = CONTENT[lang];
  const base = home ? "" : PATHS[lang];
  return (
    <header className="lp-container lp-fade pt-6 min-[810px]:pt-8">
      <div className="relative flex h-9 items-center justify-between">
        <Logo lang={lang} />
        <nav className="lp-mono absolute left-1/2 hidden -translate-x-1/2 gap-10 text-[color:var(--lp-ink-soft)] min-[810px]:flex">
          <a href={`${base}#features`} className="transition-colors hover:text-[color:var(--lp-ink)]">
            {t.nav.features}
          </a>
          <a href={`${base}#security`} className="transition-colors hover:text-[color:var(--lp-ink)]">
            {t.nav.security}
          </a>
          <a href={`${base}#stack`} className="transition-colors hover:text-[color:var(--lp-ink)]">
            {t.nav.stack}
          </a>
        </nav>
        <div className="flex items-center gap-1">
          {/* Under 360 px the row has no room left: the footer link switches the language there. */}
          <Button asChild variant="ghost" size="icon-lg" className="lp-mono max-[359px]:hidden">
            <a
              href={otherHref}
              hrefLang={lang === "fr" ? "en" : "fr"}
              aria-label={t.otherLang.label}
              title={t.otherLang.label}
            >
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
  );
}
