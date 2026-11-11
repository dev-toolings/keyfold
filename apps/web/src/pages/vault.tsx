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
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import { Badge } from "@/components/reui/badge";
import { Frame, FramePanel } from "@/components/reui/frame";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CLEAR_SECONDS, copySecret } from "@/lib/clipboard";
import { FILTER_LABELS, formatDate, formatRelative, KIND_ICONS, KIND_LABELS, KIND_PLURALS, plural } from "@/lib/labels";
import { countByKind, type Entry, FILTERS, type Filter, KINDS, type Kind } from "@/vault";
import { useVault } from "@/vault-context";

type Row = Entry & { flags: Filter[] };

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic, text: sortFn_text },
});
const column = createColumnHelper<typeof features, Row>();

export function VaultPage() {
  const { entries, loading, error, flags, now } = useVault();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const kindParam = params.get("kind");
  const kind = KINDS.includes(kindParam as Kind) ? (kindParam as Kind) : null;
  const filterParam = params.get("filter");
  const filter = FILTERS.includes(filterParam as Filter) ? (filterParam as Filter) : null;
  const query = params.get("q") ?? "";

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: key === "q" });
  }

  const counts = useMemo(() => countByKind(entries), [entries]);
  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLocaleLowerCase("fr");
    return entries
      .filter((e) => !kind || e.item.kind === kind)
      .filter((e) => !filter || flags[filter].has(e.id))
      .filter(
        (e) =>
          !q ||
          [e.item.name, e.item.note, e.item.username ?? "", e.item.folder ?? "", ...(e.item.urls ?? [])].some((s) =>
            s.toLocaleLowerCase("fr").includes(q),
          ) ||
          KIND_LABELS[e.item.kind].toLocaleLowerCase("fr").includes(q),
      )
      .map((e) => ({ ...e, flags: FILTERS.filter((f) => flags[f].has(e.id)) }));
  }, [entries, kind, filter, query, flags]);

  const open = useCallback(
    (id: string) => navigate({ pathname: `/personal/vault/${id}`, search: location.search }),
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
    [now, open],
  );

  const table = useTable({
    features,
    columns,
    data: rows,
    getRowId: (r) => r.id,
    initialState: { sorting: [{ id: "name", desc: false }] },
  });

  const hasFilters = Boolean(kind || filter || query);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Coffre</h2>
          <p className="text-sm text-muted-foreground">
            {plural(entries.length, "élément chiffré", "éléments chiffrés")}, déchiffrés dans ce navigateur.
          </p>
        </div>
        <Button size="sm" asChild>
          <Link to={{ pathname: "/personal/vault/new", search: location.search }}>
            <Plus />
            Nouvel élément
          </Link>
        </Button>
      </div>

      <Tabs value={kind ?? "all"} onValueChange={(v) => setParam("kind", v === "all" ? null : v)}>
        <TabsList className="max-w-full justify-start overflow-x-auto overflow-y-hidden">
          <TabsTrigger value="all">
            Tous <Count n={entries.length} />
          </TabsTrigger>
          {KINDS.map((k) => (
            <TabsTrigger key={k} value={k}>
              {KIND_PLURALS[k]} <Count n={counts[k]} />
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Rechercher par nom, identifiant, adresse, dossier ou note"
            placeholder="Nom, identifiant, adresse…"
            value={query}
            onChange={(e) => setParam("q", e.target.value)}
            className="h-8 pl-8"
          />
        </div>
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
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">{flags[f].size}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {hasFilters && (
          <Button variant="ghost" size="sm" asChild>
            <Link to="/personal/vault">
              <X />
              Effacer les filtres
            </Link>
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
          ) : entries.length === 0 ? (
            <EmptyState
              icon={<Layers />}
              title="Le coffre est vide"
              text="Ajoutez un identifiant, un jeton d'API, une note, une clé SSH ou importez un export avec kf import."
              action={
                <Button size="sm" asChild>
                  <Link to="/personal/vault/new">
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
              text="Aucun élément ne correspond à ces filtres."
              action={
                <Button variant="outline" size="sm" asChild>
                  <Link to="/personal/vault">Effacer les filtres</Link>
                </Button>
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
                    onClick={() => open(row.id)}
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
      <Outlet />
    </>
  );
}

function Count({ n }: { n: number }) {
  return <span className="text-xs text-muted-foreground tabular-nums">{n}</span>;
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
  if (flags.length === 0) return <span className="text-xs text-muted-foreground">OK</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Badge key={f} variant={f === "reused" ? "destructive-light" : "warning-light"} size="sm">
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
          <Button variant="ghost" size="icon-sm" onClick={onOpen} aria-label="Ouvrir">
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
