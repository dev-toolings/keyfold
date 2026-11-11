import { Bot, CircleCheck, LoaderCircle, RefreshCw, TriangleExclamationPoint } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, FILTER_LABELS, formatNumber, formatRelative, formatSize, plural } from "@/lib/labels";
import { FILTERS, type Filter, health, type ServerHealth, SHORT_LENGTH, STALE_DAYS, WEAK_BITS } from "@/vault";
import { useVault } from "@/vault-context";

/** What each indicator checks, as vault_health (MCP) documents it. */
const RULES: Record<Filter, string> = {
  stale: `Non modifiés depuis plus de ${STALE_DAYS} jours`,
  reused: "Même secret qu'un autre élément",
  short: `Mots de passe de moins de ${SHORT_LENGTH} caractères`,
  weak: `Force estimée sous ${WEAK_BITS} bits`,
  no2fa: "Sites sans secret de double authentification",
};

/** Health check: what the server stores, then the vault indicators, then the same check for AI agents. */
export function HealthPage() {
  const { entries, flags } = useVault();
  const [server, setServer] = useState<ServerHealth | null>(null);
  const [checkedAt, setCheckedAt] = useState(() => new Date());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setServer(await health());
      setCheckedAt(new Date());
    } catch (e) {
      setError(errorMessage(e));
      setServer(null);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    check();
  }, [check]);

  // Attachment files the server holds that no item lists any more.
  const referenced = entries.reduce((n, e) => n + (e.item.attachments?.length ?? 0), 0);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">État du système</h2>
          <p className="text-sm text-muted-foreground">
            Serveur, données chiffrées et indicateurs du coffre. Vérifié{" "}
            {formatRelative(checkedAt.toISOString(), new Date())}.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={check} disabled={busy}>
          {busy ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          Revérifier
        </Button>
      </div>

      {error && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <TriangleExclamationPoint className="size-4" />
              Serveur injoignable ou en erreur
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      )}

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Serveur</h3>
        {!server && !error ? (
          <div className="grid gap-3 md:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : (
          server && (
            <div className="grid gap-3 md:grid-cols-3">
              <Kpi
                label="Serveur"
                value={`API ${server.api}`}
                ok
                helper={`En ligne, démarré ${formatRelative(new Date(Date.now() - server.uptime_seconds * 1000).toISOString(), new Date())}`}
              />
              <Kpi
                label="Éléments chiffrés"
                value={formatNumber(server.items)}
                ok={server.items === entries.length}
                helper={
                  server.items === entries.length
                    ? "Tous déchiffrés dans ce navigateur"
                    : `${formatNumber(entries.length)} chargés ici : un autre client a écrit depuis, rechargez la page`
                }
              />
              <Kpi
                label="Pièces jointes"
                value={formatNumber(server.blobs)}
                ok={server.blobs === referenced}
                helper={
                  server.blobs === referenced
                    ? `${formatSize(server.blob_bytes)} au total, ${formatSize(server.max_blob)} au plus par fichier`
                    : `${formatSize(server.blob_bytes)} au total, dont ${plural(Math.abs(server.blobs - referenced), "fichier", "fichiers")} sans élément correspondant`
                }
              />
              <Kpi
                label="Espace disque libre"
                value={formatSize(server.free_bytes)}
                ok={server.free_bytes > server.max_blob}
                helper={
                  server.free_bytes > server.max_blob
                    ? "Sur le disque du répertoire de données"
                    : "Moins que la taille maximale d'une pièce jointe"
                }
              />
              <Kpi
                label="Double authentification"
                value={server.totp ? "Active" : "Inactive"}
                ok={server.totp}
                helper={
                  server.totp ? (
                    "Un code est demandé pour télécharger l'identité"
                  ) : (
                    <>
                      L'identité chiffrée se télécharge sans code.{" "}
                      <Link to="/personal/settings" className="underline">
                        L'activer
                      </Link>
                    </>
                  )
                }
              />
              <Kpi
                label="Sessions ouvertes"
                value={formatNumber(server.sessions)}
                ok
                helper="Navigateurs et CLI déverrouillés, celle-ci comprise"
              />
            </div>
          )
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Indicateurs du coffre</h3>
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
          {FILTERS.map((f) => (
            <Link key={f} to={`/personal/vault?filter=${f}`} className="rounded-xl outline-none focus-visible:ring-2">
              <Kpi
                label={FILTER_LABELS[f]}
                value={formatNumber(flags[f].size)}
                ok={flags[f].size === 0}
                helper={RULES[f]}
              />
            </Link>
          ))}
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4 text-muted-foreground" />
            Le même contrôle pour un agent IA
          </CardTitle>
          <CardDescription>
            L'outil MCP <code>vault_health</code> de <code>kf mcp</code> renvoie l'état du serveur et ces indicateurs,
            par nom d'élément, avec les mêmes règles que cette page. Jamais une valeur ni une note. Déverrouillez
            d'abord avec <code>kf unlock</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
            claude mcp add keyfold -- "$PWD/bin/kf" mcp
          </pre>
        </CardContent>
      </Card>
    </>
  );
}

function Kpi({ label, value, helper, ok }: { label: string; value: string; helper: ReactNode; ok: boolean }) {
  return (
    <Card className="h-full gap-2 py-4">
      <CardHeader className="px-4">
        <CardDescription className="flex items-center gap-2">
          <span className="font-medium text-foreground">{label}</span>
          <span className="ml-auto">
            {ok ? (
              <Badge variant="success-light" size="sm">
                <CircleCheck />
                OK
              </Badge>
            ) : (
              <Badge variant="warning-light" size="sm">
                <TriangleExclamationPoint />À voir
              </Badge>
            )}
          </span>
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tracking-tight">{value}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 text-xs text-muted-foreground">{helper}</CardContent>
    </Card>
  );
}
