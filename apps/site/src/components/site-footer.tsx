import { Logo } from "@/components/logo";
import { CONTENT, type Lang } from "@/content/landing";
import { PAGE_LABELS, PAGES } from "@/content/pages";
import { docPath } from "@/lib/seo";

/**
 * The footer of every page: it links each content page, so all of them are one click
 * from anywhere. `otherHref` is the same page in the other language.
 */
export function SiteFooter({ lang, otherHref, reveal = false }: { lang: Lang; otherHref: string; reveal?: boolean }) {
  const t = CONTENT[lang];
  return (
    <footer {...(reveal ? { "data-reveal": "" } : {})} className="lp-container pt-24 pb-10 min-[810px]:pt-[120px]">
      <Logo lang={lang} />
      <nav
        aria-label={PAGE_LABELS[lang].docs}
        className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-[14px] leading-[19.6px]"
      >
        {PAGES.map((page) => (
          <a
            key={page.key}
            href={docPath(page, lang)}
            className="text-[color:var(--lp-ink-soft)] transition-colors hover:text-[color:var(--lp-ink)]"
          >
            {page.content[lang].nav}
          </a>
        ))}
      </nav>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 text-[14px] leading-[19.6px]">
        <p>
          © {new Date().getFullYear()} Keyfold. {t.footer}
        </p>
        <a
          href={otherHref}
          hrefLang={lang === "fr" ? "en" : "fr"}
          className="text-[color:var(--lp-ink-soft)] transition-colors hover:text-[color:var(--lp-ink)]"
        >
          {t.otherLang.label}
        </a>
      </div>
    </footer>
  );
}
