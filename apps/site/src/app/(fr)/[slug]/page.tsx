import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocPageView } from "@/components/doc-page";
import { DocJsonLd } from "@/components/json-ld";
import { PAGES } from "@/content/pages";
import { docMetadata } from "@/lib/seo";

// Static export: only the slugs listed here exist, any other path is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return PAGES.map((page) => ({ slug: page.content.fr.slug }));
}

const find = (slug: string) => PAGES.find((page) => page.content.fr.slug === slug) ?? notFound();

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return docMetadata(find((await params).slug), "fr");
}

export default async function Page({ params }: Props) {
  const page = find((await params).slug);
  return (
    <>
      <DocPageView page={page} lang="fr" />
      <DocJsonLd page={page} lang="fr" />
    </>
  );
}
