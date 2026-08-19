import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoHint } from "@/components/techiva/info-hint";
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
  help,
  loading,
  className,
}: {
  label: string;
  valueCents?: number | undefined;
  value?: ReactNode | undefined;
  delta?: number | undefined;
  hint?: string | undefined;
  /** Explicação do indicador — abre no balão "?". */
  help?: ReactNode | undefined;
  loading?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cn("panel panel-hover sheen p-4", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {help ? <InfoHint title={label}>{help}</InfoHint> : null}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-32" />
      ) : (
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-xl font-semibold tracking-[-0.01em]">
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
  help,
  loading,
}: {
  label: string;
  valueCents: number;
  sub?: string | undefined;
  trend?: number | undefined;
  action?: ReactNode | undefined;
  help?: ReactNode | undefined;
  loading?: boolean | undefined;
}) {
  return (
    <div className="panel-hero p-6 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            {help ? <InfoHint title={label}>{help}</InfoHint> : null}
          </div>
          {loading ? (
            <Skeleton className="mt-3 h-12 w-64" />
          ) : (
            <p className="mt-2 text-[2.25rem] leading-none font-semibold tracking-[-0.02em] sm:text-[2.5rem]">
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
