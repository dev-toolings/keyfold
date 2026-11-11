import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Without it, output: "export" refuses the route at build time.
export const dynamic = "force-static";

// Same paths for every crawler: the vault app (/personal/) and the API (/api/) are private.
const PUBLIC_ONLY = { allow: ["/", "/en"], disallow: ["/personal/", "/api/"] };

// AI crawlers keep their own group, as in the current robots.txt: welcome on the public pages only.
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "PerplexityBot",
  "Google-Extended",
  "Applebot-Extended",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", ...PUBLIC_ONLY },
      { userAgent: AI_CRAWLERS, ...PUBLIC_ONLY },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
