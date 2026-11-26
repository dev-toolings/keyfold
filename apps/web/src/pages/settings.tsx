import { LoaderCircle, ShieldCheck, ShieldOff } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { z } from "zod";
import { Badge } from "@/components/reui/badge";
import { TotpSetup } from "@/components/totp-setup";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError, focusFirstInvalidField } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { newMasterPasswordSchema, totpCodeSchema } from "@/lib/form-validation";
import { errorMessage } from "@/lib/labels";
import { hibpEnabled, setHibpEnabled } from "@/lib/preferences";
import * as vault from "@/vault";

const passwordSchema = z
  .object({
    current: z.string().min(1, "Saisissez le mot de passe actuel."),
    next: newMasterPasswordSchema,
    confirm: z.string().min(1, "Confirmez le nouveau mot de passe."),
    code: totpCodeSchema.optional(),
  })
  .refine(({ next, confirm }) => next === confirm, {
    path: ["confirm"],
    message: "Les nouveaux mots de passe ne correspondent pas.",
  });

/** Master password and TOTP. Reached from the bottom of the sidebar. */
export function SettingsPage() {
  const [totp, setTotp] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    vault
      .status()
      .then((s) => setTotp(s.totp))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  return (
    <div className="mx-auto container flex max-w-2xl flex-col gap-4">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {totp === null ? (
        <div className="grid gap-4">
          <Skeleton className="h-56" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <div className="grid gap-4">
          <PasswordCard totp={totp} />
          <TotpCard totp={totp} onChange={setTotp} />
          <HibpCard />
        </div>
      )}
    </div>
  );
}

function CodeField({
  id,
  value,
  error,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  error?: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} isRequired>
        Code de double authentification
      </Label>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-required="true"
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-40 font-mono tracking-[0.3em]"
      />
      <FieldError id={id} error={error} />
    </div>
  );
}

function PasswordCard({ totp }: { totp: boolean }) {
  const notify = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof z.input<typeof passwordSchema>, string[]>>>({});

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = passwordSchema.safeParse({ current, next, confirm, code: totp ? code : undefined });
    if (!result.success) {
      setFieldErrors(z.flattenError(result.error).fieldErrors);
      focusFirstInvalidField(e.currentTarget);
      notify("error", "Corrigez les champs signalés.");
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      await vault.changePassword(result.data.current, result.data.next, result.data.code);
      setCurrent("");
      setNext("");
      setConfirm("");
      setCode("");
      notify("success", "Mot de passe principal changé.");
    } catch (err) {
      notify("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
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
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="current" isRequired>
              Mot de passe actuel
            </Label>
            <PasswordInput
              id="current"
              label="le mot de passe actuel"
              autoComplete="current-password"
              aria-required="true"
              disabled={busy}
              aria-invalid={!!fieldErrors.current}
              aria-describedby={fieldErrors.current ? "current-error" : undefined}
              value={current}
              onChange={(e) => {
                setCurrent(e.target.value);
                setFieldErrors((errors) => ({ ...errors, current: undefined }));
              }}
            />
            <FieldError id="current" error={fieldErrors.current?.[0]} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="next" isRequired>
                Nouveau mot de passe
              </Label>
              <PasswordInput
                id="next"
                label="le nouveau mot de passe"
                autoComplete="new-password"
                aria-required="true"
                disabled={busy}
                aria-invalid={!!fieldErrors.next}
                aria-describedby={fieldErrors.next ? "next-hint next-error" : "next-hint"}
                value={next}
                onChange={(e) => {
                  setNext(e.target.value);
                  setFieldErrors((errors) => ({ ...errors, next: undefined, confirm: undefined }));
                }}
              />
              <FieldError id="next" error={fieldErrors.next?.[0]} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="next-confirm" isRequired>
                Confirmation
              </Label>
              <PasswordInput
                id="next-confirm"
                label="la confirmation du nouveau mot de passe"
                autoComplete="new-password"
                aria-required="true"
                disabled={busy}
                aria-invalid={!!fieldErrors.confirm}
                aria-describedby={fieldErrors.confirm ? "next-confirm-error" : undefined}
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setFieldErrors((errors) => ({ ...errors, confirm: undefined }));
                }}
              />
              <FieldError id="next-confirm" error={fieldErrors.confirm?.[0]} />
            </div>
          </div>
          <p id="next-hint" className="text-xs text-muted-foreground">
            {vault.MIN_MASTER_PASSWORD_LENGTH} caractères au moins.
          </p>
          {totp && (
            <CodeField
              id="password-code"
              value={code}
              error={fieldErrors.code?.[0]}
              disabled={busy}
              onChange={(value) => {
                setCode(value);
                setFieldErrors((errors) => ({ ...errors, code: undefined }));
              }}
            />
          )}
          <Button type="submit" disabled={busy} className="self-end">
            {busy && <LoaderCircle className="animate-spin" />}
            Changer le mot de passe
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function TotpCard({ totp, onChange }: { totp: boolean; onChange: (enabled: boolean) => void }) {
  const notify = useToast();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function disable(e: FormEvent<HTMLFormElement>) {
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
      await vault.totpDisable(result.data);
      setCode("");
      notify("success", "Double authentification désactivée.");
      onChange(false);
    } catch (err) {
      notify("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
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
          <form noValidate onSubmit={disable} className="flex flex-col gap-4">
            <CodeField
              id="disable-code"
              value={code}
              error={error}
              disabled={busy}
              onChange={(value) => {
                setCode(value);
                setError("");
              }}
            />
            <Button type="submit" variant="destructive" disabled={busy} className="self-end">
              {busy && <LoaderCircle className="animate-spin" />}
              Désactiver
            </Button>
          </form>
        ) : (
          <TotpSetup onDone={() => onChange(true)} />
        )}
      </CardContent>
    </Card>
  );
}

/** Opt-in check of passwords against Have I Been Pwned, off by default. */
function HibpCard() {
  const [on, setOn] = useState(hibpEnabled);
  const notify = useToast();
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
        <div className="flex items-center gap-2">
          <Checkbox
            id="hibp-enabled"
            checked={on}
            onCheckedChange={(checked) => {
              const enabled = checked === true;
              try {
                setHibpEnabled(enabled);
                setOn(enabled);
                notify("success", enabled ? "Vérification des fuites activée." : "Vérification des fuites désactivée.");
              } catch {
                notify("error", "Impossible d’enregistrer la préférence de vérification des fuites.");
              }
            }}
          />
          <Label htmlFor="hibp-enabled" className="cursor-pointer py-2">
            Autoriser la vérification des fuites connues
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}
