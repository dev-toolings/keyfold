import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { JsonLd } from "@/components/json-ld";
import { pageMetadata, VIEWPORT } from "@/lib/seo";
import "../globals.css";

// Root layout of the French page: each language has its own, so each gets its own <html lang>.
export const metadata: Metadata = pageMetadata("fr");
export const viewport: Viewport = VIEWPORT;

export default function FrenchLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>
        {children}
        <JsonLd lang="fr" />
      </body>
    </html>
  );
}
