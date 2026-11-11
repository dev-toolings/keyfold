// Owner: pages worker. Stub: will compose the landing sections (server component).
import type { Lang } from "@/content/landing";
import { CONTENT } from "@/content/landing";

/** Public product page: "/" in French, "/en" in English. */
export function LandingPage({ lang }: { lang: Lang }) {
  return (
    <div className="lp">
      <h1 className="lp-container lp-h1">{CONTENT[lang].heroLine1}</h1>
    </div>
  );
}
