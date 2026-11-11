import { CONTENT, type Lang } from "@/content/landing";
import { type DocPage, PAGE_LABELS } from "@/content/pages";
import { docPath, OG_IMAGE, PATHS } from "@/lib/seo";
import { REPO_URL, SITE_URL } from "@/lib/site";

const WEBSITE_ID = `${SITE_URL}/#website`;
const SOFTWARE_ID = `${SITE_URL}/#software`;
const absolute = (path: string) => new URL(path, SITE_URL).href;

// A string child of <script> is written raw by React (no HTML escaping), which keeps the JSON
// valid without dangerouslySetInnerHTML; escaping "<" stops any "</script>" inside the content.
function Graph({ nodes }: { nodes: object[] }) {
  const data = { "@context": "https://schema.org", "@graph": nodes };
  return <script type="application/ld+json">{JSON.stringify(data).replace(/</g, "\\u003c")}</script>;
}

/** On every page, from the layout: the site and the software it presents. */
export function JsonLd({ lang }: { lang: Lang }) {
  return (
    <Graph
      nodes={[
        { "@type": "WebSite", "@id": WEBSITE_ID, name: "Keyfold", url: `${SITE_URL}/`, inLanguage: ["fr", "en"] },
        {
          "@type": "SoftwareApplication",
          "@id": SOFTWARE_ID,
          name: "Keyfold",
          // The visible definition of the home page, in the language of this page.
          description: CONTENT[lang].definition,
          applicationCategory: "SecurityApplication",
          operatingSystem: "Linux",
          // Same @id on every page, so the same url.
          url: `${SITE_URL}/`,
          image: absolute(OG_IMAGE.url),
          // codeRepository belongs to SoftwareSourceCode, not to SoftwareApplication.
          sameAs: REPO_URL,
        },
      ]}
    />
  );
}

/** On the home page only: built from the same list as the visible FAQ, so the two cannot drift. */
export function FaqJsonLd({ lang }: { lang: Lang }) {
  const url = absolute(PATHS[lang]);
  return (
    <Graph
      nodes={[
        {
          "@type": "FAQPage",
          "@id": `${url}#faq`,
          url,
          inLanguage: lang,
          isPartOf: { "@id": WEBSITE_ID },
          about: { "@id": SOFTWARE_ID },
          mainEntity: CONTENT[lang].faq.map(({ question, answer }) => ({
            "@type": "Question",
            name: question,
            acceptedAnswer: { "@type": "Answer", text: answer },
          })),
        },
      ]}
    />
  );
}

/** On a content page: where it sits in the site, and the article itself. */
export function DocJsonLd({ page, lang }: { page: DocPage; lang: Lang }) {
  const t = page.content[lang];
  const url = absolute(docPath(page, lang));
  return (
    <Graph
      nodes={[
        {
          "@type": "BreadcrumbList",
          "@id": `${url}#breadcrumb`,
          itemListElement: [
            { "@type": "ListItem", position: 1, name: PAGE_LABELS[lang].home, item: absolute(PATHS[lang]) },
            { "@type": "ListItem", position: 2, name: t.nav, item: url },
          ],
        },
        {
          "@type": "TechArticle",
          "@id": `${url}#article`,
          headline: t.h1,
          description: t.description,
          url,
          mainEntityOfPage: url,
          inLanguage: lang,
          dateModified: page.updated,
          image: absolute(OG_IMAGE.url),
          isPartOf: { "@id": WEBSITE_ID },
          about: { "@id": SOFTWARE_ID },
        },
      ]}
    />
  );
}
