// Decrypted entries shared by the unlocked pages. A LockedError (401 while
// unlocked) sends the user back to /personal/unlock and remembers the current page.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { errorMessage } from "@/lib/labels";
import * as vault from "@/vault";
import { type Filter, flaggedIds } from "@/vault";

/** What the item form edits. History, passkeys and SSH keys are kept from the stored item. */
export type Draft = Pick<vault.Item, "name" | "kind" | "value" | "note"> &
  Required<Pick<vault.Item, "username" | "urls" | "totp" | "fields" | "favorite" | "folder" | "attachments">>;

/** The draft of a stored item, or of a new one. */
export function toDraft(item?: vault.Item): Draft {
  return {
    name: item?.name ?? "",
    kind: item?.kind ?? "login",
    value: item?.value ?? "",
    note: item?.note ?? "",
    username: item?.username ?? "",
    urls: item?.urls ?? [],
    totp: item?.totp ?? "",
    fields: item?.fields ?? [],
    favorite: item?.favorite ?? false,
    folder: item?.folder ?? "",
    attachments: item?.attachments ?? [],
  };
}

/** Empty optional fields are left out of the stored item. */
function compact(draft: Draft): Partial<vault.Item> {
  const urls = draft.urls.map((u) => u.trim()).filter(Boolean);
  const fields = draft.fields.filter((f) => f.name.trim());
  return {
    ...draft,
    username: draft.username || undefined,
    urls: urls.length ? urls : undefined,
    totp: draft.totp.trim() || undefined,
    fields: fields.length ? fields : undefined,
    favorite: draft.favorite || undefined,
    folder: draft.folder.trim() || undefined,
    attachments: draft.attachments.length ? draft.attachments : undefined,
  };
}

type VaultContext = {
  entries: vault.Entry[];
  /** Items still stored in an older format: `kf migrate -apply` rewrites them. */
  oldFormat: number;
  loading: boolean;
  error: string;
  /** Reference date for every statistic, taken when the entries were loaded. */
  now: Date;
  flags: Record<Filter, Set<string>>;
  /** Saves a draft and returns the id it was stored under, or null on failure (error is set). */
  save: (id: string | null, draft: Draft) => Promise<string | null>;
  remove: (id: string) => Promise<boolean>;
  /** Encrypts and uploads a file; the caller lists the ref in a draft. Null on failure. */
  attach: (file: File) => Promise<vault.BlobRef | null>;
  /** Decrypts an attachment and hands it to the browser as a download. */
  download: (ref: vault.BlobRef) => Promise<void>;
  lock: () => Promise<void>;
};

const Context = createContext<VaultContext | null>(null);

export function useVault(): VaultContext {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useVault outside VaultProvider");
  return ctx;
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [entries, setEntries] = useState<vault.Entry[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | null> => {
      setError("");
      try {
        return await action();
      } catch (e) {
        if (e instanceof vault.LockedError) navigate("/personal/unlock", { replace: true, state: { from: location } });
        else setError(errorMessage(e));
        return null;
      }
    },
    [navigate, location],
  );

  const reload = useCallback(async () => {
    setEntries(await vault.listItems());
    setNow(new Date());
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    run(reload).finally(() => setLoading(false));
  }, []);

  const save = useCallback(
    (id: string | null, draft: Draft) =>
      run(async () => {
        // A name is unique: saving under an existing name overwrites that item, like `kf set`.
        const edited = entries.find((e) => e.id === id) ?? null;
        const target = entries.find((e) => e.item.name === draft.name) ?? edited;
        const stamp = new Date().toISOString();
        // The fields the form does not edit (username, URLs...) come from the
        // item being edited, even when its new name overwrites another item.
        const base = edited?.item ?? target?.item;
        const merged = {
          ...base,
          ...compact(draft),
          value: base?.value ?? "",
          v: vault.ITEM_VERSION,
          created_at: base ? vault.createdAt(base) : stamp,
          updated_at: stamp,
        } as vault.Item;
        // A changed value goes to the history first.
        const saved = await vault.saveItem(target, vault.withValue(merged, draft.value, stamp));
        // Renaming an item onto another one's name replaced that other item: drop
        // the old copy, but not the attachments the new one carries over.
        const kept = draft.attachments.map((a) => a.id);
        // The item is stored now: a failed cleanup is reported, it does not fail
        // the save (the form would then delete the attachments it just uploaded).
        try {
          if (edited && saved !== edited.id) await vault.deleteItem(edited, kept);
          // An item replaced under its name (by a rename or a new item) leaves
          // attachments listed nowhere any more.
          if (target && target.id !== edited?.id) {
            for (const a of target.item.attachments ?? []) if (!kept.includes(a.id)) await vault.deleteAttachment(a.id);
          }
        } catch (e) {
          if (e instanceof vault.LockedError) throw e;
          setError(`Enregistré, mais l'ancienne copie n'a pas pu être supprimée : ${errorMessage(e)}`);
        }
        await reload();
        return saved;
      }),
    [entries, run, reload],
  );

  const remove = useCallback(
    async (id: string) =>
      (await run(async () => {
        const entry = entries.find((e) => e.id === id);
        if (entry) await vault.deleteItem(entry);
        await reload();
        return true;
      })) ?? false,
    [entries, run, reload],
  );

  const attach = useCallback(
    (file: File) => run(async () => vault.uploadAttachment(file.name, new Uint8Array(await file.arrayBuffer()))),
    [run],
  );

  const download = useCallback(
    async (ref: vault.BlobRef) => {
      const data = await run(() => vault.downloadAttachment(ref));
      if (!data) return;
      const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>]));
      const a = document.createElement("a");
      a.href = url;
      a.download = ref.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    [run],
  );

  const lock = useCallback(async () => {
    await vault.lock();
    navigate("/personal/unlock", { replace: true });
  }, [navigate]);

  const flags = useMemo(() => flaggedIds(entries, now), [entries, now]);
  const oldFormat = useMemo(() => entries.filter((e) => e.oldFormat).length, [entries]);

  const value = useMemo(
    () => ({ entries, oldFormat, loading, error, now, flags, save, remove, attach, download, lock }),
    [entries, oldFormat, loading, error, now, flags, save, remove, attach, download, lock],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
