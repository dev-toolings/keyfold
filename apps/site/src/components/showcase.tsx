"use client";

import {
  Bot,
  ChartColumn,
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
import { type CSSProperties, type KeyboardEvent, useRef, useState } from "react";
import { LpButton } from "@/components/lp-button";
import type { Feature, Lang } from "@/content/landing";
import { FeatureVisual } from "./feature-visual";

const FEATURE_ICONS: Record<Feature["id"], { tile: LucideIcon; tags: [LucideIcon, LucideIcon, LucideIcon] }> = {
  dashboard: { tile: LayoutDashboard, tags: [HeartPulse, Gauge, ChartColumn] },
  cli: { tile: SquareTerminal, tags: [KeyRound, FileCode, EyeOff] },
  mcp: { tile: Bot, tags: [Sparkles, EyeOff, Dices] },
  crypto: { tile: LockKeyhole, tags: [FileLock, Fingerprint, Hourglass] },
};

/**
 * One feature at a time, picked from a row of tabs on the page grid: its dark visual on
 * the left, its text on the right. Arrow keys move between tabs (WAI-ARIA tabs pattern).
 */
export function Showcase({ features, lang, labelledBy }: { features: Feature[]; lang: Lang; labelledBy: string }) {
  const [index, setIndex] = useState(0);
  // The new feature comes in from the side of the tab that was picked.
  const [from, setFrom] = useState("16px");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const select = (next: number) => {
    if (next === index) return;
    setFrom(next > index ? "16px" : "-16px");
    setIndex(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = features.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(next);
    tabs.current[next]?.focus();
  };
  const swap = { "--lp-from": from } as CSSProperties;

  return (
    <div data-reveal className="mt-12 min-[810px]:mt-16">
      <div
        role="tablist"
        aria-labelledby={labelledBy}
        onKeyDown={onKeyDown}
        className="grid grid-cols-2 gap-x-6 min-[1024px]:grid-cols-4"
      >
        {features.map((item, i) => {
          const Tile = FEATURE_ICONS[item.id].tile;
          return (
            <button
              key={item.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`feature-tab-${item.id}`}
              aria-selected={i === index}
              aria-controls={`feature-panel-${item.id}`}
              tabIndex={i === index ? 0 : -1}
              onClick={() => select(i)}
              className="lp-tab"
            >
              <Tile aria-hidden="true" />
              {item.title}
            </button>
          );
        })}
      </div>

      {/* Every feature's text is in the prerendered HTML so crawlers read all of it; the
          inactive panels are `hidden`. Showing a panel again restarts its animations. */}
      {features.map((item, i) => {
        const icons = FEATURE_ICONS[item.id];
        return (
          <div
            key={item.id}
            role="tabpanel"
            id={`feature-panel-${item.id}`}
            aria-labelledby={`feature-tab-${item.id}`}
            hidden={i !== index}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: WAI-ARIA tabs: the panel takes focus so Tab from a tab enters its text, not only its link.
            tabIndex={0}
            style={swap}
            className="lp-swap mt-8 grid items-center gap-8 min-[1024px]:mt-10 min-[1024px]:grid-cols-12 min-[1024px]:gap-12"
          >
            <div className="lp-card aspect-[5/4] overflow-hidden min-[640px]:aspect-[576/346] p-6 min-[810px]:p-8 min-[1024px]:col-span-7">
              <FeatureVisual id={item.id} lang={lang} />
            </div>
            <div className="min-w-0 min-[1024px]:col-span-5">
              <h3 className="text-[28px] leading-[32px] font-semibold tracking-[-0.6px] min-[810px]:text-[32px] min-[810px]:leading-[35.2px]">
                {item.title}
              </h3>
              <ul className="mt-5 flex flex-wrap gap-2">
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
              <p className="mt-5 max-w-[530px] text-[color:var(--lp-ink-soft)]">{item.description}</p>
              <div className="mt-8">
                <LpButton to={item.link.to} variant="ghost" size="sm">
                  {item.link.label}
                </LpButton>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
