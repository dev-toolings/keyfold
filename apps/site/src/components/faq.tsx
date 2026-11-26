import { ChevronDown } from "lucide-react";
import type { CSSProperties } from "react";
import type { Content, Lang } from "@/content/landing";

/**
 * Questions people ask about the product. Plain <details>, so no client JavaScript.
 * The same list is emitted as FAQPage JSON-LD by json-ld.tsx, which is why `lang` is unused here.
 */
export function Faq({ title, items }: { title: string; items: Content["faq"]; lang: Lang }) {
  return (
    <section
      id="faq"
      className="lp-container grid scroll-mt-8 gap-12 pt-20 min-[810px]:pt-[120px] min-[1024px]:grid-cols-12 min-[1024px]:gap-12"
    >
      {/* From 1024 px the title holds the left third and the questions run to the right edge of the grid. */}
      <h2
        className="lp-h2 min-[1024px]:sticky min-[1024px]:top-8 min-[1024px]:col-span-4 min-[1024px]:self-start"
        data-reveal
      >
        {title}
      </h2>
      <div className="min-[1024px]:col-span-8">
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
