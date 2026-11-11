import { useEffect } from "react";
import { useLocation } from "react-router";
import { CONTENT, type Lang } from "@/pages/landing-content";

const ORIGIN = "https://keyfold.pulseview.app";
const PUBLIC_PAGES: Record<string, Lang> = { "/": "fr", "/en": "en" };
const LOCALES: Record<Lang, string> = { fr: "fr_FR", en: "en_US" };

/**
 * Keeps the head tags of index.html in step with the route: "/" gets the French values,
 * "/en" the English ones, and /personal/* (the private vault app) gets noindex.
 */
export function RouteHead() {
  const { pathname } = useLocation();

  useEffect(() => {
    const path = pathname.replace(/\/+$/, "") || "/";
    const lang = PUBLIC_PAGES[path];
    const set = (selector: string, attribute: string, value: string) =>
      document.head.querySelector(selector)?.setAttribute(attribute, value);

    if (lang) {
      const t = CONTENT[lang];
      const url = `${ORIGIN}${path}`;
      document.documentElement.lang = lang;
      document.title = t.title;
      set('meta[name="description"]', "content", t.description);
      set('link[rel="canonical"]', "href", url);
      set('meta[property="og:url"]', "content", url);
      set('meta[property="og:title"]', "content", t.title);
      set('meta[property="og:description"]', "content", t.description);
      set('meta[property="og:locale"]', "content", LOCALES[lang]);
      set('meta[property="og:locale:alternate"]', "content", LOCALES[lang === "fr" ? "en" : "fr"]);
      set('meta[name="twitter:title"]', "content", t.title);
      set('meta[name="twitter:description"]', "content", t.description);
    } else {
      document.documentElement.lang = "fr";
      document.title = "Keyfold";
    }

    let robots = document.head.querySelector('meta[name="robots"]');
    if (path.startsWith("/personal")) {
      if (!robots) {
        robots = document.createElement("meta");
        robots.setAttribute("name", "robots");
        document.head.append(robots);
      }
      robots.setAttribute("content", "noindex, nofollow");
    } else {
      robots?.remove();
    }
  }, [pathname]);

  return null;
}
