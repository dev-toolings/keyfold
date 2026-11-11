// Dashboard charts. One series each, so one hue (--chart-1); text stays in text tokens.
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, XAxis, YAxis } from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { formatMonth, formatNumber, KIND_PLURALS, plural } from "@/lib/labels";
import { hasEnoughHistory, KINDS, type Kind, MIN_TIME_POINTS, type MonthPoint, monthlyAverage } from "@/vault";

const itemsConfig = { count: { label: "Éléments", color: "var(--chart-1)" } } satisfies ChartConfig;

/** Ranked horizontal bars, one per kind, count at the tip. */
export function KindBars({ counts }: { counts: Record<Kind, number> }) {
  const data = KINDS.map((k) => ({ label: KIND_PLURALS[k], count: counts[k] })).sort((a, b) => b.count - a.count);
  return (
    <ChartContainer config={itemsConfig} className="mt-3 aspect-auto h-40 w-full">
      <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 0, right: 32 }}>
        <XAxis type="number" dataKey="count" hide allowDecimals={false} />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={150} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} barSize={18}>
          <LabelList dataKey="count" position="right" className="fill-foreground tabular-nums" fontSize={12} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

function NotEnoughHistory({ months }: { months: number }) {
  return (
    <p className="text-sm text-muted-foreground">
      Pas encore assez d'historique pour un graphique : {plural(months, "mois", "mois")} de données, il en faut au moins{" "}
      {MIN_TIME_POINTS}.
    </p>
  );
}

/** Cumulative item count per month. */
export function GrowthChart({ series }: { series: MonthPoint[] }) {
  const last = series.at(-1)?.count ?? 0;
  if (!hasEnoughHistory(series)) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-2xl font-semibold">{plural(last, "élément", "éléments")}</p>
        <NotEnoughHistory months={series.length} />
      </div>
    );
  }
  const data = series.map((p) => ({ label: formatMonth(p.month), count: p.count }));
  return (
    <ChartContainer config={itemsConfig} className="aspect-auto h-56 w-full">
      <AreaChart accessibilityLayer data={data} margin={{ left: 0, right: 12, top: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} className="tabular-nums" />
        <ChartTooltip cursor content={<ChartTooltipContent indicator="line" />} />
        <Area
          dataKey="count"
          type="monotone"
          stroke="var(--color-count)"
          strokeWidth={2}
          fill="var(--color-count)"
          fillOpacity={0.1}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
        />
      </AreaChart>
    </ChartContainer>
  );
}

/** Items per month of last modification, with the monthly average as a named reference line. */
export function UpdatesChart({ series }: { series: MonthPoint[] }) {
  const average = monthlyAverage(series);
  if (!hasEnoughHistory(series)) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-2xl font-semibold">{formatNumber(average)} par mois en moyenne</p>
        <NotEnoughHistory months={series.length} />
      </div>
    );
  }
  const data = series.map((p) => ({ label: formatMonth(p.month), count: p.count }));
  return (
    <ChartContainer config={itemsConfig} className="aspect-auto h-60 w-full">
      <BarChart accessibilityLayer data={data} margin={{ left: 0, right: 104, top: 20 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} className="tabular-nums" />
        <ChartTooltip cursor content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} maxBarSize={24} />
        <ReferenceLine
          y={average}
          stroke="var(--muted-foreground)"
          strokeDasharray="4 4"
          ifOverflow="extendDomain"
          label={{
            value: `Moyenne : ${formatNumber(average)}`,
            position: "right",
            fill: "var(--muted-foreground)",
            fontSize: 12,
          }}
        />
      </BarChart>
    </ChartContainer>
  );
}
