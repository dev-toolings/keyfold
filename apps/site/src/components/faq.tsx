import { ChevronDown } from "lucide-react";
import type { CSSProperties } from "react";
import type { Content, Lang } from "@/content/landing";

/**
 * Questions people ask about the product. Plain <details>, so no client JavaScript.
 * The same list is emitted as FAQPage JSON-LD by json-ld.tsx, which is why `lang` is unused here.
 */
export function Faq({ title, items }: { title: string; items: Content["faq"]; lang: Lang }) {
  return (
    <section id="faq" className="lp-container scroll-mt-8 pt-20 min-[810px]:pt-[120px]">
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
