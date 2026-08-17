import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "./money";
import { useChartColors } from "./use-chart-colors";

export type CashTimelinePoint = {
  week: string;
  tax_out_cents: number;
  credit_in_cents: number;
  net_cents: number;
  confidence?: number | undefined;
};

function weekLabel(week: string) {
  const d = new Date(`${week}T00:00:00`);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function CashTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as CashTimelinePoint;
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3 text-xs shadow-e2">
      <p className="mb-2 font-medium">Semana de {weekLabel(String(label))}</p>
      <dl className="space-y-1">
        <div className="flex justify-between gap-6">
          <dt className="text-muted-foreground">Imposto a pagar</dt>
          <dd className="font-mono tabular text-flow-out">{formatCents(row.tax_out_cents)}</dd>
        </div>
        <div className="flex justify-between gap-6">
          <dt className="text-muted-foreground">Crédito a receber</dt>
          <dd className="font-mono tabular text-flow-in">{formatCents(row.credit_in_cents)}</dd>
        </div>
        <div className="flex justify-between gap-6">
          <dt className="text-muted-foreground">Saldo</dt>
          <dd className="font-mono tabular">{formatCents(row.net_cents)}</dd>
        </div>
        {row.confidence !== undefined && (
          <div className="flex justify-between gap-6">
            <dt className="text-muted-foreground">Confiança</dt>
            <dd className="font-mono tabular">{Math.round(row.confidence * 100)}%</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function CashTimelineChart({
  data,
  loading,
  onSelectWeek,
  height = 300,
}: {
  data: CashTimelinePoint[];
  loading?: boolean | undefined;
  onSelectWeek?: ((week: string) => void) | undefined;
  height?: number | undefined;
}) {
  const c = useChartColors();

  if (loading) return <Skeleton className="w-full" style={{ height }} />;

  const withBand = data.map((d) => ({
    ...d,
    band: Math.abs(d.net_cents) * (1 - (d.confidence ?? 0.7)),
  }));

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={withBand}
          onClick={(e: any) => {
            const week = e?.activePayload?.[0]?.payload?.week;
            if (week && onSelectWeek) onSelectWeek(week);
          }}
        >
          <CartesianGrid stroke={c.border} vertical={false} />
          <XAxis
            dataKey="week"
            tickFormatter={weekLabel}
            tick={{ fill: c.muted, fontSize: 11 }}
            stroke={c.border}
          />
          <YAxis
            tickFormatter={(v) => `${Math.round(Number(v) / 100000)}k`}
            tick={{ fill: c.muted, fontSize: 11 }}
            stroke={c.border}
          />
          <Tooltip content={<CashTooltip />} />
          <Area
            dataKey="band"
            fill={c.primary}
            fillOpacity={0.1}
            stroke="none"
            isAnimationActive={false}
          />
          <Bar dataKey="tax_out_cents" fill={c.flowOut} radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Bar dataKey="credit_in_cents" fill={c.flowIn} radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Line
            dataKey="net_cents"
            stroke={c.primary}
            strokeWidth={2}
            dot={false}
            type="monotone"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
