import { CLASSIFICATION_FIELDS, type ClassificationFilters, classificationValues } from "@/lib/classification";
import { KIND_LABELS } from "@/lib/labels";
import type { Entry } from "@/vault";

export type VaultSearchState = { query: string | null; filters: ClassificationFilters };

export function matchesVaultQuery(query: string) {
  const needle = query.trim().normalize().toLocaleLowerCase("fr");

  return ({ item }: Entry) =>
    !needle ||
    [
      item.name,
      item.note,
      item.username ?? "",
      item.folder ?? "",
      ...(item.urls ?? []),
      KIND_LABELS[item.kind],
      ...CLASSIFICATION_FIELDS.flatMap((field) => classificationValues(item, field)),
    ].some((text) => text.normalize().toLocaleLowerCase("fr").includes(needle));
}
