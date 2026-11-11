import type { Metadata, Viewport } from "next";
import { CONTENT, type Lang } from "@/content/landing";
import { SITE_URL } from "@/lib/site";

// Paths of each language page, resolved against metadataBase.
export const PATHS: Record<Lang, string> = { fr: "/", en: "/en" };

const LOCALES: Record<Lang, string> = { fr: "fr_FR", en: "en_US" };

// French is the default page, as in the hreflang of the current site.
export const LANGUAGE_ALTERNATES = { fr: PATHS.fr, en: PATHS.en, "x-default": PATHS.fr };

export const OG_IMAGE = { url: "/og-image.png", width: 1200, height: 630, alt: "Keyfold" };

export const ICONS: Metadata["icons"] = {
  icon: [
    { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
  ],
  apple: "/apple-touch-icon.png",
};

// theme-color lives in the viewport export since Next 14, not in metadata.
export const VIEWPORT: Viewport = { themeColor: "#fcfcfc" };

export function pageMetadata(lang: Lang): Metadata {
  const { title, description } = CONTENT[lang];
  const other: Lang = lang === "fr" ? "en" : "fr";
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    alternates: { canonical: PATHS[lang], languages: LANGUAGE_ALTERNATES },
    openGraph: {
      type: "website",
      siteName: "Keyfold",
      url: PATHS[lang],
      title,
      description,
      locale: LOCALES[lang],
      alternateLocale: LOCALES[other],
      images: [OG_IMAGE],
    },
    twitter: { card: "summary_large_image", title, description, images: [OG_IMAGE.url] },
    icons: ICONS,
  };
}
