import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
});

export function formatCents(cents: number) {
  return brl.format((cents ?? 0) / 100);
}

export function formatCnpj(value: string) {
  const d = (value ?? "").replace(/\D/g, "").padStart(14, "0").slice(0, 14);
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function formatPct(value: number, digits = 1) {
  return `${(value ?? 0).toFixed(digits).replace(".", ",")}%`;
}

/** Valor monetário: mono, tabular, opcionalmente colorido por sinal (entra/sai). */
export function MoneyText({
  cents,
  sign = false,
  className,
}: {
  cents: number;
  sign?: boolean | undefined;
  className?: string | undefined;
}) {
  const negative = (cents ?? 0) < 0;
  return (
    <span
      className={cn(
        "font-mono tabular",
        sign && (negative ? "text-flow-out" : "text-flow-in"),
        className,
      )}
    >
      {formatCents(cents)}
    </span>
  );
}

export function CnpjText({ value, className }: { value: string; className?: string }) {
  return <span className={cn("font-mono tabular text-sm", className)}>{formatCnpj(value)}</span>;
}

/**
 * Número herói com contagem animada até o valor final. Respeita
 * prefers-reduced-motion (mostra o valor direto).
 */
export function MoneyCountUp({
  cents,
  sign = false,
  durationMs = 700,
  className,
}: {
  cents: number;
  sign?: boolean | undefined;
  durationMs?: number | undefined;
  className?: string | undefined;
}) {
  const target = cents ?? 0;
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || durationMs <= 0) {
      fromRef.current = target;
      setShown(target);
      return;
    }
    const from = fromRef.current;
    if (from === target) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(from + (target - from) * eased);
      setShown(value);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  const negative = shown < 0;
  return (
    <span
      className={cn(
        "font-mono tabular",
        sign && (negative ? "text-flow-out" : "text-flow-in"),
        className,
      )}
    >
      {formatCents(shown)}
    </span>
  );
}
