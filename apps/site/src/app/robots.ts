// Owner: SEO worker. Stub: will set the crawler rules and the sitemap URL.
import type { MetadataRoute } from "next";

// Without it, output: "export" refuses the route at build time.
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" } };
}
