import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { JsonLd } from "@/components/json-ld";
import { pageMetadata, VIEWPORT } from "@/lib/seo";
import "../globals.css";

// Root layout of the English page: each language has its own, so each gets its own <html lang>.
export const metadata: Metadata = pageMetadata("en");
export const viewport: Viewport = VIEWPORT;

export default function EnglishLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <JsonLd lang="en" />
      </body>
    </html>
  );
}
