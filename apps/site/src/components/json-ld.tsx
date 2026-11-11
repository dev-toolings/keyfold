// Owner: SEO worker. Stub: will render the SoftwareApplication and FAQPage JSON-LD for the page language.
import type { Lang } from "@/content/landing";

export function JsonLd({ lang }: { lang: Lang }) {
  return <script type="application/ld+json" data-lang={lang} />;
}
