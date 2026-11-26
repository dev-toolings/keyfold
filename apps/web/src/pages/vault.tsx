import {
  createColumnHelper,
  createSortedRowModel,
  type Header,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronRight,
  Copy,
  Layers,
  ListFilter,
  Plus,
  Search,
  SearchX,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useOutletContext, useSearchParams } from "react-router";
import type { VaultSearchOutlet } from "@/components/app-shell";
import { EnvironmentBadge } from "@/components/environment-badge";
import { Badge } from "@/components/reui/badge";
import { Frame, FramePanel } from "@/components/reui/frame";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CLASSIFICATION_FILTER_FIELDS,
  CLASSIFICATION_LABELS,
  type ClassificationFilters,
  classificationKey,
  classificationOptions,
  ENVIRONMENT_LABELS,
  entriesInVaultScope,
  matchesClassification,
  type VaultScope,
} from "@/lib/classification";
import { CLEAR_SECONDS, copySecret } from "@/lib/clipboard";
import {
  errorMessage,
  FILTER_LABELS,
  formatDate,
  formatRelative,
  KIND_ICONS,
  KIND_LABELS,
  KIND_PLURALS,
  plural,
} from "@/lib/labels";
import { matchesVaultQuery } from "@/lib/vault-search";
import { countByKind, ENVIRONMENTS, type Entry, FILTERS, type Filter, KINDS, type Kind } from "@/vault";
import { useVault } from "@/vault-context";

type Row = Entry & { flags: Filter[] };
export type ItemDialogOutlet = { vaultScope: VaultScope; focusList: () => void };

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic, text: sortFn_text },
});
const column = createColumnHelper<typeof features, Row>();

