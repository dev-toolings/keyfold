import type { MetadataRoute } from "next";
import { LANGUAGE_ALTERNATES, PATHS } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";

// Without it, output: "export" refuses the route at build time.
export const dynamic = "force-static";

const absolute = (path: string) => new URL(path, SITE_URL).href;

// No lastModified: the export has no real edit date, and a build date would claim a change on every deploy.
export default function sitemap(): MetadataRoute.Sitemap {
  const languages = Object.fromEntries(
    Object.entries(LANGUAGE_ALTERNATES).map(([hreflang, path]) => [hreflang, absolute(path)]),
  );
  return Object.values(PATHS).map((path) => ({ url: absolute(path), alternates: { languages } }));
}
