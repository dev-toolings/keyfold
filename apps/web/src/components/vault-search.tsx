import { Command } from "cmdk";
import { ArrowDown, ArrowRight, ArrowUp, CornerDownLeft, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useSidebar } from "@/components/ui/sidebar";
import { KIND_ICONS, KIND_LABELS } from "@/lib/labels";
import { matchesVaultQuery } from "@/lib/vault-search";
import type { Item } from "@/vault";
import { useVault } from "@/vault-context";

const PREVIEW_LIMIT = 8;
const itemClass =
  "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground pointer-coarse:min-h-11 [&>svg]:size-4 [&>svg]:shrink-0";

export function VaultSearch({
  open,
  onOpenChange,
  onOpenEntry,
  onShowResults,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenEntry: (item: Item) => boolean;
  onShowResults: (query: string) => void;
}) {
  const { entries, error, loading } = useVault();
  const { setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const openingEntry = useRef(false);
  const search = query.trim();
  const matches = useMemo(() => entries.filter(matchesVaultQuery(search)), [entries, search]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.altKey || event.shiftKey) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      if (
        !open &&
        event.target instanceof Element &&
        event.target.closest('[data-slot="dialog-content"], [data-slot="sheet-content"]:not([data-mobile])')
      ) {
        return;
      }
      event.preventDefault();
      onOpenChange(!open);
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [open, onOpenChange]);

  function goTo(path: string, search = "") {
    if (previousFocus.current?.closest('[data-sidebar="sidebar"][data-mobile="true"]')) {
      previousFocus.current = document.querySelector<HTMLElement>('[data-slot="sidebar-trigger"]');
    }
    onOpenChange(false);
    setOpenMobile(false);
    navigate({ pathname: path, search });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          openingEntry.current = false;
          setQuery("");
          if (titleRef.current) {
            event.preventDefault();
            titleRef.current.focus({ preventScroll: true });
          }
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!openingEntry.current) previousFocus.current?.focus();
        }}
      >
        <DialogDescription className="sr-only">
          Recherchez un élément par nom, identifiant, projet, spécialité, langage ou tag.
        </DialogDescription>
        <Command label="Recherche du coffre" loop shouldFilter={false} vimBindings={false}>
          <DialogTitle ref={titleRef} tabIndex={-1} className="sr-only">
            Rechercher dans le coffre
          </DialogTitle>
          <div className="flex items-center gap-2.5 border-b px-4 pr-11">
            <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Rechercher dans le coffre…"
              className="h-12 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
            />
          </div>
          <Command.List className="max-h-[min(24rem,55dvh)] overflow-y-auto overscroll-contain p-2">
            {loading ? (
              <Command.Loading className="px-3 py-5 text-center text-muted-foreground">Chargement…</Command.Loading>
            ) : (
              <Command.Empty className="px-3 py-5 text-center text-muted-foreground">
                {error && entries.length === 0
                  ? "Le coffre est indisponible."
                  : search
                    ? "Aucun élément trouvé."
                    : "Le coffre est vide."}
              </Command.Empty>
            )}
            {matches.slice(0, PREVIEW_LIMIT).map(({ id, item }) => {
              const Icon = KIND_ICONS[item.kind];
              return (
                <Command.Item
                  key={id}
                  value={`item:${id}`}
                  onSelect={() => {
                    openingEntry.current = true;
                    goTo(`/personal/vault/${id}`, onOpenEntry(item) ? location.search : "");
                  }}
                  className={itemClass}
                >
                  <Icon aria-hidden="true" className="text-muted-foreground" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{item.name}</span>
                    {item.project && <span className="truncate text-xs text-muted-foreground">{item.project}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{KIND_LABELS[item.kind]}</span>
                </Command.Item>
              );
            })}
            {(matches.length > PREVIEW_LIMIT || (search && matches.length > 0)) && (
              <Command.Item
                value="all-results"
                onSelect={() => {
                  onShowResults(search);
                  goTo("/personal/vault");
                }}
                className={itemClass}
              >
                <ArrowRight aria-hidden="true" className="text-muted-foreground" />
                <span>Voir tous les résultats</span>
              </Command.Item>
            )}
          </Command.List>
          <div className="hidden items-center gap-4 border-t px-4 py-2 text-xs text-muted-foreground md:pointer-fine:flex">
            <span>Tab pour saisir</span>
            <span className="flex items-center gap-1.5">
              <ArrowUp aria-hidden="true" className="size-3" />
              <ArrowDown aria-hidden="true" className="size-3" />
              Naviguer
            </span>
            <span className="flex items-center gap-1.5">
              <CornerDownLeft aria-hidden="true" className="size-3" />
              Ouvrir
            </span>
            <span className="ml-auto">Échap pour fermer</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
