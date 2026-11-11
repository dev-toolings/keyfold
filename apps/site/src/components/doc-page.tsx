import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { Lang } from "@/content/landing";
import { type Block, type DocPage, PAGE_LABELS, PAGES } from "@/content/pages";
import { docPath, PATHS } from "@/lib/seo";

/** Text between backticks becomes inline code; the rest stays plain text. */
function Rich({ text }: { text: string }) {
  return text.split("`").map((part, i) => {
    // The parts never reorder: the position is the identity.
    // biome-ignore lint/suspicious/noArrayIndexKey: static split of a constant string.
    return i % 2 === 1 ? <code key={i}>{part}</code> : <Fragment key={i}>{part}</Fragment>;
  });
}

function BlockView({ block }: { block: Block }) {
  if ("p" in block) {
    return (
      <p>
        <Rich text={block.p} />
      </p>
    );
  }
  if ("list" in block) {
    return (
      <ul>
        {block.list.map((item) => (
          <li key={item}>
            <Rich text={item} />
          </li>
        ))}
      </ul>
    );
  }
  if ("code" in block) {
    return (
      <pre>
        <code>{block.code}</code>
      </pre>
    );
  }
  return (
    // A wide command table scrolls inside its own box on a phone, not the page.
    <div className="lp-doc-table">
      <table>
        <thead>
          <tr>
            {block.table.head.map((cell) => (
              <th key={cell} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.table.rows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell) => (
                <td key={cell}>
                  <Rich text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A content page: one topic, the answer first, then one question per section. */
export function DocPageView({ page, lang }: { page: DocPage; lang: Lang }) {
  const t = page.content[lang];
  const labels = PAGE_LABELS[lang];
  const otherHref = docPath(page, lang === "fr" ? "en" : "fr");
  const date = new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", { dateStyle: "long", timeZone: "UTC" });

  return (
    <div className="lp">
      <SiteHeader lang={lang} otherHref={otherHref} />
      <main className="lp-container">
        <article className="lp-doc">
          <nav aria-label={lang === "fr" ? "Fil d'Ariane" : "Breadcrumb"} className="lp-doc-crumbs">
            <a href={PATHS[lang]}>{labels.home}</a>
            <ChevronRight aria-hidden="true" className="size-3.5" />
            <span aria-current="page">{t.nav}</span>
          </nav>
          <h1>{t.h1}</h1>
          <p className="lp-doc-lede">
            <Rich text={t.lede} />
          </p>
          <p className="lp-doc-date">
            {labels.updated} <time dateTime={page.updated}>{date.format(new Date(page.updated))}</time>
          </p>

          <div className="lp-doc-grid">
            <nav aria-label={labels.onThisPage} className="lp-doc-toc">
              <p>{labels.onThisPage}</p>
              <ul>
                {t.sections.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`}>{section.title}</a>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="lp-doc-body">
              {t.sections.map((section) => (
                <section key={section.id} id={section.id}>
                  <h2>{section.title}</h2>
                  {section.blocks.map((block, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: the blocks of a section are a constant list.
                    <BlockView key={i} block={block} />
                  ))}
                </section>
              ))}
              <section>
                <h2>{labels.related}</h2>
                <ul className="lp-doc-related">
                  {PAGES.filter((other) => other.key !== page.key).map((other) => (
                    <li key={other.key}>
                      <a href={docPath(other, lang)} className="group">
                        {other.content[lang].h1}
                        <ChevronRight
                          aria-hidden="true"
                          className="size-[18px] shrink-0 text-[color:var(--lp-ink-soft)] transition-transform duration-200 group-hover:translate-x-[3px] motion-reduce:transition-none"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </article>
      </main>
      <SiteFooter lang={lang} otherHref={otherHref} />
    </div>
  );
}
