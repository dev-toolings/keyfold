import type { Metadata } from "next";
import { ICONS } from "@/lib/seo";
import "./globals.css";

// With two root layouts, unmatched URLs render this whole document (experimental.globalNotFound),
// exported as out/404.html. It bypasses both layouts, hence its own <html> and stylesheet.
export const metadata: Metadata = {
  title: "Page introuvable · Page not found | Keyfold",
  // Bypassing the layouts also drops their icons. Next adds noindex to this page by itself.
  icons: ICONS,
};

export default function GlobalNotFound() {
  return (
    <html lang="fr">
      <body>
        <main className="lp lp-container flex flex-col items-center justify-center gap-6 text-center">
          <h1 className="lp-h2">404</h1>
          <p>
            Cette page n'existe pas. <span lang="en">This page does not exist.</span>
          </p>
          <p className="lp-mono flex gap-8">
            <a href="/">Accueil</a>
            <a href="/en" hrefLang="en" lang="en">
              Home
            </a>
          </p>
        </main>
      </body>
    </html>
  );
}
