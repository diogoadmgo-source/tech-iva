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
