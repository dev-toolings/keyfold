import { Copy, KeyRound, LoaderCircle, Trash } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/labels";
import * as vault from "@/vault";
import { useVault } from "@/vault-context";

const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

export function AiPage() {
  return (
    <div className="mx-auto container flex max-w-2xl flex-col gap-4">
      <DepositsCard />
      <DepositKeysCard />
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Accès complet (coffre déverrouillé)</h2>
          </CardTitle>
          <CardDescription>
            Ce mode ajoute l'outil <code>vault_health</code> et vérifie les doublons de valeur à l'import, mais il lit
            le coffre : déverrouillez-le avec <code>"/chemin/vers/kf" unlock</code> avant chaque session. Remplacez{" "}
            <code>/chemin/vers/kf</code> par le chemin absolu du binaire.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
            <code>{'claude mcp add --transport stdio keyfold -- "/chemin/vers/kf" mcp'}</code>
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

/** Deposits whose name already holds another value: the owner decides, the agent never does. */
function DepositsCard() {
  const { depositConflicts, depositsAdded, resolveDeposit, error } = useVault();
  const [busy, setBusy] = useState<string | null>(null);
  if (depositConflicts.length === 0 && depositsAdded.length === 0) return null;

  async function choose(conflict: vault.DepositConflict, choice: vault.DepositChoice) {
    setBusy(`${conflict.keyId}/${conflict.id}`);
    await resolveDeposit(conflict, choice);
    setBusy(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Dépôts des agents</h2>
        </CardTitle>
        <CardDescription>
          {depositsAdded.length > 0 && (
            <span role="status" className="block wrap-anywhere">
              Ajoutés à l'ouverture du coffre : {depositsAdded.join(", ")}.
            </span>
          )}
          {depositConflicts.length > 0 &&
            "Ces dépôts portent le nom d'un élément qui a une autre valeur. Un agent ou une clé volée peut tenter de remplacer un vrai secret : vérifiez avant de remplacer."}
        </CardDescription>
      </CardHeader>
      {depositConflicts.length > 0 && (
        <CardContent className="grid gap-3">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <ul className="grid gap-3">
            {depositConflicts.map((c) => {
              const key = `${c.keyId}/${c.id}`;
              return (
                <li key={key} className="grid gap-3 rounded-lg border p-3">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium wrap-anywhere">{c.item.name}</p>
                    <p className="text-muted-foreground wrap-anywhere">
                      Déposé par la clé « {c.keyName} », le {dateFormat.format(new Date(c.created))}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="outline" disabled={busy === key}>
                          Remplacer la valeur
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle className="wrap-anywhere">
                            Remplacer la valeur de « {c.item.name} » ?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            La valeur déposée par « {c.keyName} » devient la valeur courante. L'ancienne reste dans
                            l'historique de l'élément.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Annuler</AlertDialogCancel>
                          <AlertDialogAction onClick={() => choose(c, "replace")}>Remplacer</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <Button size="sm" variant="outline" disabled={busy === key} onClick={() => choose(c, "keep-both")}>
                      Garder les deux
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy === key} onClick={() => choose(c, "reject")}>
                      {busy === key && <LoaderCircle aria-hidden="true" className="animate-spin" />}
                      Refuser
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

/** Keys that let an agent deposit items and list names without unlocking the vault. */
function DepositKeysCard() {
  const notify = useToast();
  const [keys, setKeys] = useState<vault.DepositKeyInfo[] | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; value: string } | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      setKeys(await vault.depositKeys());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Donnez un nom à la clé, par exemple « Claude Code PC ».");
      e.currentTarget.querySelector<HTMLInputElement>("#deposit-key-name")?.focus();
      return;
    }
    setNameError("");
    setBusy(true);
    setError("");
    try {
      const value = await vault.createDepositKey(trimmed);
      setCreated({ name: trimmed, value });
      setName("");
      // The agent can list names right away, from a fresh listing: another
      // client may have changed the vault since this page loaded.
      await vault.refreshCatalogs((await vault.listItems()).entries);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(key: vault.DepositKeyInfo) {
    setError("");
    try {
      await vault.revokeDepositKey(key.id);
      notify("success", `Clé « ${key.name} » révoquée.`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const command =
    created &&
    `claude mcp add keyfold -s user -e KEYFOLD_SERVER=${window.location.origin} -e KEYFOLD_DEPOSIT_KEY=${created.value} -- "/chemin/vers/kf" mcp -deposit`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Clés de dépôt</h2>
        </CardTitle>
        <CardDescription>
          Une clé de dépôt laisse un agent IA (<code>kf mcp -deposit</code>) ajouter des secrets et lister les noms,
          sans déverrouiller le coffre. Elle ne peut lire aucune valeur. Ses dépôts entrent dans le coffre à votre
          prochaine ouverture : un nouveau nom est ajouté, un nom déjà pris attend votre choix ci-dessus.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {created && command && (
          <div role="status" className="grid gap-2 rounded-lg border p-3">
            <p className="text-sm font-medium wrap-anywhere">
              Clé « {created.name} » créée. Copiez-la maintenant : elle ne sera plus affichée.
            </p>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
              <code>{command}</code>
            </pre>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(command);
                  notify("success", "Commande copiée.");
                }}
              >
                <Copy aria-hidden="true" />
                Copier la commande
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                J'ai copié la clé
              </Button>
            </div>
          </div>
        )}
        {keys === null ? (
          error ? null : (
            <Skeleton className="h-16" />
          )
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune clé de dépôt.</p>
        ) : (
          <ul className="grid gap-2">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="flex min-w-0 items-center gap-2.5 text-sm">
                  <KeyRound aria-hidden="true" className="size-4 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium wrap-anywhere">{k.name}</p>
                    <p className="text-muted-foreground">Créée le {dateFormat.format(new Date(k.created))}</p>
                  </div>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="ghost" aria-label={`Révoquer la clé ${k.name}`}>
                      <Trash aria-hidden="true" />
                      Révoquer
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="wrap-anywhere">Révoquer « {k.name} » ?</AlertDialogTitle>
                      <AlertDialogDescription>
                        L'agent qui l'utilise ne peut plus déposer ni lister. Ses dépôts en attente sont supprimés.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annuler</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={() => revoke(k)}>
                        Révoquer
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </li>
            ))}
          </ul>
        )}
        <form noValidate onSubmit={create} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Label htmlFor="deposit-key-name">Nom de la nouvelle clé</Label>
            <Input
              id="deposit-key-name"
              maxLength={64}
              autoComplete="off"
              aria-invalid={!!nameError}
              aria-describedby={nameError ? "deposit-key-name-error" : undefined}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <FieldError id="deposit-key-name" error={nameError} />
          </div>
          <Button type="submit" size="sm" disabled={busy}>
            {busy && <LoaderCircle aria-hidden="true" className="animate-spin" />}
            Créer la clé
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
