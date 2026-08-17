import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCents, MoneyText } from "./money";

export function ComparisonCard({
  left,
  right,
  winner,
}: {
  left: { title: string; rows: { label: string; value: ReactNode }[] };
  right: { title: string; rows: { label: string; value: ReactNode }[] };
  winner?: "left" | "right" | undefined;
}) {
  const panels = [
    { side: "left" as const, ...left },
    { side: "right" as const, ...right },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {panels.map((p) => (
        <div
          key={p.side}
          className={cn(
            "rounded-xl border bg-surface-1 p-4",
            winner === p.side ? "border-primary shadow-e2" : "border-border shadow-e1",
          )}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{p.title}</h3>
            {winner === p.side && (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                <Check className="size-3" aria-hidden /> Recomendado
              </span>
            )}
          </div>
          <dl className="mt-3 space-y-2">
            {p.rows.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between gap-4 text-sm">
                <dt className="text-muted-foreground">{r.label}</dt>
                <dd className="font-mono tabular">{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

export function OfferCard({
  kind,
  amountCents,
  costLabel,
  term,
  breakdown = [],
  onDetails,
  onAccept,
}: {
  kind: string;
  amountCents: number;
  costLabel: string;
  term: string;
  breakdown?: { label: string; value: string }[] | undefined;
  onDetails?: (() => void) | undefined;
  onAccept?: (() => void) | undefined;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-4 shadow-e1">
      <p className="text-xs font-medium text-muted-foreground">{kind}</p>
      <p className="mt-1 text-2xl font-semibold">
        <MoneyText cents={amountCents} />
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {costLabel} · {term}
      </p>
      {breakdown.length > 0 && (
        <dl className="mt-3 space-y-1 border-t border-border pt-3 text-xs">
          {breakdown.map((b) => (
            <div key={b.label} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{b.label}</dt>
              <dd className="font-mono tabular">{b.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-4 flex gap-2">
        <Button type="button" size="sm" onClick={onAccept}>
          Contratar
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDetails}>
          Ver detalhes
        </Button>
      </div>
    </div>
  );
}

export type LedgerRow = {
  date: string;
  description: string;
  debit_cents?: number | undefined;
  credit_cents?: number | undefined;
  balance_cents: number;
};

export function LedgerTable({ rows }: { rows: LedgerRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-1 shadow-e1">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Data</th>
            <th className="px-3 py-2 text-left font-medium">Lançamento</th>
            <th className="px-3 py-2 text-right font-medium">Débito</th>
            <th className="px-3 py-2 text-right font-medium">Crédito</th>
            <th className="px-3 py-2 text-right font-medium">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/60">
              <td className="px-3 py-2 font-mono tabular text-xs">
                {new Date(`${r.date}T00:00:00`).toLocaleDateString("pt-BR")}
              </td>
              <td className="px-3 py-2">{r.description}</td>
              <td className="px-3 py-2 text-right font-mono tabular text-flow-out">
                {r.debit_cents ? formatCents(r.debit_cents) : "—"}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular text-flow-in">
                {r.credit_cents ? formatCents(r.credit_cents) : "—"}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular">{formatCents(r.balance_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
