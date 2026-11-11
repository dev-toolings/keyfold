"use client";

import {
  Bot,
  ChartColumn,
  ChevronDown,
  ChevronUp,
  Dices,
  EyeOff,
  FileCode,
  FileLock,
  Fingerprint,
  Gauge,
  HeartPulse,
  Hourglass,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  type LucideIcon,
  Sparkles,
  SquareTerminal,
} from "lucide-react";
import { type CSSProperties, useState } from "react";
import { LpButton } from "@/components/lp-button";
import type { Feature, Lang } from "@/content/landing";
import { FeatureVisual } from "./feature-visual";

const FEATURE_ICONS: Record<Feature["id"], { tile: LucideIcon; tags: [LucideIcon, LucideIcon, LucideIcon] }> = {
  dashboard: { tile: LayoutDashboard, tags: [HeartPulse, Gauge, ChartColumn] },
  cli: { tile: SquareTerminal, tags: [KeyRound, FileCode, EyeOff] },
  mcp: { tile: Bot, tags: [Sparkles, EyeOff, Dices] },
  crypto: { tile: LockKeyhole, tags: [FileLock, Fingerprint, Hourglass] },
};

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
  const [index, setIndex] = useState(0);
  // The new feature comes in from the side the arrow points to.
  const [from, setFrom] = useState("16px");
  const feature = features[index];
  const upcoming = features[index + 1];
  const go = (step: 1 | -1) => {
    setFrom(step === 1 ? "16px" : "-16px");
    setIndex(index + step);
  };
  const swap = { "--lp-from": from } as CSSProperties;

  return (
    <div
      data-reveal
      className="mt-12 flex flex-col gap-6 min-[1200px]:mt-6 min-[1200px]:h-[640px] min-[1200px]:flex-row min-[1200px]:items-center min-[1200px]:gap-0"
    >
      <div className="relative w-full shrink-0 min-[1200px]:w-[576px]">
        <div
          key={feature.id}
          style={swap}
          className="lp-card lp-swap aspect-[576/346] overflow-hidden p-6 min-[810px]:p-8"
        >
          <FeatureVisual id={feature.id} lang={lang} />
        </div>
        {upcoming && (
          <div
            aria-hidden="true"
            className="lp-card absolute inset-x-0 top-[calc(100%+25px)] hidden aspect-[576/346] scale-[0.88] opacity-40 [mask-image:linear-gradient(#000,transparent_45%)] min-[1200px]:block"
          />
        )}
      </div>

      <div className="flex gap-2 min-[1200px]:mx-[26px] min-[1200px]:flex-col">
        <button type="button" className="lp-arrow" aria-label={previous} disabled={index === 0} onClick={() => go(-1)}>
          <ChevronUp />
        </button>
        <button
          type="button"
          className="lp-arrow"
          aria-label={next}
          disabled={index === features.length - 1}
          onClick={() => go(1)}
        >
          <ChevronDown />
        </button>
      </div>

      {/* Every feature's text is in the prerendered HTML so crawlers read all of it; the
          inactive ones are `hidden`, like before for people and screen readers. Showing a
          panel again restarts its lp-swap animation, as the remount did in apps/web. */}
      {features.map((item, i) => {
        const icons = FEATURE_ICONS[item.id];
        return (
          <div
            key={item.id}
            hidden={i !== index}
            style={swap}
            className="lp-swap min-w-0 flex-1 min-[1200px]:pl-[22px]"
          >
            <div className="flex items-center gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-[var(--lp-ink)] text-white">
                <icons.tile className="size-5" />
              </span>
              <h3 className="text-[32px] leading-[35.2px] font-semibold tracking-[-0.48px]">{item.title}</h3>
            </div>
            <ul className="mt-6 flex flex-wrap gap-2">
              {item.tags.map((tag, t) => {
                const TagIcon = icons.tags[t];
                return (
                  <li key={tag} className="lp-tag">
                    <TagIcon />
                    {tag}
                  </li>
                );
              })}
            </ul>
            <p className="mt-6 max-w-[530px] text-[color:var(--lp-ink-soft)]">{item.description}</p>
            <div className="mt-8">
              <LpButton to={item.link.to} variant="ghost" size="sm">
                {item.link.label}
              </LpButton>
            </div>
          </div>
        );
      })}
    </div>
  );
}
