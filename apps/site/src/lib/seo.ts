// Owner: SEO worker. Stub: title and description only, until the full head tags land.
import type { Metadata } from "next";
import { CONTENT, type Lang } from "@/content/landing";

export function pageMetadata(lang: Lang): Metadata {
  return { title: CONTENT[lang].title, description: CONTENT[lang].description };
}
