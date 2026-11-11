import { LoaderCircle, ShieldCheck, ShieldOff } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/reui/badge";
import { TotpSetup } from "@/components/totp-setup";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/labels";
import { hibpEnabled, setHibpEnabled } from "@/lib/preferences";
import * as vault from "@/vault";

/** Master password and TOTP. Reached from the bottom of the sidebar. */
export function SettingsPage() {
  const [totp, setTotp] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(() => {
    vault
      .status()
      .then((s) => setTotp(s.totp))
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(refresh, [refresh]);

  return (
    <>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Paramètres</h2>
        <p className="text-sm text-muted-foreground">Accès au coffre et vérifications.</p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {totp === null ? (
        <div className="grid max-w-2xl gap-4">
          <Skeleton className="h-56" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <div className="grid max-w-2xl gap-4">
          <PasswordCard totp={totp} />
          <TotpCard totp={totp} onChange={refresh} />
          <HibpCard />
        </div>
      )}
    </>
  );
}

function CodeField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Code de double authentification</Label>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-40 font-mono tracking-[0.3em]"
      />
    </div>
  );
}

function PasswordCard({ totp }: { totp: boolean }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setDone(false);
    if (next !== confirm) {
      setError("Les nouveaux mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    try {
      await vault.changePassword(current, next, totp ? code.trim() : undefined);
      setCurrent("");
      setNext("");
      setConfirm("");
      setCode("");
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mot de passe principal</CardTitle>
        <CardDescription>
          Les éléments ne sont pas rechiffrés : seule l'identité du coffre l'est, avec le nouveau mot de passe. Une
          ancienne copie du dossier de données s'ouvre toujours avec l'ancien.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="current">Mot de passe actuel</Label>
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="next">Nouveau mot de passe</Label>
              <Input
                id="next"
                type="password"
                autoComplete="new-password"
                required
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="next-confirm">Confirmation</Label>
              <Input
                id="next-confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{vault.MIN_MASTER_PASSWORD_LENGTH} caractères au moins.</p>
          {totp && <CodeField id="password-code" value={code} onChange={setCode} />}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {done && (
            <p role="status" className="text-sm text-muted-foreground">
              Mot de passe principal changé.
            </p>
          )}
          <Button type="submit" disabled={busy} className="self-start">
            {busy && <LoaderCircle className="animate-spin" />}
            Changer le mot de passe
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function TotpCard({ totp, onChange }: { totp: boolean; onChange: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function disable(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await vault.totpDisable(code.trim());
      setCode("");
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Double authentification</CardTitle>
          {totp ? (
            <Badge variant="success-light">
              <ShieldCheck />
              Active
            </Badge>
          ) : (
            <Badge variant="outline">
              <ShieldOff />
              Inactive
            </Badge>
          )}
        </div>
        <CardDescription>
          Un code à usage unique, en plus du mot de passe, pour ouvrir le coffre dans le navigateur et avec kf unlock.
          Téléphone perdu : keyfold-server -disable-totp sur la machine du serveur.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {totp ? (
          <form onSubmit={disable} className="flex flex-col gap-4">
            <CodeField id="disable-code" value={code} onChange={setCode} />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" variant="destructive" disabled={busy} className="self-start">
              {busy && <LoaderCircle className="animate-spin" />}
              Désactiver
            </Button>
          </form>
        ) : (
          <TotpSetup onDone={onChange} />
        )}
      </CardContent>
    </Card>
  );
}

/** Opt-in check of passwords against Have I Been Pwned, off by default. */
function HibpCard() {
  const [on, setOn] = useState(hibpEnabled);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fuites connues (Have I Been Pwned)</CardTitle>
        <CardDescription>
          Le tableau de bord peut comparer vos mots de passe aux fuites publiées. Pour chacun, ce navigateur envoie à
          api.pwnedpasswords.com les 5 premiers caractères de son empreinte SHA-1, jamais le mot de passe : le service
          voit votre adresse IP et ces préfixes. Désactivé par défaut.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={on}
            onChange={(e) => {
              setHibpEnabled(e.target.checked);
              setOn(e.target.checked);
            }}
          />
          Autoriser la vérification des fuites connues
        </label>
      </CardContent>
    </Card>
  );
}
