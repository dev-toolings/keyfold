import { LoaderCircle, QrCode } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, focusFirstInvalidField } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { totpCodeSchema } from "@/lib/form-validation";
import { errorMessage } from "@/lib/labels";
import * as vault from "@/vault";

/** Turns TOTP on: shows a QR code, then waits for a first valid code. Used at onboarding and in the settings. */
export function TotpSetup({ onDone, onSkip }: { onDone: () => void; onSkip?: () => void }) {
  const notify = useToast();
  const [setup, setSetup] = useState<vault.TotpSetup | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      setSetup(await vault.totpSetup());
    } catch (err) {
      notify("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!setup) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Une application comme Aegis, 2FAS ou Google Authenticator donnera un code à chaque déverrouillage.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          {onSkip && (
            <Button type="button" variant="ghost" onClick={onSkip}>
              Plus tard
            </Button>
          )}
          <Button type="button" onClick={start} disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin" /> : <QrCode />}
            Afficher le QR code
          </Button>
        </div>
      </div>
    );
  }

  return <ConfirmCode setup={setup} onDone={onDone} onSkip={onSkip} />;
}

function ConfirmCode({ setup, onDone, onSkip }: { setup: vault.TotpSetup; onDone: () => void; onSkip?: () => void }) {
  const notify = useToast();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = totpCodeSchema.safeParse(code);
    if (!result.success) {
      setError(result.error.issues[0].message);
      focusFirstInvalidField(e.currentTarget);
      notify("error", "Corrigez le code de double authentification.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await vault.totpEnable(result.data);
      notify("success", "Double authentification activée.");
      onDone();
    } catch (err) {
      notify("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
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
        <Label htmlFor="totp-confirm" isRequired>
          Code affiché par l'application
        </Label>
        <Input
          id="totp-confirm"
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-required="true"
          disabled={busy}
          aria-invalid={!!error}
          aria-describedby={error ? "totp-confirm-error" : undefined}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError("");
          }}
          className="font-mono tracking-[0.3em]"
        />
        <FieldError id="totp-confirm" error={error} />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {onSkip && (
          <Button type="button" variant="ghost" onClick={onSkip}>
            Plus tard
          </Button>
        )}
        <Button type="submit" disabled={busy}>
          {busy && <LoaderCircle className="animate-spin" />}
          Activer
        </Button>
      </div>
    </form>
  );
}
