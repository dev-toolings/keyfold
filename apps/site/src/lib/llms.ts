// Shared pieces of /llms.txt and /llms-full.txt (llmstxt.org convention: Markdown body).
import { REPO_URL, SITE_URL } from "@/lib/site";

export const PAGE_URL = { fr: `${SITE_URL}/`, en: `${SITE_URL}/en` };
export const README_URL = `${REPO_URL}/blob/main/README.md`;

// Page titles end with a period; Markdown headings read better without it.
export function heading(title: string): string {
  return title.replace(/\.$/, "");
}

// text/plain so browsers show the file instead of downloading it; the body is still Markdown.
export function plainText(lines: string[]): Response {
  return new Response(`${lines.join("\n")}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
