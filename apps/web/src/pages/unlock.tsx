import { ArrowLeft, ArrowRight, Check, KeyRound, LoaderCircle, ShieldCheck, Terminal } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { type Location, Navigate, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import { TotpSetup } from "@/components/totp-setup";
import { Button } from "@/components/ui/button";
import { FieldError, focusFirstInvalidField } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Skeleton } from "@/components/ui/skeleton";
import { createVaultSchema, unlockVaultSchema } from "@/lib/form-validation";
import { errorMessage } from "@/lib/labels";
import * as vault from "@/vault";
import "./unlock.css";

const rainStreams = [
  "701A5C32E916AF42",
  "2F9C04D8B0176EA1",
  "CE0214F75B6D80A3",
  "43A6F1B805C9ED20",
  "9B7E40AC2D531F68",
  "F51C309AB4D812E7",
  "0D8E2F625CA3B419",
  "B628EC5043F1A709",
  "65DAC9140E7B2F83",
  "8A100C7ED431625F",
  "D7CF39018A56B24E",
  "1B4D8536FE20C7A9",
  "ACF81D54970E326B",
  "5369BE1C2F87D04A",
  "E37A05F29CB164D8",
  "0625FA8E3C4709BD",
  "41F79CB0E25DA386",
  "79C3BD6580A142EF",
  "C9E54A102F8D63B7",
  "37DA60F4B5C21E89",
  "E51632C9D78FA04B",
  "7481EC30A59FB26D",
  "30BC7D2F14E856A9",
  "FA902BE7584D3C16",
];

const tunnelCommand = "ssh -N -L 127.0.0.1:18717:127.0.0.1:8717 utilisateur@serveur";
const tunnelUrl = "http://127.0.0.1:18717/personal/unlock?setup=totp";

