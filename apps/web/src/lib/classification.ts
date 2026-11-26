import { classificationKey, ENVIRONMENTS, type Entry, type Environment, type Item, type ProjectEntry } from "@/vault";

export { classificationKey } from "@/vault";

export const CLASSIFICATION_FILTER_FIELDS = ["specialty", "languages", "tags"] as const;
export const CLASSIFICATION_FIELDS = ["project", ...CLASSIFICATION_FILTER_FIELDS] as const;
export type ClassificationField = (typeof CLASSIFICATION_FIELDS)[number];
export type ClassificationFilters = Partial<Record<Exclude<ClassificationField, "project">, string>>;

export type VaultScope = { kind: "all" | "unassigned" } | { kind: "project"; name: string; environment?: Environment };
export const ALL_VAULT_ITEMS: VaultScope = { kind: "all" };

export function vaultScopeFromSearch(search: string): VaultScope {
  const params = new URLSearchParams(search);
  const name = params.get("project")?.trim();
  if (name) {
    const selected = params.get("scope_environment");
    return { kind: "project", name, environment: ENVIRONMENTS.find((environment) => environment === selected) };
  }
  return params.get("scope") === "unassigned" ? { kind: "unassigned" } : ALL_VAULT_ITEMS;
}

export function vaultScopeSearch(scope: VaultScope): string {
  if (scope.kind === "unassigned") return "?scope=unassigned";
  if (scope.kind !== "project") return "";
  const params = new URLSearchParams({ project: scope.name });
  if (scope.environment) params.set("scope_environment", scope.environment);
  return `?${params}`;
}

export const CLASSIFICATION_LABELS: Record<ClassificationField, string> = {
  project: "Projet",
  specialty: "Spécialité",
  languages: "Langages",
  tags: "Tags",
};

export const ENVIRONMENT_LABELS: Record<Environment, string> = {
  prod: "Prod",
  preprod: "Préprod",
  local: "Local",
};

export function classificationValues(item: Item, field: ClassificationField): string[] {
  const value = item[field];
  return typeof value === "string" ? [value] : (value ?? []);
}

export function distinctLabels(values: string[]): string[] {
  const labels = new Map<string, string>();
  for (const value of values) {
    const key = classificationKey(value);
    if (key && !labels.has(key)) labels.set(key, value.trim());
  }
  return [...labels.values()];
}

export function classificationOptions(entries: Entry[], field: ClassificationField): string[] {
  return distinctLabels(entries.flatMap(({ item }) => classificationValues(item, field))).sort((a, b) =>
    a.localeCompare(b, "fr"),
  );
}

export function matchesClassification(filters: ClassificationFilters) {
  const active = CLASSIFICATION_FILTER_FIELDS.flatMap((field) => {
    const value = filters[field];
    return value ? [{ field, key: classificationKey(value) }] : [];
  });
  return ({ item }: Entry) =>
    active.every(({ field, key }) =>
      classificationValues(item, field).some((value) => classificationKey(value) === key),
    );
}

export function groupVaultProjects(entries: Entry[], projects: ProjectEntry[]) {
  const groups = new Map<string, { name: string; count: number; environments: Partial<Record<Environment, number>> }>();
  for (const { project } of projects) {
    const key = project.name_key;
    if (!groups.has(key)) groups.set(key, { name: project.name, count: 0, environments: {} });
  }
  let unassigned = 0;
  for (const { item } of entries) {
    const name = item.project?.trim() ?? "";
    if (!name) {
      unassigned++;
      continue;
    }
    const key = classificationKey(name);
    const group = groups.get(key) ?? { name, count: 0, environments: {} };
    group.count++;
    if (item.environment) {
      group.environments[item.environment] = (group.environments[item.environment] ?? 0) + 1;
    }
    groups.set(key, group);
  }
  return { projects: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "fr")), unassigned };
}

export function entriesInVaultScope(entries: Entry[], scope: VaultScope) {
  if (scope.kind === "all") return entries;
  const key = scope.kind === "project" ? classificationKey(scope.name) : "";
  const environment = scope.kind === "project" ? scope.environment : undefined;
  return entries.filter(
    ({ item }) => classificationKey(item.project ?? "") === key && (!environment || item.environment === environment),
  );
}
