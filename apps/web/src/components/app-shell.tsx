import { Activity, LayoutDashboard, Lock, Search, Settings, Vault } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { KIND_ICONS, KIND_PLURALS, plural } from "@/lib/labels";
import { countByKind, KINDS } from "@/vault";
import { useVault } from "@/vault-context";

export function AppShell() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { entries, oldFormat, lock } = useVault();
  const counts = useMemo(() => countByKind(entries), [entries]);
  const onVault = pathname.startsWith("/personal/vault");
  const activeKind = onVault ? params.get("kind") : null;

  return (
    <SidebarProvider>
      <CloseDrawerOnNavigate />
      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link to="/personal/dashboard">
                  <img src="/brand/logo-tile.png" alt="" className="size-8 shrink-0" />
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate font-semibold">Keyfold</span>
                    <span className="truncate text-xs text-muted-foreground">Coffre personnel</span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/personal/dashboard"} tooltip="Tableau de bord">
                    <Link to="/personal/dashboard">
                      <LayoutDashboard />
                      <span>Tableau de bord</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={onVault && !activeKind} tooltip="Coffre">
                    <Link to="/personal/vault">
                      <Vault />
                      <span>Coffre</span>
                    </Link>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>{entries.length}</SidebarMenuBadge>
                  {/* No right inset: the per-kind counts line up with the total above. */}
                  <SidebarMenuSub className="mr-0 pr-0">
                    {KINDS.map((k) => {
                      const Icon = KIND_ICONS[k];
                      return (
                        <SidebarMenuSubItem key={k}>
                          <SidebarMenuSubButton asChild isActive={activeKind === k}>
                            <Link to={`/personal/vault?kind=${k}`}>
                              <Icon />
                              <span className="truncate">{KIND_PLURALS[k]}</span>
                              <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                                {counts[k]}
                              </span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      );
                    })}
                  </SidebarMenuSub>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/personal/health"} tooltip="État du système">
                    <Link to="/personal/health">
                      <Activity />
                      <span>État du système</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === "/personal/settings"} tooltip="Paramètres">
                <Link to="/personal/settings">
                  <Settings />
                  <span>Paramètres</span>
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
      {/* Fixed-height inset: the header stays put and only the page content scrolls. */}
      <SidebarInset className="h-svh overflow-hidden md:h-[calc(100svh-1rem)]">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-center" />
          <h1 className="text-sm font-medium">
            {pathname === "/personal/settings"
              ? "Paramètres"
              : pathname === "/personal/health"
                ? "État du système"
                : onVault
                  ? "Coffre"
                  : "Tableau de bord"}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            <GlobalSearch />
            <Button variant="outline" size="sm" onClick={lock}>
              <Lock />
              Verrouiller
            </Button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
          {oldFormat > 0 && (
            <p role="status" className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
              {plural(oldFormat, "élément est stocké", "éléments sont stockés")} dans l'ancien format. Pour les
              réécrire, lancez <code className="font-mono">kf migrate -apply</code>.
            </p>
          )}
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/** On a phone the sidebar is a drawer: close it once a link was followed. */
function CloseDrawerOnNavigate() {
  const { pathname, search } = useLocation();
  const { setOpenMobile } = useSidebar();
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname and search are the trigger, not inputs.
  useEffect(() => setOpenMobile(false), [pathname, search, setOpenMobile]);
  return null;
}

/** Submits to /vault?q=...; mirrors q while on the vault page. */
function GlobalSearch() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const urlQuery = pathname.startsWith("/personal/vault") ? (params.get("q") ?? "") : "";
  const [query, setQuery] = useState(urlQuery);
  useEffect(() => setQuery(urlQuery), [urlQuery]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    navigate(q ? `/personal/vault?${new URLSearchParams({ q })}` : "/personal/vault");
  }

  return (
    <form onSubmit={submit} className="relative hidden sm:block">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label="Rechercher dans le coffre"
        placeholder="Rechercher…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-8 w-56 pl-8 lg:w-72"
      />
    </form>
  );
}
