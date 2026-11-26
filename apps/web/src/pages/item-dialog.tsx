import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  LoaderCircle,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Star,
  Trash,
  WandSparkles,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useLocation, useNavigate, useOutletContext, useParams } from "react-router";
import { z } from "zod";
import { EnvironmentBadge } from "@/components/environment-badge";
import { ProjectDialog } from "@/components/project-dialog";
import { Badge } from "@/components/reui/badge";
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldError, focusFirstInvalidField } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  CLASSIFICATION_FIELDS,
  CLASSIFICATION_LABELS,
  classificationKey,
  classificationValues,
  ENVIRONMENT_LABELS,
  groupVaultProjects,
} from "@/lib/classification";
import { CLEAR_SECONDS, copySecret, copyText } from "@/lib/clipboard";
import { itemFormSchema, OPTIONAL_VALUE_KINDS } from "@/lib/form-validation";
import { FILTER_LABELS, formatDate, formatSize, KIND_ICONS, KIND_LABELS, plural, VALUE_LABELS } from "@/lib/labels";
import type { ItemDialogOutlet } from "@/pages/vault";
import {
  ageDays,
  type BlobRef,
  createdAt,
  deleteAttachment,
  ENVIRONMENTS,
  type Entry,
  type Environment,
  FILTERS,
  type Filter,
  generatePassphrase,
  generatePassword,
  type Item,
  KINDS,
  type Kind,
  reusedGroups,
  SHORT_LENGTH,
  STALE_DAYS,
  strengthBits,
  totpCode,
  WEAK_BITS,
} from "@/vault";
import { type Draft, toDraft, useVault } from "@/vault-context";

