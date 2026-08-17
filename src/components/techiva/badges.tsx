import { cn } from "@/lib/utils";

export type RegimeKind =
  | "simples"
  | "simples_hibrido"
  | "presumido"
  | "real"
  | "mei"
  | "pf"
  | "imune"
  | "desconhecido";

const REGIME: Record<RegimeKind, { label: string; className: string }> = {
  simples: { label: "Simples", className: "text-regime-simples border-regime-simples/40 bg-regime-simples/10" },
  simples_hibrido: { label: "Híbrido", className: "text-regime-hibrido border-regime-hibrido/40 bg-regime-hibrido/10" },
  presumido: { label: "Presumido", className: "text-regime-presumido border-regime-presumido/40 bg-regime-presumido/10" },
  real: { label: "Real", className: "text-regime-real border-regime-real/40 bg-regime-real/10" },
  mei: { label: "MEI", className: "text-regime-mei border-regime-mei/40 bg-regime-mei/10" },
  pf: { label: "PF", className: "text-regime-pf border-regime-pf/40 bg-regime-pf/10" },
  imune: { label: "Imune", className: "text-muted-foreground border-border bg-muted/40" },
  desconhecido: { label: "Desconhecido", className: "text-muted-foreground border-border bg-muted/40" },
};

export function RegimeBadge({ regime, className }: { regime: RegimeKind; className?: string }) {
  const cfg = REGIME[regime] ?? REGIME.desconhecido;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        cfg.className,
        className,
      )}
    >
      {cfg.label}
    </span>
  );
}

export type SemaphoreLevel = "ok" | "warn" | "crit";

const SEMAPHORE: Record<SemaphoreLevel, { dot: string; label: string }> = {
  ok: { dot: "bg-flow-in", label: "Saudável" },
  warn: { dot: "bg-warn", label: "Atenção" },
  crit: { dot: "bg-destructive", label: "Crítico" },
};

export function Semaphore({
  level,
  showLabel = true,
  className,
}: {
  level: SemaphoreLevel;
  showLabel?: boolean;
  className?: string;
}) {
  const cfg = SEMAPHORE[level];
  return (
    <span className={cn("inline-flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <span className={cn("size-2 rounded-full", cfg.dot)} aria-hidden />
      {showLabel && cfg.label}
      <span className="sr-only">{cfg.label}</span>
    </span>
  );
}
