// Owner: interactive worker. Stub: will port the visible FAQ list; its FAQPage JSON-LD lives in json-ld.tsx.
import type { Content, Lang } from "@/content/landing";

export function Faq({ title, items, lang }: { title: string; items: Content["faq"]; lang: Lang }) {
  return (
    <section id="faq" lang={lang}>
      <h2>{title}</h2>
      {items.map(({ question, answer }) => (
        <details key={question}>
          <summary>{question}</summary>
          <p>{answer}</p>
        </details>
      ))}
    </section>
  );
}