export function ItemDialog() {
  const { id } = useParams();
  const { entries, loading } = useVault();
  const navigate = useNavigate();
  const { search, state } = useLocation();
  const { vaultScope, focusList } = useOutletContext<ItemDialogOutlet>();
  const previousFocus = useRef<HTMLElement | null>(null);
  const entry = id ? entries.find((e) => e.id === id) : undefined;
  // Id of the item being edited, so switching to another item leaves edit mode.
  const [editing, setEditing] = useState<string | null>(null);

  function close() {
    if (state?.fromVault === true) navigate(-1);
    else navigate({ pathname: "/personal/vault", search }, { replace: true });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="flex h-dvh max-w-none flex-col rounded-none pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] max-sm:pr-[calc(1rem+env(safe-area-inset-right))] max-sm:pl-[calc(1rem+env(safe-area-inset-left))] sm:h-auto sm:max-h-[85dvh] sm:w-[calc(100%-2rem)] sm:max-w-4xl sm:rounded-xl sm:py-4"
        showCloseButton={false}
        onOpenAutoFocus={() => {
          const active = document.activeElement;
          previousFocus.current =
            active instanceof HTMLElement && active !== document.body && !active.closest('[role="dialog"]')
              ? active
              : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
          else focusList();
        }}
      >
        {!id ? (
          <ItemForm
            initialProject={vaultScope.kind === "project" ? vaultScope.name : undefined}
            initialEnvironment={vaultScope.kind === "project" ? vaultScope.environment : undefined}
            onDone={close}
            onCancel={close}
          />
        ) : entry && editing === entry.id ? (
          <ItemForm
            key={entry.id}
            entry={entry}
            onDone={(saved) => {
              setEditing(null);
              // Renamed onto another item's name: that item now holds the value.
              if (saved !== entry.id) {
                navigate({ pathname: `/personal/vault/${saved}`, search }, { replace: true, state });
              }
            }}
            onCancel={() => setEditing(null)}
          />
        ) : entry ? (
          <ItemView key={entry.id} entry={entry} onEdit={() => setEditing(entry.id)} onDeleted={close} />
        ) : (
          <DialogHeader className="shrink-0 pr-10">
            <DialogTitle>{loading ? "Chargement…" : "Élément introuvable"}</DialogTitle>
            <DialogDescription>{loading ? "Lecture du coffre." : "Il a peut-être été supprimé."}</DialogDescription>
          </DialogHeader>
        )}
        <DialogClose asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Fermer"
            className="absolute top-[calc(0.5rem+env(safe-area-inset-top))] right-[calc(0.5rem+env(safe-area-inset-right))] pointer-coarse:size-11 sm:top-2 sm:right-2"
          >
            <X aria-hidden="true" />
          </Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

/** Kinds whose value can be generated. */
const GENERATED_KINDS: Kind[] = ["login", "token", "ssh-passphrase"];

/** Only web links are clickable: a javascript: or data: URL stays plain text. */
function isWebURL(u: string): boolean {
  return /^https?:\/\//i.test(u);
}

function ItemHeader({
  title,
  description,
  item,
}: {
  title: string;
  description: string;
  item: Pick<Item, "kind" | "environment" | "project" | "folder" | "favorite">;
}) {
  const Icon = KIND_ICONS[item.kind];
  return (
    <DialogHeader className="shrink-0 pr-10">
      <DialogTitle className="line-clamp-2 text-lg wrap-anywhere" title={title}>
        {title}
      </DialogTitle>
      <DialogDescription>{description}</DialogDescription>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <Icon className="size-4" aria-hidden="true" />
          {KIND_LABELS[item.kind]}
        </span>
        {item.environment && <EnvironmentBadge environment={item.environment} size="sm" />}
        {item.project && (
          <span className="max-w-full truncate" title={item.project}>
            {item.project}
          </span>
        )}
        {item.folder && (
          <span className="max-w-full truncate" title={item.folder}>
            {item.folder}
          </span>
        )}
        {item.favorite && <Star className="size-3.5 fill-current text-amber-500" aria-label="Favori" />}
      </div>
    </DialogHeader>
  );
}

function ItemView({ entry, onEdit, onDeleted }: { entry: Entry; onEdit: () => void; onDeleted: () => void }) {
  const { entries, flags, now, remove, save, download, error } = useVault();
  const { item } = entry;
  const classification = CLASSIFICATION_FIELDS.flatMap((field) => {
    const values = classificationValues(item, field);
    return values.length ? [{ field, values }] : [];
  });
  const active = FILTERS.filter((f) => flags[f].has(entry.id));
  const sharedWith =
    reusedGroups(entries)
      .find((g) => g.some((e) => e.id === entry.id))
      ?.filter((e) => e.id !== entry.id)
      .map((e) => e.item.name) ?? [];

  const reasons: Record<Filter, string> = {
    stale: `Non modifié depuis ${plural(ageDays(item.updated_at, now), "jour", "jours")} (plus de ${STALE_DAYS}).`,
    reused: `Même valeur que : ${sharedWith.join(", ")}.`,
    short: `${plural([...item.value].length, "caractère", "caractères")}, moins de ${SHORT_LENGTH}.`,
    weak: `Force estimée : ${Math.round(strengthBits(item.value))} bits, moins de ${WEAK_BITS}.`,
    no2fa: "Ce site a une adresse mais aucun secret de double authentification n'est enregistré.",
  };

  return (
    <>
      <ItemHeader title={item.name} description={`Modifié le ${formatDate(item.updated_at)}`} item={item} />

      <div className="-m-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain p-1">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {item.username && <CopyRow label="Identifiant" value={item.username} />}
        {(item.value || !OPTIONAL_VALUE_KINDS.includes(item.kind)) && (
          <CopyRow label={VALUE_LABELS[item.kind]} value={item.value} secret />
        )}
        {item.totp && <TotpRow spec={item.totp} />}

        {(classification.length > 0 || item.environment) && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Classement</h3>
            <dl className="grid gap-2 sm:grid-cols-2">
              {classification.map(({ field, values }) => (
                <div key={field} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{CLASSIFICATION_LABELS[field]}</dt>
                  <dd className="flex flex-wrap gap-1 pt-1">
                    {values.map((value) => (
                      <Badge key={value} variant="secondary" className="max-w-full">
                        <span className="min-w-0 wrap-anywhere whitespace-normal">{value}</span>
                      </Badge>
                    ))}
                  </dd>
                </div>
              ))}
              {item.environment && (
                <div>
                  <dt className="text-xs text-muted-foreground">Environnement</dt>
                  <dd className="pt-1">
                    <EnvironmentBadge environment={item.environment} />
                  </dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {item.urls && item.urls.length > 0 && (
          <section className="flex flex-col gap-2">
            <Label>{item.urls.length > 1 ? "Adresses" : "Adresse"}</Label>
            <ul className="flex flex-col gap-1 text-sm">
              {item.urls.map((u) => (
                <li key={u} className="break-all">
                  {isWebURL(u) ? (
                    <a
                      href={u}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex max-w-full items-center gap-1 underline"
                    >
                      <span className="min-w-0 wrap-anywhere">{u}</span>
                      <ExternalLink className="size-3.5 shrink-0" />
                    </a>
                  ) : (
                    u
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {item.fields?.map((f) => (
          <CopyRow key={f.name} label={f.name} value={f.value} secret={f.hidden} />
        ))}

        {item.ssh_key && (
          <>
            <CopyRow label="Clé publique SSH" value={item.ssh_key.public} />
            {item.ssh_key.fingerprint && <CopyRow label="Empreinte" value={item.ssh_key.fingerprint} />}
            <CopyRow label="Clé privée SSH" value={item.ssh_key.private} secret />
          </>
        )}

        {active.length > 0 && (
          <section className="flex flex-col gap-2">
            <Label>État</Label>
            <ul className="flex flex-col gap-2">
              {active.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <Badge variant={f === "reused" ? "destructive-light" : "warning-light"} size="sm" className="mt-0.5">
                    {FILTER_LABELS[f]}
                  </Badge>
                  <span className="min-w-0 wrap-anywhere text-muted-foreground">{reasons[f]}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {item.note && (
          <section className="flex flex-col gap-2">
            <Label>Note</Label>
            <p className="text-sm wrap-anywhere whitespace-pre-wrap">{item.note}</p>
          </section>
        )}

        {item.attachments && item.attachments.length > 0 && (
          <section className="flex flex-col gap-2">
            <Label>Pièces jointes</Label>
            <ul className="flex flex-col gap-1">
              {item.attachments.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-sm">
                  <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{formatSize(a.size)}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => download(a)}
                    aria-label={`Télécharger ${a.name}`}
                  >
                    <Download />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {item.history && item.history.length > 0 && (
          <section className="flex flex-col gap-2">
            <Label>Valeurs précédentes</Label>
            <ul className="flex flex-col gap-1">
              {item.history.map((h) => (
                <li key={`${h.changed_at}-${h.value}`} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 text-muted-foreground">Remplacée le {formatDate(h.changed_at)}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => copySecret(h.value)}
                    aria-label="Copier cette valeur"
                  >
                    <Copy />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => save(entry.id, { ...toDraft(item), value: h.value })}
                  >
                    <RotateCcw />
                    Restaurer
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <Separator />
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Type</dt>
          <dd>{KIND_LABELS[item.kind]}</dd>
          <dt className="text-muted-foreground">Créé le</dt>
          <dd>{formatDate(createdAt(item))}</dd>
          <dt className="text-muted-foreground">Modifié le</dt>
          <dd>{formatDate(item.updated_at)}</dd>
        </dl>
      </div>

      <DialogFooter className="shrink-0 flex-row justify-between rounded-none sm:justify-between sm:rounded-b-xl">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <Trash />
              Supprimer
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="wrap-anywhere">Supprimer « {item.name} » ?</AlertDialogTitle>
              <AlertDialogDescription>
                L'élément et ses pièces jointes sont effacés du coffre. Cette action ne peut pas être annulée.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={async () => {
                  if (await remove(entry.id)) onDeleted();
                }}
              >
                Supprimer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button size="sm" onClick={onEdit}>
          <Pencil />
          Modifier
        </Button>
      </DialogFooter>
    </>
  );
}

/** A labelled value with a copy button. A secret is masked until shown, and cleared from the clipboard later. */
function CopyRow({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [shown, setShown] = useState(!secret);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (secret) await copySecret(value);
    else await copyText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="flex flex-col gap-2">
      <Label className="wrap-anywhere">{label}</Label>
      <div className="flex items-start gap-1 rounded-lg border bg-muted/40 p-1 pl-3">
        <code className="min-h-7 min-w-0 flex-1 py-1 font-mono text-sm wrap-anywhere whitespace-pre-wrap">
          {shown ? value : "••••••••••••••••"}
        </code>
        {secret && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setShown(!shown)}
            aria-label={shown ? `Masquer : ${label}` : `Afficher : ${label}`}
          >
            {shown ? <EyeOff /> : <Eye />}
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={copy} aria-label={`Copier : ${label}`}>
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      {copied && (
        <p className="text-xs text-muted-foreground">
          Copié dans le presse-papiers{secret && `, effacé dans ${CLEAR_SECONDS} s`}.
        </p>
      )}
    </section>
  );
}

/** The current TOTP code and the seconds it has left, refreshed every second. */
function TotpRow({ spec }: { spec: string }) {
  const [state, setState] = useState<{ code: string; remaining: number } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    const tick = () =>
      totpCode(spec)
        .then((c) => live && setState(c))
        .catch(() => live && setInvalid(true));
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [spec]);

  if (invalid) {
    return (
      <section className="flex flex-col gap-2">
        <Label>Double authentification</Label>
        <p className="text-sm text-destructive">Le secret TOTP enregistré est invalide.</p>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-2">
      <Label>Code de double authentification</Label>
      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-1 pl-3">
        <code className="flex-1 font-mono text-lg tracking-[0.3em]">{state?.code ?? "······"}</code>
        <span className="text-xs text-muted-foreground tabular-nums">{state ? `${state.remaining} s` : ""}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Copier le code"
          onClick={async () => {
            if (!state) return;
            await copySecret(state.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </section>
  );
}

function ItemForm({
  entry,
  initialProject = "",
  initialEnvironment,
  onDone,
  onCancel,
}: {
  entry?: Entry;
  initialProject?: string;
  initialEnvironment?: Environment;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const { entries, projects: projectEntries, save, createProject, attach, error } = useVault();
  const [initialDraft] = useState<Draft>(() => ({
    ...toDraft(entry?.item),
    project: entry?.item.project ?? initialProject,
    environment: entry ? entry.item.environment : initialEnvironment,
  }));
  const [draft, setDraft] = useState(initialDraft);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showFieldErrors, setShowFieldErrors] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const confirmationFocus = useRef<HTMLElement | null>(null);
  // Attachments uploaded in this form, deleted again unless the item is saved,
  // and stored ones removed here, deleted once the item is saved without them.
  const uploaded = useRef<string[]>([]);
  const removed = useRef<string[]>([]);
  const saved = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirty = uploading || (draft !== initialDraft && JSON.stringify(draft) !== JSON.stringify(initialDraft));
  const blocker = useBlocker(
    ({ nextLocation, historyAction }) =>
      !saved.current &&
      (dirty || busy) &&
      !(historyAction === "REPLACE" && nextLocation.pathname === "/personal/unlock"),
  );
  const name = draft.name.trim();
  const clash = entries.find((e) => e.item.name === name && e.id !== entry?.id);
  const crossProjectClash = Boolean(
    clash && classificationKey(clash.item.project ?? "") !== classificationKey(draft.project),
  );
  const folders = [...new Set(entries.map((e) => e.item.folder).filter(Boolean))] as string[];
  const projectOptions = useMemo(
    () =>
      new Map(
        groupVaultProjects(entries, projectEntries).projects.map(({ name }) => [
          `project:${classificationKey(name)}`,
          name,
        ]),
      ),
    [entries, projectEntries],
  );
  const projectKey = classificationKey(draft.project);
  const selectedProject = projectKey ? `project:${projectKey}` : "none";
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const fields = {
    name: draft.name,
    kind: draft.kind,
    value: draft.value,
    urls: draft.kind === "login" ? draft.urls : [],
  };
  const validation = showFieldErrors ? itemFormSchema.safeParse(fields) : undefined;
  const fieldErrors = validation && !validation.success ? z.treeifyError(validation.error).properties : undefined;
  const nameError =
    fieldErrors?.name?.errors[0] ??
    (crossProjectClash ? "Ce nom est déjà pris dans le coffre. Choisissez un autre nom." : undefined);
  const valueError = fieldErrors?.value?.errors[0];
  const valueRequired = !OPTIONAL_VALUE_KINDS.includes(draft.kind);

  useEffect(() => {
    if (!dirty && !busy) return;
    // Full-page history entries are handled by the browser, outside the router.
    function confirmUnload(event: BeforeUnloadEvent) {
      if (saved.current) return;
      event.preventDefault();
      event.returnValue = true;
    }
    window.addEventListener("beforeunload", confirmUnload);
    return () => window.removeEventListener("beforeunload", confirmUnload);
  }, [dirty, busy]);

  useEffect(
    () => () => {
      if (!saved.current) for (const id of uploaded.current) deleteAttachment(id).catch(() => {});
    },
    [],
  );

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = validation ?? itemFormSchema.safeParse(fields);
    if (!result.success || crossProjectClash) {
      setShowFieldErrors(true);
      focusFirstInvalidField(e.currentTarget);
      return;
    }
    setShowFieldErrors(false);
    setBusy(true);
    const id = await save(entry?.id ?? null, { ...draft, name: result.data.name });
    setBusy(false);
    if (!id) return;
    saved.current = true;
    for (const r of removed.current) deleteAttachment(r).catch(() => {});
    onDone(id);
  }

  async function addFiles(files: FileList | null) {
    setUploading(true);
    for (const file of files ?? []) {
      const ref = await attach(file);
      if (!ref) break;
      if (!fileInput.current) {
        deleteAttachment(ref.id).catch(() => {});
        break;
      }
      uploaded.current.push(ref.id);
      setDraft((d) => ({ ...d, attachments: [...d.attachments, ref] }));
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  function removeAttachment(ref: BlobRef) {
    set({ attachments: draft.attachments.filter((a) => a.id !== ref.id) });
    if (uploaded.current.includes(ref.id)) deleteAttachment(ref.id).catch(() => {});
    else removed.current.push(ref.id);
  }

  return (
    <form noValidate onSubmit={submit} className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <ItemHeader
        title={entry ? "Modifier l'élément" : "Nouvel élément"}
        description="Tout est chiffré dans ce navigateur avant l'envoi."
        item={draft}
      />
      <div className="-m-1 min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-py-1 p-1">
        <div className="grid gap-5 sm:grid-cols-2 sm:gap-6">
          <section className="flex min-w-0 flex-col gap-4" aria-label="Contenu">
            <h3 className="text-sm font-semibold">Contenu</h3>
            <div className="flex flex-col gap-2">
              <Label htmlFor="item-name" isRequired>
                Nom
              </Label>
              <Input
                id="item-name"
                aria-required="true"
                aria-invalid={!!nameError}
                aria-describedby={nameError ? "item-name-error" : undefined}
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
              />
              <FieldError id="item-name" error={nameError} />
              {clash && !crossProjectClash && (
                <p className="text-xs wrap-anywhere text-muted-foreground">
                  « {name} » existe déjà : l'enregistrement remplacera cet élément.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="item-kind">Type</Label>
              <Select value={draft.kind} onValueChange={(v) => set({ kind: v as Kind })}>
                <SelectTrigger id="item-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {draft.kind === "login" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="item-username">Identifiant</Label>
                <Input
                  id="item-username"
                  autoComplete="off"
                  spellCheck={false}
                  value={draft.username}
                  onChange={(e) => set({ username: e.target.value })}
                />
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="item-value" isRequired={valueRequired}>
                {VALUE_LABELS[draft.kind]}
              </Label>
              {draft.kind === "note" ? (
                <Textarea
                  id="item-value"
                  aria-required={valueRequired}
                  aria-invalid={!!valueError}
                  aria-describedby={valueError ? "item-value-error" : undefined}
                  value={draft.value}
                  onChange={(e) => set({ value: e.target.value })}
                  rows={5}
                />
              ) : (
                <div className="flex gap-1">
                  <div className="relative min-w-0 flex-1">
                    <Input
                      id="item-value"
                      type={shown ? "text" : "password"}
                      autoComplete="off"
                      spellCheck={false}
                      aria-required={valueRequired}
                      aria-invalid={!!valueError}
                      aria-describedby={valueError ? "item-value-error" : undefined}
                      value={draft.value}
                      onChange={(e) => set({ value: e.target.value })}
                      className="pr-9 font-mono"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setShown(!shown)}
                      aria-label={shown ? "Masquer la valeur" : "Afficher la valeur"}
                      className="absolute top-1/2 right-1.5 -translate-y-1/2"
                    >
                      {shown ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                  {GENERATED_KINDS.includes(draft.kind) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" size="icon" aria-label="Générer une valeur">
                          <WandSparkles />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        collisionPadding={8}
                        className="w-max max-w-(--radix-dropdown-menu-content-available-width)"
                      >
                        <DropdownMenuItem
                          onSelect={() => {
                            set({ value: generatePassword(24) });
                            setShown(true);
                          }}
                        >
                          Mot de passe (24 caractères)
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            set({ value: generatePassphrase(6) });
                            setShown(true);
                          }}
                        >
                          Phrase de passe (6 mots)
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              )}
              <FieldError id="item-value" error={valueError} />
              {(draft.kind === "login" || draft.kind === "ssh-passphrase") && draft.value && (
                <p className="text-xs text-muted-foreground">
                  {plural([...draft.value].length, "caractère", "caractères")}, force estimée{" "}
                  {Math.round(strengthBits(draft.value))} bits
                  {strengthBits(draft.value) < WEAK_BITS && ` : sera signalé comme faible (moins de ${WEAK_BITS})`}
                </p>
              )}
            </div>

            {draft.kind === "login" && (
              <>
                <div className="flex flex-col gap-2">
                  <Label>Adresses</Label>
                  {draft.urls.map((u, i) => {
                    const id = `item-url-${i}`;
                    const urlError = fieldErrors?.urls?.items?.[i]?.errors[0];
                    return (
                      // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity but their position
                      <div key={i} className="flex flex-col gap-1">
                        <div className="flex gap-1">
                          <Input
                            id={id}
                            type="url"
                            aria-label={`Adresse ${i + 1}`}
                            aria-invalid={!!urlError}
                            aria-describedby={urlError ? `${id}-error` : undefined}
                            placeholder="https://"
                            value={u}
                            onChange={(e) => set({ urls: draft.urls.map((x, j) => (j === i ? e.target.value : x)) })}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Retirer l'adresse ${i + 1}`}
                            onClick={() => set({ urls: draft.urls.filter((_, j) => j !== i) })}
                          >
                            <X />
                          </Button>
                        </div>
                        <FieldError id={id} error={urlError} />
                      </div>
                    );
                  })}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => set({ urls: [...draft.urls, ""] })}
                  >
                    <Plus />
                    Ajouter une adresse
                  </Button>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="item-totp">Double authentification (TOTP)</Label>
                  <Input
                    id="item-totp"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="otpauth://totp/… ou secret base32"
                    value={draft.totp}
                    onChange={(e) => set({ totp: e.target.value })}
                    className="font-mono"
                  />
                </div>
              </>
            )}
          </section>
          <section className="flex min-w-0 flex-col gap-4 sm:border-l sm:pl-6" aria-label="Organisation">
            <h3 className="text-sm font-semibold">Organisation</h3>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="item-project">Projet</Label>
                <div className="flex min-w-0 items-center gap-2">
                  <Select
                    value={selectedProject}
                    onValueChange={(value) => set({ project: projectOptions.get(value) ?? "" })}
                  >
                    <SelectTrigger
                      id="item-project"
                      className="min-w-0 flex-1 pointer-coarse:min-h-11 *:data-[slot=select-value]:min-w-0"
                    >
                      <SelectValue>
                        <span className="truncate">
                          {projectOptions.get(selectedProject) ?? (draft.project.trim() || "Sans projet")}
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent position="popper" align="start" className="w-(--radix-select-trigger-width)">
                      <SelectItem value="none" className="pointer-coarse:min-h-11">
                        Sans projet
                      </SelectItem>
                      {[...projectOptions].map(([value, name]) => (
                        <SelectItem key={value} value={value} className="wrap-anywhere pointer-coarse:min-h-11">
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <ProjectDialog
                    trigger={
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Créer un projet"
                        title="Créer un projet"
                        className="shrink-0 pointer-coarse:size-11"
                      >
                        <Plus aria-hidden="true" />
                      </Button>
                    }
                    onCreate={async (project) => {
                      await createProject(project);
                      set({ project: project.name });
                    }}
                  />
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="item-environment">Environnement</Label>
                <Select
                  value={draft.environment ?? "none"}
                  onValueChange={(value) =>
                    set({ environment: ENVIRONMENTS.find((environment) => environment === value) })
                  }
                >
                  <SelectTrigger id="item-environment" className="w-full min-w-0 pointer-coarse:min-h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" align="start">
                    <SelectItem value="none" className="pointer-coarse:min-h-11">
                      Sans environnement
                    </SelectItem>
                    {ENVIRONMENTS.map((environment) => (
                      <SelectItem key={environment} value={environment} className="pointer-coarse:min-h-11">
                        {ENVIRONMENT_LABELS[environment]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {draft.kind !== "note" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="item-note">Note</Label>
                <Textarea id="item-note" value={draft.note} onChange={(e) => set({ note: e.target.value })} rows={3} />
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label>Champs personnalisés</Label>
              {draft.fields.map((f, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity but their position
                <div key={i} className="flex items-center gap-1">
                  <Input
                    aria-label={`Nom du champ ${i + 1}`}
                    placeholder="Nom"
                    value={f.name}
                    onChange={(e) =>
                      set({ fields: draft.fields.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })
                    }
                    className="w-1/3"
                  />
                  <Input
                    aria-label={`Valeur du champ ${i + 1}`}
                    placeholder="Valeur"
                    type={f.hidden ? "password" : "text"}
                    autoComplete="off"
                    value={f.value}
                    onChange={(e) =>
                      set({ fields: draft.fields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })
                    }
                    className="flex-1 font-mono"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-pressed={Boolean(f.hidden)}
                    aria-label={f.hidden ? `Champ ${i + 1} masqué : le rendre visible` : `Masquer le champ ${i + 1}`}
                    onClick={() =>
                      set({
                        fields: draft.fields.map((x, j) => (j === i ? { ...x, hidden: !x.hidden || undefined } : x)),
                      })
                    }
                  >
                    {f.hidden ? <EyeOff /> : <Eye />}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Retirer le champ ${i + 1}`}
                    onClick={() => set({ fields: draft.fields.filter((_, j) => j !== i) })}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => set({ fields: [...draft.fields, { name: "", value: "" }] })}
              >
                <Plus />
                Ajouter un champ
              </Button>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="item-folder">Dossier</Label>
              <Input
                id="item-folder"
                list="item-folders"
                value={draft.folder}
                onChange={(e) => set({ folder: e.target.value })}
              />
              <datalist id="item-folders">
                {folders.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Pièces jointes</Label>
              {draft.attachments.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-sm">
                  <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{formatSize(a.size)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Retirer ${a.name}`}
                    onClick={() => removeAttachment(a)}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              <input
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => addFiles(e.target.files)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                disabled={uploading}
                onClick={() => fileInput.current?.click()}
              >
                {uploading ? <LoaderCircle className="animate-spin" /> : <Paperclip />}
                {uploading ? "Chiffrement et envoi…" : "Joindre un fichier"}
              </Button>
            </div>
          </section>
        </div>
      </div>
      {error && (
        <p role="alert" className="shrink-0 text-sm wrap-anywhere text-destructive">
          {error}
        </p>
      )}
      <DialogFooter className="shrink-0 flex-row flex-wrap items-center rounded-none sm:rounded-b-xl">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={draft.favorite}
          className="pointer-coarse:min-h-11 aria-pressed:[&_svg]:fill-current aria-pressed:[&_svg]:text-amber-500"
          onClick={() => set({ favorite: !draft.favorite })}
        >
          <Star aria-hidden="true" />
          Favori
        </Button>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="pointer-coarse:min-h-11"
            disabled={busy}
            onClick={() => {
              if (entry && dirty) setConfirmCancel(true);
              else onCancel();
            }}
          >
            Annuler
          </Button>
          <Button
            type="submit"
            size="sm"
            className="pointer-coarse:min-h-11"
            disabled={busy || uploading || crossProjectClash}
          >
            {busy && <LoaderCircle className="animate-spin" />}
            Enregistrer
          </Button>
        </div>
      </DialogFooter>
      <AlertDialog
        open={confirmCancel || blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (open) return;
          setConfirmCancel(false);
          if (blocker.state === "blocked") blocker.reset();
        }}
      >
        <AlertDialogContent
          onOpenAutoFocus={() => {
            const active = document.activeElement;
            confirmationFocus.current = active instanceof HTMLElement ? active : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (confirmationFocus.current?.isConnected) confirmationFocus.current.focus({ preventScroll: true });
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Abandonner les modifications ?</AlertDialogTitle>
            <AlertDialogDescription>Les modifications non enregistrées seront perdues.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuer la saisie</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy || uploading}
              onClick={(event) => {
                event.preventDefault();
                if (blocker.state === "blocked") blocker.proceed();
                else onCancel();
              }}
            >
              Abandonner
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
