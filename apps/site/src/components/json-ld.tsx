import { CONTENT, type Lang } from "@/content/landing";
import { OG_IMAGE, PATHS } from "@/lib/seo";
import { REPO_URL, SITE_URL } from "@/lib/site";

export function JsonLd({ lang }: { lang: Lang }) {
  const { definition, faq } = CONTENT[lang];
  const url = new URL(PATHS[lang], SITE_URL).href;
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: "Keyfold",
        url: `${SITE_URL}/`,
        inLanguage: ["fr", "en"],
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#software`,
        name: "Keyfold",
        // The visible definition of this page, so the description matches its language.
        description: definition,
        applicationCategory: "SecurityApplication",
        operatingSystem: "Linux",
        url,
        image: new URL(OG_IMAGE.url, SITE_URL).href,
        inLanguage: lang,
        codeRepository: REPO_URL,
      },
      {
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        url,
        inLanguage: lang,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": `${SITE_URL}/#software` },
        // Built from the same list as the visible FAQ, so the two cannot drift.
        mainEntity: faq.map(({ question, answer }) => ({
          "@type": "Question",
          name: question,
          acceptedAnswer: { "@type": "Answer", text: answer },
        })),
      },
    ],
  };
  // A string child of <script> is written raw by React (no HTML escaping), which keeps the JSON
  // valid without dangerouslySetInnerHTML; escaping "<" stops any "</script>" inside the content.
  return <script type="application/ld+json">{JSON.stringify(data).replace(/</g, "\\u003c")}</script>;
}
