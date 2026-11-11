import { LoaderCircle, QrCode } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/labels";
import * as vault from "@/vault";

/** Turns TOTP on: shows a QR code, then waits for a first valid code. Used at onboarding and in the settings. */
export function TotpSetup({ onDone, onSkip }: { onDone: () => void; onSkip?: () => void }) {
  const [setup, setSetup] = useState<vault.TotpSetup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      setSetup(await vault.totpSetup());
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  }

  if (!setup) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Une application comme Aegis, 2FAS ou Google Authenticator donnera un code à chaque déverrouillage.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={start} disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin" /> : <QrCode />}
            Afficher le QR code
          </Button>
          {onSkip && (
            <Button type="button" variant="ghost" onClick={onSkip}>
              Plus tard
            </Button>
          )}
        </div>
      </div>
    );
  }

  return <ConfirmCode setup={setup} onDone={onDone} onSkip={onSkip} />;
}

function ConfirmCode({ setup, onDone, onSkip }: { setup: vault.TotpSetup; onDone: () => void; onSkip?: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await vault.totpEnable(code.trim());
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <img
        src={setup.qr}
        alt="QR code à scanner avec l'application d'authentification"
        className="size-44 self-center rounded-lg border bg-white p-2"
      />
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Saisie manuelle</summary>
        <code className="mt-2 block font-mono break-all select-all">{setup.secret}</code>
      </details>
      <div className="flex flex-col gap-2">
        <Label htmlFor="totp-confirm">Code affiché par l'application</Label>
        <Input
          id="totp-confirm"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="font-mono tracking-[0.3em]"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy && <LoaderCircle className="animate-spin" />}
          Activer
        </Button>
        {onSkip && (
          <Button type="button" variant="ghost" onClick={onSkip}>
            Plus tard
          </Button>
        )}
      </div>
    </form>
  );
}
