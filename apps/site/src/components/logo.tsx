import type { Lang } from "@/content/landing";

/** Links to the page of the current language: "/en" for English, "/" otherwise. */
export function Logo({ lang }: { lang: Lang }) {
  return (
    <a
      href={lang === "en" ? "/en" : "/"}
      className="flex items-center gap-2.5 text-[20px] leading-none font-semibold tracking-[-0.6px]"
    >
      {/* biome-ignore lint/performance/noImgElement: static export, a 32 px PNG needs no optimizer. */}
      <img src="/brand/logo-tile.png" alt="" width={32} height={32} className="size-8" />
      Keyfold
    </a>
  );
}