/** First run creates the vault; later runs unlock it. Then returns to the page that sent us here. */
export function UnlockPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const from = (location.state as { from?: Location } | null)?.from;
  const target = from ? `${from.pathname}${from.search}` : "/personal/dashboard";
  const [status, setStatus] = useState<vault.Status | null>(null);
  const [offerTotp, setOfferTotp] = useState(false);
  const [requiresServerAccess, setRequiresServerAccess] = useState(
    () => !vault.isLoopbackHost(window.location.hostname),
  );
  const [useInstallToken, setUseInstallToken] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const done = () => navigate(target, { replace: true });

  const refreshStatus = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      const next = await vault.status();
      setStatus(next);
      return next;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const first = status?.initialized === false;
  const completeFromServer =
    !requiresServerAccess && !status?.totp && new URLSearchParams(location.search).get("setup") === "totp";
  const showServerGuide = !!status && requiresServerAccess && (first ? !useInstallToken : !status.totp);
  const setupSteps = requiresServerAccess
    ? ["Accéder au serveur", "Créer le coffre", "Protéger l’accès"]
    : ["Créer le coffre", "Protéger l’accès"];
  const setupStep =
    offerTotp || (!first && (showServerGuide || completeFromServer))
      ? setupSteps.length - 1
      : showServerGuide
        ? 0
        : setupSteps.length - 2;
  const showSetup = !!status && (offerTotp || first || showServerGuide || completeFromServer);
  const screen = status && `${first}/${showServerGuide}/${offerTotp}`;
  const previousScreen = useRef(screen);
  useEffect(() => {
    if (previousScreen.current && previousScreen.current !== screen) {
      contentRef.current?.querySelector("h1")?.focus();
    }
    previousScreen.current = screen;
  }, [screen]);

  if (vault.isUnlocked() && !offerTotp) return <Navigate to={target} replace />;

  return (
    <main className="unlock-layout min-h-svh bg-background">
      <title>{`${first ? "Créer le coffre" : "Déverrouiller le coffre"} · Keyfold`}</title>
      <meta
        name="description"
        content="Créez ou déverrouillez votre coffre Keyfold. Le mot de passe reste dans ce navigateur."
      />
      <div className="unlock-main min-w-0">
        <div className="unlock-content" ref={contentRef}>
          <div className="unlock-brand flex items-center gap-3 font-semibold">
            <img src="/brand/logo-tile.png" alt="" width={32} height={32} className="size-8" />
            Keyfold
          </div>

          {showSetup && (
            <p className="unlock-step-indicator text-sm font-medium text-muted-foreground">
              Étape {setupStep + 1} sur {setupSteps.length}
            </p>
          )}

          {offerTotp ? (
            <section className="grid gap-5">
              <header className="unlock-heading">
                <h1 tabIndex={-1}>Protégez l’accès au coffre</h1>
                <p>Activez la double authentification pour ouvrir le coffre depuis un autre appareil.</p>
              </header>
              <TotpSetup onDone={done} onSkip={completeFromServer ? undefined : done} />
            </section>
          ) : status ? (
            <PasswordForm
              first={first}
              totp={status.totp}
              showInstallToken={first && requiresServerAccess && useInstallToken}
              showServerGuide={showServerGuide}
              refreshing={refreshing}
              statusError={error}
              onUseInstallToken={() => setUseInstallToken(true)}
              onUseServerAccess={() => setUseInstallToken(false)}
              onInstallTokenRequired={() => setRequiresServerAccess(true)}
              onDone={() => (first || completeFromServer ? setOfferTotp(true) : done())}
              refreshStatus={refreshStatus}
            />
          ) : error ? (
            <div className="grid gap-4" role="alert">
              <header className="unlock-heading">
                <h1 tabIndex={-1}>Coffre indisponible</h1>
              </header>
              <p className="text-sm leading-relaxed text-destructive">{error}</p>
              <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={refreshStatus}>
                Réessayer
              </Button>
            </div>
          ) : (
            <div className="grid gap-3" role="status" aria-label="Chargement du coffre">
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="mt-3 h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          <div className="mt-6 flex items-start gap-2.5 border-t border-border pt-4 text-sm/5 text-muted-foreground">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p>Votre mot de passe reste dans ce navigateur.</p>
          </div>
        </div>
      </div>
      <aside
        aria-hidden={showSetup ? undefined : true}
        className="unlock-aside relative min-w-0 overflow-hidden"
        onPointerMove={(event) => {
          if (event.pointerType !== "mouse") return;
          const panel = event.currentTarget;
          const { left, top } = panel.getBoundingClientRect();
          panel.style.setProperty("--unlock-pointer-x", `${event.clientX - left}px`);
          panel.style.setProperty("--unlock-pointer-y", `${event.clientY - top}px`);
          panel.setAttribute("data-pointer-active", "");
        }}
        onPointerLeave={(event) => event.currentTarget.removeAttribute("data-pointer-active")}
      >
        <div aria-hidden="true" className="unlock-dot-field pointer-events-none absolute inset-0">
          <div className="unlock-rain absolute inset-0">
            {rainStreams.map((code, index) => (
              <span
                key={code}
                className="unlock-rain-stream"
                style={{
                  animationDuration: `${4900 + ((index * 733) % 4600)}ms`,
                  animationDelay: `-${(index * 971) % 7200}ms`,
                  transform: `translateY(${(index * 29) % 68}%)`,
                }}
              >
                <span className="unlock-rain-trail">
                  {code.slice(0, -1)}
                  <span className="unlock-rain-head">{code.at(-1)}</span>
                </span>
              </span>
            ))}
          </div>
        </div>
        <div aria-hidden="true" className="unlock-dot-highlight pointer-events-none absolute inset-0" />
        <div className="unlock-aside-content">
          <div className="unlock-key" aria-hidden="true">
            <KeyRound className="size-12" strokeWidth={1.4} />
          </div>
          {showSetup && (
            <ol aria-label="Étapes de configuration" className="unlock-steps">
              {setupSteps.map((label, index) => (
                <li key={label} aria-current={index === setupStep ? "step" : undefined}>
                  <span aria-hidden="true" className="unlock-step-number">
                    {index < setupStep ? <Check className="size-4" /> : index + 1}
                  </span>
                  {label}
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </main>
  );
}

function ServerAccessGuide({
  first,
  refreshing,
  error,
  onUseInstallToken,
  refreshStatus,
}: {
  first: boolean;
  refreshing: boolean;
  error: string;
  onUseInstallToken: () => void;
  refreshStatus: () => Promise<vault.Status | null>;
}) {
  const [notReady, setNotReady] = useState(false);

  async function checkSetup() {
    setNotReady(false);
    const result = await refreshStatus();
    setNotReady(!!result && !result.totp);
  }

  return (
    <section className="grid min-w-0 gap-5">
      <header className="unlock-heading">
        <h1 tabIndex={-1}>{first ? "Accédez au serveur" : "Activez l’accès distant"}</h1>
        <p>
          {first
            ? "Utilisez SSH pour configurer ce coffre."
            : "Activez la double authentification sur une connexion locale."}
        </p>
      </header>
      <div className="unlock-access grid min-w-0 gap-4 rounded-2xl border p-4 sm:p-5">
        <div className="flex items-center gap-2.5 font-medium">
          <Terminal aria-hidden="true" className="size-5 shrink-0" />
          Configurer avec un tunnel SSH
        </div>
        <ol className="grid list-decimal gap-4 pl-5 text-sm/6 text-muted-foreground">
          <li className="min-w-0">
            <p>Dans votre terminal, adaptez le compte et l’adresse du serveur.</p>
            <code className="mt-2 block rounded-lg border bg-background px-3 py-2 font-mono text-xs/5 text-foreground [overflow-wrap:anywhere]">
              {tunnelCommand}
            </code>
          </li>
          <li>
            {first
              ? "Laissez le terminal ouvert, puis créez le coffre dans cet onglet local."
              : "Laissez le terminal ouvert, puis ouvrez le coffre pour activer le second facteur."}
          </li>
        </ol>
        <Button asChild variant="outline" size="sm" className="w-full sm:w-fit">
          <a href={tunnelUrl} target="_blank" rel="noreferrer">
            Ouvrir Keyfold en local <ArrowRight aria-hidden="true" />
          </a>
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notReady && (
        <p role="status" className="text-sm text-muted-foreground">
          {first ? "Le coffre n’est pas encore créé." : "La double authentification est encore désactivée."}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={first ? "ghost" : "outline"}
          size="sm"
          disabled={refreshing}
          onClick={checkSetup}
        >
          {refreshing && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {first ? "J’ai terminé la configuration" : "Vérifier l’activation"}
        </Button>
        {first && (
          <Button type="button" variant="ghost" size="sm" onClick={onUseInstallToken}>
            J’ai déjà un jeton
          </Button>
        )}
      </div>
    </section>
  );
}

function PasswordForm({
  first,
  totp,
  showInstallToken,
  showServerGuide,
  refreshing,
  statusError,
  onUseInstallToken,
  onUseServerAccess,
  onInstallTokenRequired,
  onDone,
  refreshStatus,
}: {
  first: boolean;
  totp: boolean;
  showInstallToken: boolean;
  showServerGuide: boolean;
  refreshing: boolean;
  statusError: string;
  onUseInstallToken: () => void;
  onUseServerAccess: () => void;
  onInstallTokenRequired: () => void;
  onDone: () => void;
  refreshStatus: () => Promise<vault.Status | null>;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [installToken, setInstallToken] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showFieldErrors, setShowFieldErrors] = useState(false);
  const showTotpCode = !first && totp && !vault.hasDownloadedIdentity();
  const validate = () =>
    first
      ? createVaultSchema.safeParse({ password, confirm, installToken })
      : unlockVaultSchema.safeParse({ password, code: showTotpCode ? code : undefined });
  const validation = showFieldErrors ? validate() : undefined;
  const fieldErrors =
    validation && !validation.success
      ? z.flattenError<{ password: string; confirm?: string; code?: string }>(validation.error).fieldErrors
      : undefined;
  const passwordError = fieldErrors?.password?.[0];
  const confirmError = fieldErrors?.confirm?.[0];
  const codeError = fieldErrors?.code?.[0];
  const installTokenError =
    showFieldErrors && showInstallToken && !installToken.trim() ? "Saisissez votre jeton d’installation." : undefined;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const result = validation ?? validate();
    if (!result.success || (showInstallToken && !installToken.trim())) {
      setShowFieldErrors(true);
      focusFirstInvalidField(e.currentTarget);
      return;
    }
    setShowFieldErrors(false);
    setBusy(true);
    try {
      const fields = result.data;
      if ("installToken" in fields) await vault.create(fields.password, fields.installToken);
      else await vault.unlock(fields.password, fields.code);
      onDone();
    } catch (err) {
      const message = errorMessage(err);
      const needsLocalTotp = message === "Enable the second factor on the server machine first";
      if (err instanceof vault.InstallTokenError || needsLocalTotp) {
        onInstallTokenRequired();
      }
      setError(needsLocalTotp ? "" : message);
      await refreshStatus();
      setBusy(false);
    }
  }

  if (showServerGuide) {
    return (
      <ServerAccessGuide
        first={first}
        refreshing={refreshing}
        error={statusError}
        onUseInstallToken={onUseInstallToken}
        refreshStatus={refreshStatus}
      />
    );
  }

  return (
    <section className="grid gap-5">
      <header className="unlock-heading">
        <h1 tabIndex={-1}>{first ? "Créez votre coffre" : "Déverrouillez le coffre"}</h1>
        <p>{first ? "Ce mot de passe est irrécupérable." : "Saisissez votre mot de passe principal."}</p>
      </header>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {showInstallToken && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="install-token" isRequired>
              Jeton d’installation
            </Label>
            <Input
              id="install-token"
              type="password"
              autoComplete="off"
              aria-required="true"
              aria-invalid={!!installTokenError}
              aria-describedby={installTokenError ? "install-token-error" : "install-token-help"}
              value={installToken}
              onChange={(e) => setInstallToken(e.target.value)}
            />
            <p id="install-token-help" className="text-sm text-muted-foreground">
              Utilisez le code temporaire fourni par l’administrateur.
            </p>
            <FieldError id="install-token" error={installTokenError} />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="password" isRequired>
            Mot de passe principal
          </Label>
          <PasswordInput
            id="password"
            label="le mot de passe principal"
            variant="compact"
            autoComplete={first ? "new-password" : "current-password"}
            aria-required="true"
            aria-invalid={!!passwordError}
            aria-describedby={passwordError ? "password-error" : first ? "password-help" : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {first && (
            <p id="password-help" className="text-sm text-muted-foreground">
              {vault.MIN_MASTER_PASSWORD_LENGTH} caractères minimum.
            </p>
          )}
          <FieldError id="password" error={passwordError} />
        </div>
        {first && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm" isRequired>
              Confirmez le mot de passe
            </Label>
            <PasswordInput
              id="confirm"
              label="la confirmation du mot de passe"
              variant="compact"
              autoComplete="new-password"
              aria-required="true"
              aria-invalid={!!confirmError}
              aria-describedby={confirmError ? "confirm-error" : undefined}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <FieldError id="confirm" error={confirmError} />
          </div>
        )}
        {showTotpCode && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="code" isRequired>
              Code de double authentification
            </Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-required="true"
              aria-invalid={!!codeError}
              aria-describedby={codeError ? "code-error" : undefined}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="font-mono tracking-[0.3em]"
            />
            <FieldError id="code" error={codeError} />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" size="sm" disabled={busy} className="self-end">
          {busy && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {busy ? (first ? "Création du coffre…" : "Déchiffrement…") : first ? "Créer le coffre" : "Déverrouiller"}
          {!busy && <ArrowRight aria-hidden="true" />}
        </Button>
        {showInstallToken && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            className="self-start"
            onClick={onUseServerAccess}
          >
            <ArrowLeft aria-hidden="true" /> Revenir à l’accès local
          </Button>
        )}
      </form>
    </section>
  );
}
