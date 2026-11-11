import { LoaderCircle } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { type Location, Navigate, useLocation, useNavigate } from "react-router";
import { TotpSetup } from "@/components/totp-setup";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/labels";
import * as vault from "@/vault";

/** First run creates the vault; later runs unlock it. Then returns to the page that sent us here. */
export function UnlockPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const from = (location.state as { from?: Location } | null)?.from;
  const target = from ? `${from.pathname}${from.search}` : "/personal/dashboard";
  const [status, setStatus] = useState<vault.Status | null>(null);
  // Onboarding: once the vault is created, offer TOTP before going on.
  const [offerTotp, setOfferTotp] = useState(false);
  const [error, setError] = useState("");
  const done = () => navigate(target, { replace: true });

  useEffect(() => {
    vault
      .status()
      .then(setStatus)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  if (vault.isUnlocked() && !offerTotp) return <Navigate to={target} replace />;

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-6">
      <div className="flex items-center gap-2 font-semibold">
        <img src="/brand/logo-tile.png" alt="" className="size-8" />
        Keyfold
      </div>
      <Card className="w-full max-w-sm">
        {offerTotp ? (
          <>
            <CardHeader>
              <CardTitle>Double authentification</CardTitle>
              <CardDescription>
                Facultatif. Avec elle, le coffre demande aussi un code à usage unique pour s'ouvrir.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TotpSetup onDone={done} onSkip={done} />
            </CardContent>
          </>
        ) : status === null ? (
          <CardContent className="flex flex-col gap-3">
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : (
              <>
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-8 w-full" />
              </>
            )}
          </CardContent>
        ) : (
          <PasswordForm
            first={!status.initialized}
            totp={status.totp}
            onDone={() => (status.initialized ? done() : setOfferTotp(true))}
          />
        )}
      </Card>
      <p className="max-w-sm text-center text-xs text-muted-foreground">
        Le mot de passe principal ne quitte jamais ce navigateur. Recharger la page verrouille le coffre.
      </p>
    </main>
  );
}

function PasswordForm({ first, totp, onDone }: { first: boolean; totp: boolean; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (first && password !== confirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    try {
      await (first ? vault.create(password) : vault.unlock(password, code.trim()));
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <CardHeader>
        <CardTitle>{first ? "Créer le coffre" : "Déverrouiller le coffre"}</CardTitle>
        <CardDescription>
          {first
            ? `Choisissez le mot de passe principal, ${vault.MIN_MASTER_PASSWORD_LENGTH} caractères au moins. Il ne peut pas être récupéré.`
            : "Saisissez le mot de passe principal."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Mot de passe principal</Label>
            <Input
              id="password"
              type="password"
              autoComplete={first ? "new-password" : "current-password"}
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {first && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm">Confirmation</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          )}
          {!first && totp && !vault.hasDownloadedIdentity() && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">Code de double authentification</Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="font-mono tracking-[0.3em]"
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {busy && <LoaderCircle className="animate-spin" />}
            {busy ? "Déchiffrement…" : first ? "Créer le coffre" : "Déverrouiller"}
          </Button>
        </form>
      </CardContent>
    </>
  );
}
