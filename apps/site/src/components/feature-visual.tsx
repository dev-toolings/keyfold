// Owner: interactive worker. Stub: will port FeatureVisual from apps/web/src/pages/landing.tsx.
import type { Feature, Lang } from "@/content/landing";

/** Illustrations drawn in markup, with sample names and numbers. No screenshot, no real data. */
export function FeatureVisual({ id, lang }: { id: Feature["id"]; lang: Lang }) {
  return <div className="lp-card" data-feature={id} lang={lang} />;
}
