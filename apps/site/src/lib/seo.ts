import type { Metadata, Viewport } from "next";
import { CONTENT, type Lang } from "@/content/landing";
import type { DocPage } from "@/content/pages";
import { SITE_URL } from "@/lib/site";

// Paths of each language page, resolved against metadataBase.
export const PATHS: Record<Lang, string> = { fr: "/", en: "/en" };

const LOCALES: Record<Lang, string> = { fr: "fr_FR", en: "en_US" };

// Date of the last content change of the home pages (ISO), published as lastmod in the sitemap.
// Change it with every edit of the home content, and only then.
export const HOME_UPDATED = "2026-11-11";

/** "/securite" in French, "/en/security" in English. */
export function docPath(page: DocPage, lang: Lang): string {
  const { slug } = page.content[lang];
  return lang === "fr" ? `/${slug}` : `/en/${slug}`;
}

// French is the default language, as in the hreflang of the first site.
export function languageAlternates(paths: Record<Lang, string>) {
  return { fr: paths.fr, en: paths.en, "x-default": paths.fr };
}

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
    alternates: { canonical: PATHS[lang], languages: languageAlternates(PATHS) },
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

/** Head tags of a content page. A page replaces `alternates` and `openGraph` whole, so both are complete here. */
export function docMetadata(page: DocPage, lang: Lang): Metadata {
  const { title, description } = page.content[lang];
  const other: Lang = lang === "fr" ? "en" : "fr";
  const paths = { fr: docPath(page, "fr"), en: docPath(page, "en") };
  return {
    title,
    description,
    alternates: { canonical: paths[lang], languages: languageAlternates(paths) },
    openGraph: {
      type: "article",
      siteName: "Keyfold",
      url: paths[lang],
      title,
      description,
      locale: LOCALES[lang],
      alternateLocale: LOCALES[other],
      images: [OG_IMAGE],
      modifiedTime: page.updated,
    },
    twitter: { card: "summary_large_image", title, description, images: [OG_IMAGE.url] },
  };
}