export function VaultPage() {
  const { entries, projects, removeProject, loading, error, flags, now } = useVault();
  const notify = useToast();
  const [deletingProject, setDeletingProject] = useState(false);
  // After a confirmed deletion the trigger disappears: focus moves to the page title instead.
  const projectDeleteConfirmed = useRef(false);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { vaultScope, vaultSearch, setVaultSearch } = useOutletContext<VaultSearchOutlet>();
  const { filters } = vaultSearch;
  const project =
    vaultScope.kind === "project"
      ? projects.find(({ project }) => project.name_key === classificationKey(vaultScope.name))?.project
      : undefined;
  const newItem = { pathname: "/personal/vault/new", search: location.search };
  const scopeEnvironment = vaultScope.kind === "project" ? vaultScope.environment : undefined;

  const kindParam = params.get("kind");
  const kind = KINDS.includes(kindParam as Kind) ? (kindParam as Kind) : null;
  // On the whole vault the kind is a view picked in the sidebar; inside a project it is a filter.
  const kindIsView = vaultScope.kind === "all";
  const title =
    vaultScope.kind === "project"
      ? vaultScope.name
      : vaultScope.kind === "unassigned"
        ? "Sans projet"
        : kind
          ? KIND_PLURALS[kind]
          : "Coffre";
  const filterParam = params.get("filter");
  const filter = FILTERS.includes(filterParam as Filter) ? (filterParam as Filter) : null;
  const environmentParam = params.get("environment");
  const environmentFilter = scopeEnvironment
    ? undefined
    : environmentParam === "none"
      ? environmentParam
      : ENVIRONMENTS.find((environment) => environment === environmentParam);
  const linkedQuery = params.get("q");
  const query = linkedQuery ?? vaultSearch.query ?? "";

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  }

  function setClassificationFilter(field: keyof ClassificationFilters, value: string) {
    setVaultSearch((current) => ({ ...current, filters: { ...current.filters, [field]: value } }));
  }

  function clearFilters() {
    setVaultSearch({ query: null, filters: {} });
    const next = new URLSearchParams(params);
    for (const key of kindIsView ? ["filter", "environment", "q"] : ["kind", "filter", "environment", "q"]) {
      next.delete(key);
    }
    setParams(next);
  }

  const scopeEntries = useMemo(() => entriesInVaultScope(entries, vaultScope), [entries, vaultScope]);
  const counts = useMemo(() => countByKind(scopeEntries), [scopeEntries]);
  const classification = useMemo(
    () => CLASSIFICATION_FILTER_FIELDS.map((field) => ({ field, options: classificationOptions(scopeEntries, field) })),
    [scopeEntries],
  );
  const rows = useMemo<Row[]>(() => {
    return scopeEntries
      .filter((e) => !kind || e.item.kind === kind)
      .filter((e) => !filter || flags[filter].has(e.id))
      .filter((e) => !environmentFilter || (e.item.environment ?? "none") === environmentFilter)
      .filter(matchesVaultQuery(query))
      .filter(matchesClassification(filters))
      .map((e) => ({ ...e, flags: FILTERS.filter((f) => flags[f].has(e.id)) }));
  }, [scopeEntries, kind, filter, environmentFilter, query, flags, filters]);

  const open = useCallback(
    (id: string) =>
      navigate({ pathname: `/personal/vault/${id}`, search: location.search }, { state: { fromVault: true } }),
    [navigate, location.search],
  );

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor((r) => r.item.name, {
          id: "name",
          header: "Nom",
          sortFn: "text",
          cell: ({ row }) => (
            <div className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1.5 truncate font-medium">
                {row.original.item.favorite && (
                  <Star className="size-3.5 shrink-0 fill-current text-amber-500" aria-label="Favori" />
                )}
                <span className="truncate">{row.original.item.name}</span>
                {vaultScope.kind === "all" && row.original.item.project && (
                  <Badge variant="secondary" size="sm" className="max-w-1/2 min-w-0">
                    <span className="truncate">{row.original.item.project}</span>
                  </Badge>
                )}
                {row.original.item.environment && (
                  <EnvironmentBadge environment={row.original.item.environment} size="sm" />
                )}
              </span>
              {(row.original.item.username || row.original.item.note) && (
                <span className="truncate text-xs text-muted-foreground">
                  {row.original.item.username || row.original.item.note}
                </span>
              )}
            </div>
          ),
        }),
        column.accessor((r) => KIND_LABELS[r.item.kind], {
          id: "kind",
          header: "Type",
          sortFn: "text",
          cell: ({ row }) => {
            const Icon = KIND_ICONS[row.original.item.kind];
            return (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Icon className="size-4" />
                {KIND_LABELS[row.original.item.kind]}
              </span>
            );
          },
        }),
        column.accessor((r) => new Date(r.item.updated_at).getTime(), {
          id: "updated",
          header: "Modifié",
          sortFn: "basic",
          sortDescFirst: true,
          cell: ({ row }) => (
            <time
              dateTime={row.original.item.updated_at}
              title={formatDate(row.original.item.updated_at)}
              className="whitespace-nowrap text-muted-foreground tabular-nums"
            >
              {formatRelative(row.original.item.updated_at, now)}
            </time>
          ),
        }),
        column.accessor((r) => r.flags.length, {
          id: "status",
          header: "État",
          sortFn: "basic",
          sortDescFirst: true,
          cell: ({ row }) => <StatusBadges flags={row.original.flags} />,
        }),
        column.display({
          id: "actions",
          header: () => <span className="sr-only">Actions</span>,
          cell: ({ row }) => <RowActions entry={row.original} onOpen={() => open(row.original.id)} />,
        }),
      ]),
    [now, open, vaultScope.kind],
  );

  const table = useTable({
    features,
    columns,
    data: rows,
    getRowId: (r) => r.id,
    initialState: { sorting: [{ id: "name", desc: false }] },
  });

  const hasFilters = Boolean(
    (kind && !kindIsView) || filter || environmentFilter || query || Object.values(filters).some(Boolean),
  );

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 ref={titleRef} tabIndex={-1} className="text-xl font-semibold tracking-tight wrap-anywhere">
              {title}
            </h2>
            {scopeEnvironment && <EnvironmentBadge environment={scopeEnvironment} />}
          </div>
          <p className="text-sm text-muted-foreground">
            {plural(kind && kindIsView ? counts[kind] : scopeEntries.length, "élément chiffré", "éléments chiffrés")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {vaultScope.kind === "project" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={deletingProject}>
                  <Trash2 aria-hidden="true" />
                  Supprimer le projet
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent
                onCloseAutoFocus={(event) => {
                  if (!projectDeleteConfirmed.current) return;
                  projectDeleteConfirmed.current = false;
                  event.preventDefault();
                  titleRef.current?.focus({ preventScroll: true });
                }}
              >
                <AlertDialogHeader>
                  <AlertDialogTitle>Supprimer définitivement « {vaultScope.name} » ?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Le projet est supprimé dans tous ses environnements. Ses éléments seront conservés dans « Sans
                    projet ».
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuler</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    disabled={deletingProject}
                    onClick={async () => {
                      projectDeleteConfirmed.current = true;
                      setDeletingProject(true);
                      try {
                        const entryId = projects.find(
                          ({ project }) => project.name_key === classificationKey(vaultScope.name),
                        )?.id;
                        await removeProject(vaultScope.name, entryId);
                        setVaultSearch({ query: null, filters: {} });
                        navigate({ pathname: "/personal/vault", search: "" }, { replace: true });
                        notify("success", "Projet supprimé.");
                      } catch (error) {
                        notify("error", errorMessage(error));
                      } finally {
                        setDeletingProject(false);
                      }
                    }}
                  >
                    Supprimer
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button size="sm" asChild>
            <Link to={newItem} state={{ fromVault: true }}>
              <Plus />
              Nouvel élément
            </Link>
          </Button>
        </div>
      </div>

      {project && (project.specialty || project.languages?.length || project.tags?.length) ? (
        <dl className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border px-3 py-2 text-sm">
          {CLASSIFICATION_FILTER_FIELDS.map((field) => {
            const value = project[field];
            const labels = typeof value === "string" ? [value] : value;
            return labels?.length ? (
              <div key={field} className="min-w-0 max-w-full">
                <dt className="text-xs text-muted-foreground">{CLASSIFICATION_LABELS[field]}</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {labels.map((label) => (
                    <Badge
                      key={label}
                      variant="secondary"
                      size="sm"
                      className="max-w-full whitespace-normal wrap-anywhere"
                    >
                      {label}
                    </Badge>
                  ))}
                </dd>
              </div>
            ) : null;
          })}
        </dl>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Rechercher dans les éléments du coffre"
            placeholder="Nom, identifiant, projet, tag…"
            value={query}
            onChange={(e) => {
              const value = e.target.value;
              setVaultSearch((current) => ({ ...current, query: value }));
              if (linkedQuery !== null) {
                const next = new URLSearchParams(params);
                next.delete("q");
                setParams(next, { replace: true });
              }
            }}
            className="h-8 pl-8"
          />
        </div>
        {!kindIsView && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="pointer-coarse:min-h-11">
                Type
                {kind && (
                  <Badge variant="secondary" size="sm">
                    {KIND_PLURALS[kind]}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 max-w-[calc(100vw-2rem)]">
              <DropdownMenuLabel>Filtrer par type</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={kind ?? ""} onValueChange={(value) => setParam("kind", value || null)}>
                <DropdownMenuRadioItem value="" className="pointer-coarse:min-h-11">
                  Tous les types
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">{scopeEntries.length}</span>
                </DropdownMenuRadioItem>
                {KINDS.filter((k) => counts[k] > 0 || k === kind).map((k) => (
                  <DropdownMenuRadioItem key={k} value={k} className="pointer-coarse:min-h-11">
                    {KIND_PLURALS[k]}
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">{counts[k]}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <ListFilter />
              État
              {filter && (
                <Badge variant="secondary" size="sm">
                  {FILTER_LABELS[filter]}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Filtrer par état</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={filter ?? ""} onValueChange={(v) => setParam("filter", v || null)}>
              <DropdownMenuRadioItem value="">Tous les états</DropdownMenuRadioItem>
              {FILTERS.map((f) => (
                <DropdownMenuRadioItem key={f} value={f}>
                  {FILTER_LABELS[f]}
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {scopeEntries.filter(({ id }) => flags[f].has(id)).length}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {!scopeEnvironment && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="pointer-coarse:min-h-11">
                Environnement
                {environmentFilter === "none" ? (
                  <Badge variant="secondary" size="sm">
                    Sans environnement
                  </Badge>
                ) : (
                  environmentFilter && <EnvironmentBadge environment={environmentFilter} size="sm" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 max-w-[calc(100vw-2rem)]">
              <DropdownMenuLabel>Environnement</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={environmentFilter ?? ""}
                onValueChange={(value) => setParam("environment", value || null)}
              >
                <DropdownMenuRadioItem value="" className="pointer-coarse:min-h-11">
                  Tous les environnements
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="none" className="pointer-coarse:min-h-11">
                  Sans environnement
                </DropdownMenuRadioItem>
                {ENVIRONMENTS.map((environment) => (
                  <DropdownMenuRadioItem key={environment} value={environment} className="pointer-coarse:min-h-11">
                    {ENVIRONMENT_LABELS[environment]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {classification.map(({ field, options }) => {
          const label = CLASSIFICATION_LABELS[field];
          const active = filters[field] ?? "";
          if (!active && options.length === 0) return null;
          return (
            <DropdownMenu key={field}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="max-w-full min-w-0 pointer-coarse:min-h-11">
                  {label}
                  {active && (
                    <Badge variant="secondary" size="sm" className="min-w-0">
                      <span className="truncate">{active}</span>
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 max-w-[calc(100vw-2rem)]">
                <DropdownMenuLabel>{label}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup value={active} onValueChange={(value) => setClassificationFilter(field, value)}>
                  <DropdownMenuRadioItem value="" className="pointer-coarse:min-h-11">
                    Toutes les valeurs
                  </DropdownMenuRadioItem>
                  {options.map((option) => (
                    <DropdownMenuRadioItem
                      key={option}
                      value={option}
                      className="wrap-anywhere pointer-coarse:min-h-11"
                    >
                      {option}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X />
            Effacer les filtres
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{plural(rows.length, "résultat", "résultats")}</span>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Frame>
        <FramePanel className="p-0">
          {loading ? (
            <div className="flex flex-col gap-2 p-4">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          ) : scopeEntries.length === 0 ? (
            <EmptyState
              icon={<Layers />}
              title={vaultScope.kind === "all" ? "Le coffre est vide" : "Aucun élément dans cette vue"}
              text={
                vaultScope.kind === "all"
                  ? "Ajoutez un identifiant, un jeton d'API, une note, une clé SSH ou importez un export avec kf import."
                  : "Ajoutez un élément ou choisissez une autre vue dans la barre latérale."
              }
              action={
                <Button size="sm" asChild>
                  <Link to={newItem} state={{ fromVault: true }}>
                    <Plus />
                    Ajouter un élément
                  </Link>
                </Button>
              }
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<SearchX />}
              title="Aucun résultat"
              text={
                hasFilters || !kind
                  ? "Aucun élément ne correspond à ces filtres."
                  : "Le coffre ne contient aucun élément de ce type."
              }
              action={
                hasFilters || !kind ? (
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Effacer les filtres
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/personal/vault">Voir tout le coffre</Link>
                  </Button>
                )
              }
            />
          ) : (
            // min-w keeps the name column readable: narrow screens scroll the table sideways.
            <Table className="min-w-[52rem] table-fixed">
              <colgroup>
                <col />
                <col className="w-48" />
                <col className="w-36" />
                <col className="w-56" />
                <col className="w-24" />
              </colgroup>
              <TableHeader>
                {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id} className="hover:bg-transparent">
                    {group.headers.map((header) => (
                      <TableHead key={header.id} className="h-10 bg-muted/40 first:pl-4 last:pr-4">
                        <SortableHeader header={header}>
                          <table.FlexRender header={header} />
                        </SortableHeader>
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    data-state={location.pathname === `/personal/vault/${row.id}` ? "selected" : undefined}
                    onClick={(event) => {
                      event.currentTarget
                        .querySelector<HTMLButtonElement>("[data-open-item]")
                        ?.focus({ preventScroll: true });
                      open(row.id);
                    }}
                  >
                    {row.getAllCells().map((cell) => (
                      <TableCell key={cell.id} className="py-2.5 first:pl-4 last:pr-4">
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </FramePanel>
      </Frame>
      <Outlet
        context={
          { vaultScope, focusList: () => titleRef.current?.focus({ preventScroll: true }) } satisfies ItemDialogOutlet
        }
      />
    </>
  );
}

function SortableHeader({
  header,
  children,
}: {
  header: Header<typeof features, Row, unknown>;
  children: React.ReactNode;
}) {
  if (!header.column.getCanSort()) return children;
  const sorted = header.column.getIsSorted();
  const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={header.column.getToggleSortingHandler()}
      className="-ml-2 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      aria-label={`Trier par ${String(header.column.columnDef.header)}`}
    >
      {children}
      <Icon className={sorted ? "size-3.5" : "size-3.5 text-muted-foreground/60"} />
    </button>
  );
}

function StatusBadges({ flags }: { flags: Filter[] }) {
  if (flags.length === 0) {
    return (
      <Badge variant="success-light" radius="full" className="gap-1.5 px-2">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
        OK
      </Badge>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Badge
          key={f}
          variant={f === "reused" ? "destructive-light" : "warning-light"}
          radius="full"
          className="gap-1.5 px-2"
        >
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${f === "reused" ? "bg-destructive" : "bg-warning"}`}
          />
          {FILTER_LABELS[f]}
        </Badge>
      ))}
    </div>
  );
}

function RowActions({ entry, onOpen }: { entry: Entry; onOpen: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await copySecret(entry.item.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: stops row clicks from the buttons inside
    // biome-ignore lint/a11y/useKeyWithClickEvents: the buttons inside handle the keyboard
    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={copy} aria-label="Copier la valeur">
            {copied ? <Check /> : <Copy />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copied ? `Copié, effacé dans ${CLEAR_SECONDS} s` : "Copier la valeur"}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={onOpen} aria-label="Ouvrir" data-open-item>
            <ChevronRight />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Ouvrir</TooltipContent>
      </Tooltip>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
        {icon}
      </div>
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
      {action}
    </div>
  );
}
