// Owner: SEO worker. Stub: will list "/" and "/en" with their hreflang alternates.
import type { MetadataRoute } from "next";

// Without it, output: "export" refuses the route at build time.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [];
}
