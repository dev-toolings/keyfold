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
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { CLEAR_SECONDS, copySecret, copyText } from "@/lib/clipboard";
import { FILTER_LABELS, formatDate, formatSize, KIND_ICONS, KIND_LABELS, plural, VALUE_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import {
  ageDays,
  type BlobRef,
  createdAt,
  deleteAttachment,
  type Entry,
  FILTERS,
  type Filter,
  generatePassphrase,
  generatePassword,
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

/** Rendered over the grid: /vault/new is a modal dialog, /vault/:id is a side sheet. */
export function ItemSheet() {
  const { id } = useParams();
  const { entries, loading } = useVault();
  const navigate = useNavigate();
  const { search } = useLocation();
  const entry = id ? entries.find((e) => e.id === id) : undefined;
  // Id of the item being edited, so switching to another item leaves edit mode.
  const [editing, setEditing] = useState<string | null>(null);

  const close = () => navigate({ pathname: "/personal/vault", search });

  if (!id) {
    return (
      <Dialog open onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-md">
          <ItemForm onDone={close} onCancel={close} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open onOpenChange={(open) => !open && close()}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        {entry && editing === entry.id ? (
          <ItemForm
            key={entry.id}
            entry={entry}
            onDone={(saved) => {
              setEditing(null);
              // Renamed onto another item's name: that item now holds the value.
              if (saved !== entry.id) navigate({ pathname: `/personal/vault/${saved}`, search });
            }}
            onCancel={() => setEditing(null)}
          />
        ) : entry ? (
          <ItemView key={entry.id} entry={entry} onEdit={() => setEditing(entry.id)} onDeleted={close} />
        ) : (
          <SheetHeader>
            <SheetTitle>{loading ? "Chargement…" : "Élément introuvable"}</SheetTitle>
            <SheetDescription>{loading ? "" : "Il a peut-être été supprimé."}</SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Kinds whose value can be generated. */
const GENERATED_KINDS: Kind[] = ["login", "token", "ssh-passphrase"];
/** Kinds that may have an empty value: their content is in fields or the SSH key. */
const OPTIONAL_VALUE_KINDS: Kind[] = ["identity", "ssh-key"];

/** Only web links are clickable: a javascript: or data: URL stays plain text. */
function isWebURL(u: string): boolean {
  return /^https?:\/\//i.test(u);
}

function ItemView({ entry, onEdit, onDeleted }: { entry: Entry; onEdit: () => void; onDeleted: () => void }) {
  const { entries, flags, now, remove, save, download, error } = useVault();
  const { item } = entry;
  const Icon = KIND_ICONS[item.kind];
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
      <SheetHeader className="border-b">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="size-4" />
          {KIND_LABELS[item.kind]}
          {item.folder && <span>· {item.folder}</span>}
          {item.favorite && <Star className="size-3.5 fill-current text-amber-500" aria-label="Favori" />}
        </div>
        <SheetTitle className="text-lg break-all">{item.name}</SheetTitle>
        <SheetDescription>Modifié le {formatDate(item.updated_at)}</SheetDescription>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
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
                      className="inline-flex items-center gap-1 underline"
                    >
                      {u}
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
                  <span className="text-muted-foreground">{reasons[f]}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {item.note && (
          <section className="flex flex-col gap-2">
            <Label>Note</Label>
            <p className="text-sm whitespace-pre-wrap">{item.note}</p>
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

      <SheetFooter className="flex-row justify-between border-t">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <Trash />
              Supprimer
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer « {item.name} » ?</AlertDialogTitle>
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
      </SheetFooter>
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
      <Label>{label}</Label>
      <div className="flex items-start gap-1 rounded-lg border bg-muted/40 p-1 pl-3">
        <code className="min-h-7 flex-1 py-1 font-mono text-sm break-all whitespace-pre-wrap">
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

function ItemForm({ entry, onDone, onCancel }: { entry?: Entry; onDone: (id: string) => void; onCancel: () => void }) {
  const { entries, save, attach, error } = useVault();
  const [draft, setDraft] = useState<Draft>(() => toDraft(entry?.item));
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Attachments uploaded in this form, deleted again unless the item is saved,
  // and stored ones removed here, deleted once the item is saved without them.
  const uploaded = useRef<string[]>([]);
  const removed = useRef<string[]>([]);
  const saved = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const name = draft.name.trim();
  const clash = entries.find((e) => e.item.name === name && e.id !== entry?.id);
  const folders = [...new Set(entries.map((e) => e.item.folder).filter(Boolean))] as string[];
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  // A new item is created in a modal dialog; an existing one is edited in its sheet.
  const modal = !entry;
  const Header = modal ? DialogHeader : SheetHeader;
  const Title = modal ? DialogTitle : SheetTitle;
  const Description = modal ? DialogDescription : SheetDescription;
  const Footer = modal ? DialogFooter : SheetFooter;

  useEffect(
    () => () => {
      if (!saved.current) for (const id of uploaded.current) deleteAttachment(id).catch(() => {});
    },
    [],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const id = await save(entry?.id ?? null, { ...draft, name });
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
    <form onSubmit={submit} className={modal ? "flex max-h-[85vh] flex-col gap-4" : "flex h-full flex-col"}>
      <Header className={cn(!modal && "border-b")}>
        <Title>{entry ? "Modifier l'élément" : "Nouvel élément"}</Title>
        <Description>Tout est chiffré dans ce navigateur avant l'envoi.</Description>
      </Header>
      <div className={cn("flex flex-col gap-4 overflow-y-auto", !modal && "flex-1 p-4", modal && "-mx-1 px-1")}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="item-name">Nom</Label>
          <Input
            id="item-name"
            required
            autoFocus={!entry}
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
          />
          {clash && (
            <p className="text-xs text-muted-foreground">
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
          <Label htmlFor="item-value">{VALUE_LABELS[draft.kind]}</Label>
          {draft.kind === "note" ? (
            <Textarea
              id="item-value"
              required
              value={draft.value}
              onChange={(e) => set({ value: e.target.value })}
              rows={5}
            />
          ) : (
            <div className="flex gap-1">
              <div className="relative flex-1">
                <Input
                  id="item-value"
                  type={shown ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  required={!OPTIONAL_VALUE_KINDS.includes(draft.kind)}
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
                  <DropdownMenuContent align="end">
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
              {draft.urls.map((u, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity but their position
                <div key={i} className="flex gap-1">
                  <Input
                    type="url"
                    aria-label={`Adresse ${i + 1}`}
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
              ))}
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
                  set({ fields: draft.fields.map((x, j) => (j === i ? { ...x, hidden: !x.hidden || undefined } : x)) })
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

        {draft.kind !== "note" && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="item-note">Note</Label>
            <Textarea id="item-note" value={draft.note} onChange={(e) => set({ note: e.target.value })} rows={3} />
          </div>
        )}

        <div className="flex items-end gap-3">
          <div className="flex flex-1 flex-col gap-2">
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
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={draft.favorite}
              onChange={(e) => set({ favorite: e.target.checked })}
            />
            Favori
          </label>
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
          <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
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

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <Footer className={cn(!modal && "flex-row justify-end border-t")}>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit" size="sm" disabled={busy || uploading}>
          {busy && <LoaderCircle className="animate-spin" />}
          Enregistrer
        </Button>
      </Footer>
    </form>
  );
}
