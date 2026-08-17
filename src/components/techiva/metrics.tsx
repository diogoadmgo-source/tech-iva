import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatPct, MoneyText } from "./money";

function Delta({ value }: { value: number }) {
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  const tone = value > 0 ? "text-flow-in" : value < 0 ? "text-flow-out" : "text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", tone)}>
      <Icon className="size-3.5" aria-hidden />
      <span className="font-mono tabular">{formatPct(Math.abs(value) * 100)}</span>
    </span>
  );
}

export function KpiCard({
  label,
  valueCents,
  value,
  delta,
  hint,
  loading,
  className,
}: {
  label: string;
  valueCents?: number;
  value?: ReactNode;
  delta?: number;
  hint?: string;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-surface-1 p-4 shadow-e1 transition-colors hover:border-border-strong",
        className,
      )}
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-32" />
      ) : (
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-xl font-semibold">
            {valueCents !== undefined ? <MoneyText cents={valueCents} /> : value}
          </span>
          {delta !== undefined && <Delta value={delta} />}
        </div>
      )}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function HeroMetric({
  label,
  valueCents,
  sub,
  trend,
  action,
  loading,
}: {
  label: string;
  valueCents: number;
  sub?: string;
  trend?: number;
  action?: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface-2 p-6 shadow-e2">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="mt-3 h-12 w-64" />
          ) : (
            <p className="mt-2 text-[2.5rem] leading-none font-semibold">
              <MoneyText cents={valueCents} sign />
            </p>
          )}
          <div className="mt-3 flex items-center gap-3">
            {sub && <span className="font-mono tabular text-sm text-muted-foreground">{sub}</span>}
            {trend !== undefined && <Delta value={trend} />}
          </div>
        </div>
        {action}
      </div>
    </div>
  );
}
