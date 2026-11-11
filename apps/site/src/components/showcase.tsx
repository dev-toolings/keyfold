// Owner: interactive worker. Stub: will port the Showcase carousel from apps/web/src/pages/landing.tsx.
"use client";

import type { Feature, Lang } from "@/content/landing";
import { FeatureVisual } from "./feature-visual";

/** One feature at a time: a dark visual on the left, its text on the right, arrows in between. */
export function Showcase({
  features,
  lang,
  previous,
  next,
}: {
  features: Feature[];
  lang: Lang;
  previous: string;
  next: string;
}) {
  const feature = features[0];
  return (
    <div data-reveal>
      <FeatureVisual id={feature.id} lang={lang} />
      <button type="button" className="lp-arrow" aria-label={previous} disabled />
      <button type="button" className="lp-arrow" aria-label={next} disabled />
      <h3>{feature.title}</h3>
    </div>
  );
}
