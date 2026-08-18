import { useState } from "react";
import { BookOpen, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";

import { EmptyState } from "@/components/techiva/empty-state";
import { formatCents } from "@/components/techiva/money";
import { SideSheet } from "@/components/techiva/side-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CALCULADORA_OFFLINE,
  EFEITO_LABEL,
  useValidateClassTrib,
  type CalcStep,
  type ClassTribResult,
  type InvoiceItemRow,
} from "@/lib/rtc";

/* ------------------------------------------ validação CST × cClassTrib */

/** Resultado da RPC validate_class_trib, inline. Quando inválido, lista sugestões. */
export function ClassTribFeedback({
  result,
  loading,
  onPickSuggestion,
}: {
  result: ClassTribResult | undefined;
  loading?: boolean | undefined;
  onPickSuggestion?: ((cclasstrib: string) => void) | undefined;
}) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        Validando na matriz da Receita…
      </p>
    );
  }
  if (!result) return null;

  if (!result.valida) {
    return (
      <div className="space-y-2 rounded-lg border border-flow-out/40 bg-flow-out/10 p-3 text-xs">
        <p className="flex items-start gap-2 font-medium">
          <XCircle className="mt-0.5 size-3.5 shrink-0 text-flow-out" aria-hidden />
          {result.motivo}
        </p>
        {result.sugestoes.length > 0 ? (
          <div className="space-y-1">
            <p className="text-muted-foreground">Combinações válidas para este CST:</p>
            <ul className="space-y-1">
              {result.sugestoes.map((s) => (
                <li key={s.cclasstrib}>
                  {onPickSuggestion ? (
                    <button
                      type="button"
                      className="text-left text-primary hover:underline"
                      onClick={() => onPickSuggestion(s.cclasstrib)}
                    >
                      <code className="font-mono">{s.cclasstrib}</code> — {s.descricao ?? "sem descrição"}
                    </button>
                  ) : (
                    <span>
                      <code className="font-mono">{s.cclasstrib}</code> — {s.descricao ?? "sem descrição"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-muted-foreground">
            Nenhuma combinação vigente cadastrada para este CST na matriz atual.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-flow-in/40 bg-flow-in/10 p-3 text-xs">
      <p className="flex items-center gap-2 font-medium">
        <CheckCircle2 className="size-3.5 text-flow-in" aria-hidden />
        Combinação válida
        {result.efeito && (
          <Badge variant="outline" className="text-[10px]">
            {EFEITO_LABEL[result.efeito] ?? result.efeito}
          </Badge>
        )}
      </p>
      {result.descricao && <p className="text-muted-foreground">{result.descricao}</p>}
      <p className="text-muted-foreground">
        Redução: <span className="font-mono">{Number(result.reducao_pct ?? 0).toFixed(2)}%</span> · Crédito:{" "}
        {result.permite_credito ? "permitido" : "não permitido"}
      </p>
      {result.base_legal && (
        <p className="text-muted-foreground">
          Base legal: <span className="font-medium text-foreground">{result.base_legal}</span>
        </p>
      )}
    </div>
  );
}

/** Campos editáveis de CST/cClassTrib com validação inline da Receita. */
export function ClassTribValidator({
  initialCst = "",
  initialCclasstrib = "",
  competencia,
}: {
  initialCst?: string | undefined;
  initialCclasstrib?: string | undefined;
  competencia?: string | undefined;
}) {
  const [cst, setCst] = useState(initialCst);
  const [cc, setCc] = useState(initialCclasstrib);
  const validation = useValidateClassTrib(cst, cc, competencia);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="ct-cst" className="text-xs">
            CST
          </Label>
          <Input
            id="ct-cst"
            className="font-mono"
            value={cst}
            maxLength={3}
            placeholder="000"
            onChange={(e) => setCst(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ct-cc" className="text-xs">
            cClassTrib
          </Label>
          <Input
            id="ct-cc"
            className="font-mono"
            value={cc}
            maxLength={6}
            placeholder="000001"
            onChange={(e) => setCc(e.target.value.replace(/\D/g, ""))}
          />
        </div>
      </div>
      <ClassTribFeedback
        result={validation.data}
        loading={validation.isFetching}
        onPickSuggestion={(next) => setCc(next)}
      />
      {!validation.isFetching && !validation.data && (
        <p className="text-xs text-muted-foreground">
          Informe CST e cClassTrib para validar contra a matriz oficial.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------- memória de cálculo */

/** Botão + painel com a memória de cálculo do item e a base legal por passo. */
export function CalcMemoryButton({ item }: { item: InvoiceItemRow }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <BookOpen className="size-3.5" aria-hidden />
        Ver memória de cálculo
      </Button>
      <CalcMemorySheet item={item} open={open} onOpenChange={setOpen} />
    </>
  );
}

export function CalcMemorySheet({
  item,
  open,
  onOpenChange,
}: {
  item: InvoiceItemRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const steps = (item.calc_memory?.passos ?? []) as CalcStep[];
  const validation = useValidateClassTrib(item.cst, item.cclasstrib);

  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Item ${item.line} — memória de cálculo`}
      description={item.description ?? undefined}
    >
      <div className="space-y-5">
        <dl className="space-y-2 text-sm">
          <ItemRow label="NCM" value={item.ncm ?? "—"} mono />
          <ItemRow label="CST" value={item.cst ?? "—"} mono />
          <ItemRow label="cClassTrib" value={item.cclasstrib ?? "—"} mono />
          <ItemRow label="Base de cálculo" value={formatCents(item.base_cents ?? 0)} mono />
          <ItemRow label="IBS" value={formatCents(item.ibs_cents ?? 0)} mono />
          <ItemRow label="CBS" value={formatCents(item.cbs_cents ?? 0)} mono />
          <ItemRow label="IS" value={formatCents(item.is_cents ?? 0)} mono />
          <ItemRow
            label="Crédito"
            value={`${formatCents(item.credit_cents ?? 0)}${item.credit_eligible === false ? " (sem direito)" : ""}`}
            mono
          />
        </dl>

        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Enquadramento
          </h3>
          <ClassTribFeedback result={validation.data} loading={validation.isFetching} />
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Passos do cálculo
          </h3>
          {steps.length === 0 ? (
            <EmptyState
              title="Memória ainda não gravada"
              hint="A memória é preenchida quando o item passa pela calculadora oficial. Reprocesse o cálculo para gerar os passos."
            />
          ) : (
            <ol className="space-y-2">
              {steps.map((step, i) => (
                <li key={i} className="rounded-lg border border-border bg-surface-2 p-3 text-xs">
                  <p className="font-medium">
                    {i + 1}. {step.passo ?? step.descricao ?? "passo"}
                  </p>
                  {step.descricao && step.passo && (
                    <p className="mt-0.5 text-muted-foreground">{step.descricao}</p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
                    {typeof step.valor_cents === "number" && <span>{formatCents(step.valor_cents)}</span>}
                    {typeof step.aliquota_pct === "number" && <span>alíquota {step.aliquota_pct}%</span>}
                    {typeof step.reducao_pct === "number" && <span>redução {step.reducao_pct}%</span>}
                  </div>
                  {step.base_legal && (
                    <p className="mt-1 text-[11px]">
                      <span className="text-muted-foreground">Base legal: </span>
                      <span className="font-medium">{step.base_legal}</span>
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        {item.inconsistency && (
          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Inconsistência apontada
            </h3>
            <pre className="overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-[11px]">
              {JSON.stringify(item.inconsistency, null, 2)}
            </pre>
          </section>
        )}

        <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {CALCULADORA_OFFLINE}
        </p>
      </div>
    </SideSheet>
  );
}

function ItemRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-sm tabular" : "text-sm"}>{value}</dd>
    </div>
  );
}

export function ItemsList({
  items,
  loading,
}: {
  items: InvoiceItemRow[] | undefined;
  loading?: boolean | undefined;
}) {
  if (loading) return <Skeleton className="h-32 w-full" />;
  if (!items || items.length === 0) {
    return <EmptyState title="Nota sem itens registrados" />;
  }
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm">
              <span className="font-mono text-xs text-muted-foreground">#{item.line}</span>{" "}
              {item.description ?? "sem descrição"}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              CST {item.cst ?? "—"} · cClassTrib {item.cclasstrib ?? "—"} · IBS+CBS{" "}
              {formatCents((item.ibs_cents ?? 0) + (item.cbs_cents ?? 0))}
            </p>
          </div>
          <CalcMemoryButton item={item} />
        </li>
      ))}
    </ul>
  );
}
