import type { MetadataRoute } from "next";
import type { Lang } from "@/content/landing";
import { PAGES } from "@/content/pages";
import { docPath, HOME_UPDATED, languageAlternates, PATHS } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";

// Without it, output: "export" refuses the route at build time.
export const dynamic = "force-static";

const absolute = (path: string) => new URL(path, SITE_URL).href;

// One entry per language of a page, each naming every language version (hreflang).
// lastModified is the date the content last changed, kept by hand: a build date would
// claim a change on every deploy.
function entries(paths: Record<Lang, string>, updated: string): MetadataRoute.Sitemap {
  const languages = Object.fromEntries(
    Object.entries(languageAlternates(paths)).map(([hreflang, path]) => [hreflang, absolute(path)]),
  );
  return Object.values(paths).map((path) => ({
    url: absolute(path),
    lastModified: updated,
    alternates: { languages },
  }));
}

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...entries(PATHS, HOME_UPDATED),
    ...PAGES.flatMap((page) => entries({ fr: docPath(page, "fr"), en: docPath(page, "en") }, page.updated)),
  ];
}
