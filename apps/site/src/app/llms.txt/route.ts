// Short product summary for answer engines, built from the page content so it cannot drift.
import { CONTENT } from "@/content/landing";
import { PAGES } from "@/content/pages";
import { PAGE_URL, plainText, README_URL } from "@/lib/llms";
import { docPath } from "@/lib/seo";
import { REPO_URL, SITE_URL } from "@/lib/site";

// Without it, output: "export" refuses the route at build time.
export const dynamic = "force-static";

export function GET(): Response {
  return plainText([
    "# Keyfold",
    "",
    `> ${CONTENT.en.definition}`,
    "",
    "Items (passwords, API tokens, SSH passphrases, notes) are encrypted with age (X25519 identity, protected by the master password through scrypt) on the operator's own machine. It has a Go server, a Go command line tool (`kf`) with an MCP server for AI agents, and a React web UI. The server only ever stores encrypted files.",
    "",
    "Encryption happens in the browser or in the CLI, never on the server. No MCP tool returns a secret value. The server speaks plain HTTP and is meant to run on 127.0.0.1 for now (no TLS yet).",
    "",
    "## Product page",
    "",
    `- [Product page (French)](${PAGE_URL.fr}): features, security model, FAQ`,
    `- [Product page (English)](${PAGE_URL.en}): same content in English`,
    `- [Full description for language models](${SITE_URL}/llms-full.txt): a self-contained factual summary in English`,
    "",
    "## Documentation",
    "",
    ...PAGES.map((page) => {
      const en = page.content.en;
      return `- [${en.h1}](${SITE_URL}${docPath(page, "en")}): ${en.description} French version: ${SITE_URL}${docPath(page, "fr")}`;
    }),
    "",
    "## Source and documentation",
    "",
    `- [GitHub repository](${REPO_URL}): Go server, CLI, MCP server and web UI source code`,
    `- [README](${README_URL}): install, CLI commands, MCP tools, security model, what is not done`,
    "",
    "## Optional",
    "",
    "- [age encryption](https://age-encryption.org): the file encryption format and tool the vault is built on",
  ]);
}
