import {
  ChevronRight,
  CircleCheck,
  Clock,
  Gauge,
  Layers,
  LoaderCircle,
  Plus,
  Repeat2,
  Ruler,
  ShieldAlert,
  ShieldQuestion,
  TriangleExclamationPoint,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/reui/badge";
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage, formatNumber, plural } from "@/lib/labels";
import { hibpEnabled } from "@/lib/preferences";
import { GrowthChart, KindBars, UpdatesChart } from "@/pages/dashboard-charts";
import {
  ageDays,
  countByKind,
  type Entry,
  growthByMonth,
  noTotpEntries,
  passwordEntries,
  pwnedCount,
  RECENT_DAYS,
  recentEntries,
  reusedGroups,
  SHORT_LENGTH,
  STALE_DAYS,
  shortEntries,
  staleEntries,
  updatesByMonth,
  WEAK_BITS,
  weakEntries,
} from "@/vault";
import { useVault } from "@/vault-context";

export function DashboardPage() {
  const { entries, loading, error } = useVault();

  return (
    <>
      <PageHeader />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading ? (
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : entries.length === 0 ? (
        <EmptyVault />
      ) : (
        <Tabs defaultValue="health" className="gap-4">
          <TabsList>
            <TabsTrigger value="health">Santé</TabsTrigger>
            <TabsTrigger value="security">Sécurité</TabsTrigger>
            <TabsTrigger value="content">Contenu</TabsTrigger>
          </TabsList>
          <TabsContent value="health">
            <HealthTab />
          </TabsContent>
          <TabsContent value="security">
            <SecurityTab />
          </TabsContent>
          <TabsContent value="content">
            <ContentTab />
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}

function PageHeader() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Tableau de bord</h2>
        <p className="text-sm text-muted-foreground">État du coffre, calculé dans ce navigateur.</p>
      </div>
      <Button size="sm" asChild>
        <Link to="/personal/vault/new">
          <Plus />
          Nouvel élément
        </Link>
      </Button>
    </div>
  );
}

function EmptyVault() {
  return (
    <Frame>
      <FramePanel className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted">
          <Layers className="size-5 text-muted-foreground" />
        </div>
        <div>
          <p className="font-medium">Le coffre est vide</p>
          <p className="text-sm text-muted-foreground">
            Les indicateurs apparaîtront dès que vous aurez enregistré un premier élément.
          </p>
        </div>
        <Button size="sm" asChild>
          <Link to="/personal/vault/new">
            <Plus />
            Ajouter un élément
          </Link>
        </Button>
      </FramePanel>
    </Frame>
  );
}

function HealthTab() {
  const { entries, now } = useVault();
  const stale = useMemo(() => staleEntries(entries, now), [entries, now]);
  const groups = useMemo(() => reusedGroups(entries), [entries]);
  const short = useMemo(() => shortEntries(entries), [entries]);
  const passwords = useMemo(() => passwordEntries(entries), [entries]);
  const oldest = stale[0];

  return (
    <Frame className="md:flex-row">
      <KpiPanel
        to="/personal/vault?filter=stale"
        icon={<Clock />}
        label="À renouveler"
        value={stale.length}
        alert={stale.length > 0}
        helper={
          oldest
            ? `Le plus ancien : « ${oldest.item.name} », ${plural(ageDays(oldest.item.updated_at, now), "jour", "jours")}`
            : `Rien n'a plus de ${STALE_DAYS} jours`
        }
      />
      <KpiPanel
        to="/personal/vault?filter=reused"
        icon={<Repeat2 />}
        label="Valeurs réutilisées"
        value={groups.reduce((n, g) => n + g.length, 0)}
        alert={groups.length > 0}
        helper={
          groups.length > 0
            ? `${plural(groups.length, "groupe", "groupes")} de valeurs identiques`
            : "Chaque secret a une valeur unique"
        }
      />
      <KpiPanel
        to="/personal/vault?filter=short"
        icon={<Ruler />}
        label="Mots de passe courts"
        value={short.length}
        alert={short.length > 0}
        helper={`Moins de ${SHORT_LENGTH} caractères, sur ${plural(passwords.length, "mot de passe ou phrase de passe", "mots de passe et phrases de passe")}`}
      />
    </Frame>
  );
}

function SecurityTab() {
  const { entries } = useVault();
  const weak = useMemo(() => weakEntries(entries), [entries]);
  const noTotp = useMemo(() => noTotpEntries(entries), [entries]);
  const passwords = useMemo(() => passwordEntries(entries), [entries]);
  const sites = entries.filter((e) => e.item.kind === "login" && (e.item.urls?.length ?? 0) > 0).length;

  return (
    <div className="flex flex-col gap-4">
      <Frame className="md:flex-row">
        <KpiPanel
          to="/personal/vault?filter=weak"
          icon={<Gauge />}
          label="Mots de passe faibles"
          value={weak.length}
          alert={weak.length > 0}
          helper={`Force estimée sous ${WEAK_BITS} bits, sur ${plural(passwords.length, "mot de passe ou phrase de passe", "mots de passe et phrases de passe")}`}
        />
        <KpiPanel
          to="/personal/vault?filter=no2fa"
          icon={<ShieldQuestion />}
          label="Sites sans double authentification"
          value={noTotp.length}
          alert={noTotp.length > 0}
          helper={`Identifiants avec une adresse et sans secret TOTP, sur ${plural(sites, "site", "sites")}`}
        />
      </Frame>
      <BreachPanel passwords={passwords} />
    </div>
  );
}

/** Known breaches via Have I Been Pwned: only when turned on in the settings, and on request. */
function BreachPanel({ passwords }: { passwords: Entry[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ checked: number; found: { entry: Entry; count: number }[] } | null>(null);

  async function check() {
    setBusy(true);
    setError("");
    try {
      const counts = new Map<string, number>(); // one request per distinct value
      const found: { entry: Entry; count: number }[] = [];
      for (const entry of passwords) {
        let n = counts.get(entry.item.value);
        if (n === undefined) {
          n = await pwnedCount(entry.item.value);
          counts.set(entry.item.value, n);
        }
        if (n > 0) found.push({ entry, count: n });
      }
      setResult({ checked: passwords.length, found });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame>
      <FrameHeader>
        <FrameTitle className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-muted-foreground" />
          Fuites connues
        </FrameTitle>
        <FrameDescription>
          Compare vos mots de passe aux fuites publiées sur Have I Been Pwned. Seuls les 5 premiers caractères de
          l'empreinte SHA-1 de chaque mot de passe quittent ce navigateur.
        </FrameDescription>
      </FrameHeader>
      <FramePanel className="flex flex-col gap-3">
        {!hibpEnabled() ? (
          <p className="text-sm text-muted-foreground">
            Désactivé.{" "}
            <Link to="/personal/settings" className="underline">
              Activez-le dans les paramètres
            </Link>{" "}
            pour lancer une vérification.
          </p>
        ) : (
          <>
            <Button size="sm" variant="outline" className="self-start" onClick={check} disabled={busy}>
              {busy && <LoaderCircle className="animate-spin" />}
              {result ? "Vérifier à nouveau" : "Vérifier maintenant"}
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {result &&
              (result.found.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucun des {plural(result.checked, "mot de passe vérifié", "mots de passe vérifiés")} n'apparaît dans
                  une fuite connue.
                </p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {result.found.map(({ entry, count }) => (
                    <li key={entry.id} className="flex items-center gap-2">
                      <Link to={`/personal/vault/${entry.id}`} className="flex-1 truncate underline">
                        {entry.item.name}
                      </Link>
                      <Badge variant="destructive-light" size="sm">
                        vu {formatNumber(count)} fois
                      </Badge>
                    </li>
                  ))}
                </ul>
              ))}
          </>
        )}
      </FramePanel>
    </Frame>
  );
}

function ContentTab() {
  const { entries, now } = useVault();
  const [showGrowth, setShowGrowth] = useState(false);
  const recent = useMemo(() => recentEntries(entries, now), [entries, now]);
  const counts = useMemo(() => countByKind(entries), [entries]);
  const growth = useMemo(() => growthByMonth(entries, now), [entries, now]);
  const updates = useMemo(() => updatesByMonth(entries, now), [entries, now]);

  return (
    <div className="flex flex-col gap-4">
      <Frame className="lg:flex-row">
        <FramePanel className="p-0 lg:max-w-xs">
          <button
            type="button"
            aria-expanded={showGrowth}
            onClick={() => setShowGrowth(!showGrowth)}
            className="flex h-full w-full flex-col gap-1 px-(--frame-panel-px) py-(--frame-panel-py) text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <KpiBody
              icon={<Layers />}
              label="Éléments"
              value={entries.length}
              helper={`${plural(recent.length, "modifié", "modifiés")} ces ${RECENT_DAYS} derniers jours`}
              action={showGrowth ? "Masquer la croissance" : "Voir la croissance"}
            />
          </button>
        </FramePanel>
        <FramePanel>
          <FrameTitle>Répartition par type</FrameTitle>
          <FrameDescription>Nombre d'éléments par type.</FrameDescription>
          <KindBars counts={counts} />
        </FramePanel>
      </Frame>
      {showGrowth && (
        <Frame>
          <FrameHeader>
            <FrameTitle>Croissance du coffre</FrameTitle>
            <FrameDescription>
              Nombre total d'éléments à la fin de chaque mois, d'après leur date de création.
            </FrameDescription>
          </FrameHeader>
          <FramePanel>
            <GrowthChart series={growth} />
          </FramePanel>
        </Frame>
      )}
      <Frame>
        <FrameHeader>
          <FrameTitle>Modifications par mois</FrameTitle>
          <FrameDescription>Éléments dont la dernière modification tombe dans le mois.</FrameDescription>
        </FrameHeader>
        <FramePanel>
          <UpdatesChart series={updates} />
        </FramePanel>
      </Frame>
    </div>
  );
}

function KpiPanel({
  to,
  alert,
  ...body
}: { to: string; alert: boolean } & Omit<Parameters<typeof KpiBody>[0], "status" | "action">) {
  return (
    <FramePanel className="p-0 md:basis-0">
      <Link
        to={to}
        className="flex h-full flex-col gap-1 px-(--frame-panel-px) py-(--frame-panel-py) outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <KpiBody
          {...body}
          action="Voir les éléments"
          status={
            alert ? (
              <Badge variant="warning-light" size="sm">
                <TriangleExclamationPoint />À traiter
              </Badge>
            ) : (
              <Badge variant="success-light" size="sm">
                <CircleCheck />
                Rien à signaler
              </Badge>
            )
          }
        />
      </Link>
    </FramePanel>
  );
}

function KpiBody({
  icon,
  label,
  value,
  helper,
  status,
  action,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  helper: string;
  status?: ReactNode;
  action: string;
}) {
  return (
    <>
      <div className="flex items-center gap-2 text-sm text-muted-foreground [&_svg]:size-4">
        {icon}
        <span className="font-medium text-foreground">{label}</span>
        <span className="ml-auto">{status}</span>
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{formatNumber(value)}</div>
      <p className="text-xs text-muted-foreground">{helper}</p>
      <span className="mt-auto flex items-center gap-0.5 pt-3 text-xs font-medium text-muted-foreground">
        {action}
        <ChevronRight className="size-3.5" />
      </span>
    </>
  );
}
