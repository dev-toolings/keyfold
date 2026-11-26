import {
  Activity,
  Bot,
  ChevronRight,
  Folder,
  FolderOpen,
  Inbox,
  LayoutDashboard,
  LogOut,
  Plus,
  Search,
  Server,
  Settings,
  Vault,
} from "lucide-react";
import { Collapsible } from "radix-ui";
import { type Dispatch, type MouseEvent, type SetStateAction, useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { ProjectDialog } from "@/components/project-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { VaultSearch } from "@/components/vault-search";
import {
  ALL_VAULT_ITEMS,
  classificationKey,
  ENVIRONMENT_LABELS,
  groupVaultProjects,
  type VaultScope,
  vaultScopeFromSearch,
  vaultScopeSearch,
} from "@/lib/classification";
import { KIND_ICONS, KIND_PLURALS, plural } from "@/lib/labels";
import type { VaultSearchState } from "@/lib/vault-search";
import { countByKind, ENVIRONMENTS, KINDS, type Kind } from "@/vault";
import { useVault } from "@/vault-context";

const sidebarLinkClass =
  "h-9 cursor-pointer rounded-xl pl-8 in-data-[mobile=true]:h-11 data-active:bg-chart-1/10 data-active:font-semibold data-active:[&>svg]:text-chart-1";

/** Tree rows (BoardUI tree view): icons at half opacity, full color once the row is current. */
const treeRowClass = `${sidebarLinkClass} relative [&>svg]:opacity-50 data-active:[&>svg]:opacity-100`;

const environmentIconClass = {
  prod: "text-destructive",
  preprod: "text-warning",
  local: "text-muted-foreground",
} as const;

/** Header title, browser tab title and description of each page in the shell. */
const PAGES = {
  dashboard: { title: "Tableau de bord", description: "Vue d’ensemble de votre coffre Keyfold." },
  vault: { title: "Coffre", description: "Les éléments chiffrés du coffre, par projet et par environnement." },
  ai: { title: "AI", description: "Connectez un agent IA au coffre avec le serveur MCP de Keyfold." },
  settings: {
    title: "Paramètres",
    description: "Mot de passe principal, double authentification et détection des fuites connues.",
  },
  health: { title: "État du système", description: "État du serveur Keyfold et des éléments du coffre." },
} as const;

export type VaultSearchOutlet = {
  vaultScope: VaultScope;
  vaultSearch: VaultSearchState;
  setVaultSearch: Dispatch<SetStateAction<VaultSearchState>>;
};

export function AppShell() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { entries, projects: projectEntries, createProject, loading, oldFormat, unreadable, lock } = useVault();
  const { projects, unassigned } = useMemo(
    () => groupVaultProjects(entries, projectEntries),
    [entries, projectEntries],
  );
  const onVault = pathname.startsWith("/personal/vault");
  const vaultScope = useMemo(() => (onVault ? vaultScopeFromSearch(search) : ALL_VAULT_ITEMS), [onVault, search]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [vaultSearch, setVaultSearch] = useState<VaultSearchState>({ query: null, filters: {} });
  const [wasOnVault, setWasOnVault] = useState(onVault);
  if (wasOnVault !== onVault) {
    setWasOnVault(onVault);
    if (!onVault) {
      setVaultSearch({ query: null, filters: {} });
    }
  }
  // Projects start expanded; opening a project, or one of its environments, expands it again.
  const [collapsedProjects, setCollapsedProjects] = useState<ReadonlySet<string>>(new Set());
  function setProjectExpanded(key: string, open: boolean) {
    if (collapsedProjects.has(key) !== open) return;
    const next = new Set(collapsedProjects);
    if (open) next.delete(key);
    else next.add(key);
    setCollapsedProjects(next);
  }
  // The whole vault lists every kind as a branch (empty ones greyed), the view a kind link opens.
  const [vaultExpanded, setVaultExpanded] = useState(true);
  const kindCounts = useMemo(() => countByKind(entries), [entries]);
  const kindParam = onVault && vaultScope.kind === "all" ? new URLSearchParams(search).get("kind") : null;
  const vaultKind = KINDS.find((kind) => kind === kindParam);
  const scopeSearch =
    vaultScope.kind === "project" ? vaultScopeSearch(vaultScope) : vaultKind ? `?kind=${vaultKind}` : null;
  const [revealedScope, setRevealedScope] = useState<string | null>(null);
  if (scopeSearch !== revealedScope) {
    setRevealedScope(scopeSearch);
    if (vaultScope.kind === "project") setProjectExpanded(classificationKey(vaultScope.name), true);
    else if (vaultKind) setVaultExpanded(true);
  }
  const onDashboard = pathname === "/personal/dashboard";
  const onHealth = pathname === "/personal/health";
  const onAi = pathname === "/personal/ai";
  const onSettings = pathname === "/personal/settings";

  const page = onSettings
    ? PAGES.settings
    : onHealth
      ? PAGES.health
      : onAi
        ? PAGES.ai
        : onVault
          ? PAGES.vault
          : PAGES.dashboard;
  // Item routes (/personal/vault/new, /personal/vault/:id): the tab never shows a decrypted name.
  const vaultItem = onVault ? pathname.split("/")[3] : undefined;
  const tabTitle = vaultItem === "new" ? "Nouvel élément" : vaultItem ? "Élément" : page.title;

  /** A vault view opens on a clean search, unless the link opens in another tab or window. */
  function resetVaultSearch(event?: MouseEvent) {
    if (event && (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
    setVaultSearch({ query: null, filters: {} });
  }

  function openVaultScope(scope: VaultScope) {
    const to = vaultLocation(scope);
    resetVaultSearch();
    navigate(to, { replace: pathname === to.pathname && search === to.search });
  }

  return (
    <SidebarProvider>
      <title>{`${tabTitle} · Keyfold`}</title>
      <meta name="description" content={page.description} />
      <CloseDrawerOnNavigate />
      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader className="border-b border-sidebar-border pb-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild tooltip="Keyfold">
                <Link to="/personal/dashboard">
                  <img src="/brand/logo-tile.png" alt="" className="size-8 shrink-0" />
                  <div className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:sr-only">
                    <span className="truncate font-semibold">Keyfold</span>
                    <span className="truncate text-xs text-muted-foreground">Coffre personnel</span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                type="button"
                variant="outline"
                tooltip="Rechercher dans le coffre"
                aria-label="Rechercher dans le coffre"
                aria-haspopup="dialog"
                aria-expanded={searchOpen}
                aria-keyshortcuts="Control+K Meta+K"
                className="cursor-pointer text-muted-foreground in-data-[mobile=true]:h-11"
                onClick={() => setSearchOpen(true)}
              >
                <Search aria-hidden="true" />
                <span className="truncate group-data-[collapsible=icon]:hidden">Rechercher…</span>
                <kbd className="ml-auto hidden shrink-0 font-sans text-xs md:pointer-fine:inline group-data-[collapsible=icon]:hidden">
                  {/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K"}
                </kbd>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <nav aria-label="Navigation principale" className="p-2">
            <SidebarMenu className="gap-1">
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={onDashboard}
                  tooltip="Tableau de bord"
                  className={sidebarLinkClass}
                >
                  <Link to="/personal/dashboard" aria-current={onDashboard ? "page" : undefined}>
                    <LayoutDashboard aria-hidden="true" />
                    <span>Tableau de bord</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <Collapsible.Root asChild open={vaultExpanded} onOpenChange={setVaultExpanded}>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={onVault && vaultScope.kind === "all" && !vaultKind}
                    tooltip="Tous les éléments"
                    data-vault-current={onVault}
                    className={`${sidebarLinkClass} relative group-data-[collapsible=icon]:data-[vault-current=true]:bg-chart-1/10 group-data-[collapsible=icon]:data-[vault-current=true]:[&>svg]:text-chart-1`}
                  >
                    <Link
                      to={vaultLocation(ALL_VAULT_ITEMS)}
                      aria-current={onVault && vaultScope.kind === "all" && !vaultKind ? "page" : undefined}
                      onClick={(event) => {
                        setVaultExpanded(true);
                        resetVaultSearch(event);
                      }}
                    >
                      {vaultExpanded && <TreeBridge />}
                      <Vault aria-hidden="true" />
                      <span className="truncate">Coffre</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums group-data-[collapsible=icon]:hidden">
                        {entries.length}
                      </span>
                    </Link>
                  </SidebarMenuButton>
                  <TreeToggle label="Types d’éléments du coffre" />
                  <Collapsible.Content asChild>
                    <ul
                      aria-label="Types d’éléments du coffre"
                      inert={!vaultExpanded}
                      className="tree-branch flex min-w-0 flex-col group-data-[collapsible=icon]:hidden"
                    >
                      {KINDS.map((kind, index) => {
                        const Icon = KIND_ICONS[kind];
                        const active = vaultKind === kind;
                        return (
                          <li key={kind} className="relative py-px">
                            <TreeGuide last={index === KINDS.length - 1} />
                            <SidebarMenuButton
                              asChild
                              isActive={active}
                              className={`${treeRowClass} pl-10 ${kindCounts[kind] === 0 && !active ? "text-muted-foreground" : ""}`}
                            >
                              <Link
                                to={vaultLocation(ALL_VAULT_ITEMS, kind)}
                                aria-current={active ? "page" : undefined}
                                onClick={resetVaultSearch}
                              >
                                <Icon aria-hidden="true" />
                                <span className="min-w-0 flex-1 truncate">{KIND_PLURALS[kind]}</span>
                                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                  {kindCounts[kind]}
                                </span>
                              </Link>
                            </SidebarMenuButton>
                          </li>
                        );
                      })}
                    </ul>
                  </Collapsible.Content>
                </SidebarMenuItem>
              </Collapsible.Root>
            </SidebarMenu>
            <SidebarGroup className="mt-2 px-0 group-data-[collapsible=icon]:hidden">
              <SidebarGroupLabel asChild>
                <h2>Projets</h2>
              </SidebarGroupLabel>
              <ProjectDialog
                trigger={
                  <SidebarGroupAction
                    aria-label="Créer un projet"
                    title="Créer un projet"
                    className="right-2 cursor-pointer after:-inset-3"
                  >
                    <Plus aria-hidden="true" />
                  </SidebarGroupAction>
                }
                onCreate={async (draft) => {
                  await createProject(draft);
                  openVaultScope({ kind: "project", name: draft.name });
                }}
              />
              <SidebarMenu className="gap-0.5">
                {projects.map(({ name, count, environments }) => {
                  const key = classificationKey(name);
                  const projectScope =
                    onVault && vaultScope.kind === "project" && classificationKey(vaultScope.name) === key
                      ? vaultScope
                      : undefined;
                  const active = projectScope !== undefined && !projectScope.environment;
                  const availableEnvironments = ENVIRONMENTS.filter((environment) => environments[environment]);
                  const expanded = availableEnvironments.length > 0 && !collapsedProjects.has(key);
                  return (
                    <Collapsible.Root
                      key={key}
                      asChild
                      open={expanded}
                      onOpenChange={(open) => setProjectExpanded(key, open)}
                    >
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild isActive={active} tooltip={name} className={treeRowClass}>
                          <Link
                            to={vaultLocation({ kind: "project", name })}
                            aria-current={active ? "page" : undefined}
                            onClick={(event) => {
                              setProjectExpanded(key, true);
                              resetVaultSearch(event);
                            }}
                          >
                            {expanded && <TreeBridge />}
                            {expanded ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />}
                            <span className="min-w-0 flex-1 truncate">{name}</span>
                            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{count}</span>
                          </Link>
                        </SidebarMenuButton>
                        {availableEnvironments.length > 0 && <TreeToggle label={`Environnements de ${name}`} />}
                        {availableEnvironments.length > 0 && (
                          <Collapsible.Content asChild>
                            <ul
                              aria-label={`Environnements de ${name}`}
                              inert={!expanded}
                              className="tree-branch flex min-w-0 flex-col"
                            >
                              {availableEnvironments.map((environment, index) => {
                                const active = projectScope?.environment === environment;
                                return (
                                  <li key={environment} className="relative py-px">
                                    <TreeGuide last={index === availableEnvironments.length - 1} />
                                    <SidebarMenuButton asChild isActive={active} className={`${treeRowClass} pl-10`}>
                                      <Link
                                        to={vaultLocation({ kind: "project", name, environment })}
                                        aria-current={active ? "page" : undefined}
                                        onClick={resetVaultSearch}
                                      >
                                        <Server aria-hidden="true" className={environmentIconClass[environment]} />
                                        <span className="min-w-0 flex-1 truncate">
                                          {ENVIRONMENT_LABELS[environment]}
                                        </span>
                                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                          {environments[environment]}
                                        </span>
                                      </Link>
                                    </SidebarMenuButton>
                                  </li>
                                );
                              })}
                            </ul>
                          </Collapsible.Content>
                        )}
                      </SidebarMenuItem>
                    </Collapsible.Root>
                  );
                })}
                {unassigned > 0 && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={onVault && vaultScope.kind === "unassigned"}
                      tooltip="Sans projet"
                      className={sidebarLinkClass}
                    >
                      <Link
                        to={vaultLocation({ kind: "unassigned" })}
                        aria-current={onVault && vaultScope.kind === "unassigned" ? "page" : undefined}
                        onClick={resetVaultSearch}
                      >
                        <Inbox aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">Sans projet</span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{unassigned}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
              {!loading && projects.length === 0 && (
                <p className="px-2 py-1 text-xs text-muted-foreground">Aucun projet pour le moment.</p>
              )}
            </SidebarGroup>
            <SidebarMenu className="gap-1">
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={onAi} tooltip="AI" className={sidebarLinkClass}>
                  <Link to="/personal/ai" aria-current={onAi ? "page" : undefined}>
                    <Bot aria-hidden="true" />
                    <span>AI</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </nav>
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border pt-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={onSettings} tooltip="Paramètres" className={sidebarLinkClass}>
                <Link to="/personal/settings" aria-current={onSettings ? "page" : undefined}>
                  <Settings aria-hidden="true" />
                  <span>Paramètres</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={onHealth} tooltip="État du système" className={sidebarLinkClass}>
                <Link to="/personal/health" aria-current={onHealth ? "page" : undefined}>
                  <Activity aria-hidden="true" />
                  <span>État du système</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <p className="px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            Chiffré avec age. Les valeurs ne sont déchiffrées que dans ce navigateur.
          </p>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <VaultSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onOpenEntry={() => onVault}
        onShowResults={(query) => {
          setVaultSearch({ query, filters: {} });
        }}
      />
      {/* Fixed-height inset: the header stays put and only the page content scrolls. */}
      <SidebarInset className="h-svh overflow-hidden md:h-[calc(100svh-1rem)]">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-center" />
          <h1 className="min-w-0 truncate text-sm font-medium">{page.title}</h1>
          <Button variant="outline" size="sm" className="ml-auto" onClick={lock}>
            <LogOut aria-hidden="true" />
            Se déconnecter
          </Button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
          {unreadable.length > 0 && (
            <p role="status" className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
              {plural(
                unreadable.length,
                "élément ne peut pas être lu et reste masqué",
                "éléments ne peuvent pas être lus et restent masqués",
              )}
              . Les autres restent consultables, mais le coffre est en lecture seule et les indicateurs ne comptent que
              les éléments lisibles.{" "}
              <Link to="/personal/health" className="underline">
                Voir l'état du système
              </Link>
            </p>
          )}
          {oldFormat > 0 && (
            <p role="status" className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
              {plural(oldFormat, "élément est stocké", "éléments sont stockés")} dans l'ancien format. Pour les
              réécrire, lancez <code className="font-mono">kf migrate -apply</code>.
            </p>
          )}
          <Outlet context={{ vaultScope, vaultSearch, setVaultSearch } satisfies VaultSearchOutlet} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/** URL of a vault view: a scope (project, environment, no project) and, on the whole vault, a kind. */
function vaultLocation(scope: VaultScope, kind?: Kind) {
  const params = new URLSearchParams(vaultScopeSearch(scope));
  if (kind) params.set("kind", kind);
  const query = params.toString();
  return { pathname: "/personal/vault", search: query ? `?${query}` : "" };
}

/** Tree view chevron (BoardUI): opens or closes the branch of the row it sits on. */
function TreeToggle({ label }: { label: string }) {
  return (
    <Collapsible.Trigger
      aria-label={label}
      className="absolute top-2 left-2 flex size-5 cursor-pointer items-center in-data-[mobile=true]:after:absolute in-data-[mobile=true]:after:-inset-3 justify-center rounded-md text-muted-foreground ring-sidebar-ring outline-hidden transition-colors group-data-[collapsible=icon]:hidden hover:text-sidebar-foreground focus-visible:ring-2 in-data-[mobile=true]:top-3"
    >
      <ChevronRight
        aria-hidden="true"
        className="size-4 opacity-50 transition-transform duration-150 motion-reduce:transition-none [[data-state=open]>&]:rotate-90"
      />
    </Collapsible.Trigger>
  );
}

/** Line from an open branch's icon down to its first child. */
function TreeBridge() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute top-[calc(50%+8px)] bottom-0 left-[18px] w-px bg-sidebar-foreground/15 group-data-[collapsible=icon]:hidden"
    />
  );
}

/** Child row guide: trunk, curved elbow, and a tail down to the next sibling. */
function TreeGuide({ last }: { last: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 left-[18px] z-10 w-4 text-sidebar-foreground/15"
    >
      <span className="absolute top-0 bottom-[calc(50%+6px)] left-0 w-px bg-current" />
      <svg
        aria-hidden="true"
        width="16"
        height="7"
        viewBox="0 0 16 7"
        fill="none"
        className="absolute top-[calc(50%-6px)] left-0"
      >
        <path d="M0.5 0 Q0.5 6 6.5 6 H15.5" stroke="currentColor" strokeWidth="1" />
      </svg>
      {!last && <span className="absolute top-[calc(50%-6px)] bottom-0 left-0 w-px bg-current" />}
    </span>
  );
}

/** On a phone the sidebar is a drawer: close it once a link was followed. */
function CloseDrawerOnNavigate() {
  const { key } = useLocation();
  const { setOpenMobile } = useSidebar();
  // biome-ignore lint/correctness/useExhaustiveDependencies: navigation triggers the drawer close.
  useEffect(() => setOpenMobile(false), [key, setOpenMobile]);
  return null;
}
