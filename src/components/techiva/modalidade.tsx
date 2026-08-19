import { ArrowRight, CalendarClock, Scale } from "lucide-react";
import { toast } from "sonner";

import { formatCents, MoneyText } from "@/components/techiva/money";
import { Panel, Segmented } from "@/components/techiva/page";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MODALIDADES,
  useCompararModalidades,
  useModalidade,
  useSetModalidade,
  type CenarioModalidade,
  type Modalidade,
} from "@/lib/modalidade";
import { cn } from "@/lib/utils";


/**
 * Seletor da modalidade de recolhimento.
 *
 * A modalidade determina QUANDO o imposto deixa o caixa (não quanto se paga).
 * Em 2027 o padrão é a apuração mensal; RAD e split são opcionais e o split
 * ainda não tem data. Só quem pode escrever (owner/finance/channel_admin/
 * plataforma) enxerha os botões habilitados — a RPC recusa o resto.
 */
export function ModalidadeSelector({
  tenantId,
  canEdit,
}: {
  tenantId: string;
  canEdit: boolean;
}) {
  const current = useModalidade(tenantId);
  const setModalidade = useSetModalidade(tenantId);

  const change = (value: Modalidade) => {
    if (value === current.data) return;
    setModalidade.mutate(value, {
      onSuccess: () =>
        toast.success(
          "Modalidade atualizada. A projeção está sendo refeita com o novo ritmo de saída.",
        ),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível trocar."),
    });
  };

  const currentLabel =
    MODALIDADES.find((m) => m.value === current.data)?.label ?? "Não definida";

  return (
    <Panel
      title="Modalidade de recolhimento"
      icon={CalendarClock}
      help={
        <>
          <p>
            Define <strong>quando</strong> o imposto sai do seu caixa, não quanto você paga.
          </p>
          <p>
            Em 2027 o padrão é a <strong>apuração mensal</strong> — guia no dia 20 do mês seguinte.
            RAD e split payment são opcionais e o split ainda não tem data.
          </p>
          {!canEdit ? <p>Seu papel não permite alterar esta premissa.</p> : null}
        </>
      }
      bodyClassName="flex flex-wrap items-center justify-between gap-3 p-4"
    >
      <p className="text-xs text-muted-foreground">
        Atual:{" "}
        <span className="font-medium text-foreground">
          {current.isLoading ? "…" : currentLabel}
        </span>
      </p>
      {current.isLoading ? (
        <Skeleton className="h-9 w-56" />
      ) : canEdit ? (
        <Segmented
          label="Modalidade de recolhimento"
          value={current.data ?? "apuracao"}
          onChange={(v) => change(v as Modalidade)}
          options={MODALIDADES.map((m) => ({ value: m.value, label: m.short }))}
        />
      ) : (
        <span className="rounded-full border border-border/70 bg-surface-2/60 px-3 py-1.5 text-xs font-medium text-muted-foreground">
          {currentLabel}
        </span>
      )}
    </Panel>
  );
}


function GapCell({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <MoneyText cents={cents} className="text-sm" />
    </div>
  );
}

/**
 * "Compare as modalidades": os três cenários lado a lado, com a diferença em reais
 * contra a apuração mensal — que é o padrão de 2027. É a decisão que a empresa vai
 * ter que tomar, e ninguém no mercado mostra isso.
 */
export function ComparadorModalidades({
  tenantId,
  horizonDays = 120,
}: {
  tenantId: string;
  horizonDays?: number;
}) {
  const comparison = useCompararModalidades(tenantId, horizonDays);

  if (comparison.isLoading) {
    return (
      <Panel title="Compare as modalidades" icon={Scale}>
        <Skeleton className="h-40 w-full" />
      </Panel>
    );
  }
  if (comparison.isError || !comparison.data) return null;

  const { cenarios, atual, observacao } = comparison.data;
  const base = cenarios.find((c) => c.modalidade === "apuracao");

  const diff = (c: CenarioModalidade) =>
    base && c.modalidade !== "apuracao" ? c.gap_30_cents - base.gap_30_cents : null;

  return (
    <Panel
      title="Compare as modalidades"
      icon={Scale}
      help={
        <>
          <p>
            Mesmo imposto, ritmos diferentes de saída. A escolha muda o seu caixa nos próximos
            meses.
          </p>
          <p>{observacao}</p>
        </>
      }
      actions={
        <span className="text-xs text-muted-foreground">Horizonte de {horizonDays} dias</span>
      }
    >
      <div className="grid gap-3 lg:grid-cols-3">

        {cenarios.map((c) => {
          const d = diff(c);
          return (
            <article
              key={c.modalidade}
              className={cn(
                "rounded-lg border p-3",
                c.modalidade === atual
                  ? "border-primary/60 bg-primary/5"
                  : "border-border bg-surface-2",
              )}
            >
              <header className="flex items-start justify-between gap-2">
                <h3 className="text-xs font-semibold leading-snug">{c.rotulo}</h3>
                {c.modalidade === atual ? (
                  <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                    atual
                  </span>
                ) : null}
              </header>
              <div className="mt-3 space-y-1.5">
                <GapCell label="30 dias" cents={c.gap_30_cents} />
                <GapCell label="60 dias" cents={c.gap_60_cents} />
                <GapCell label="90 dias" cents={c.gap_90_cents} />
              </div>
              <p className="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
                {c.pior_semana
                  ? `Pior semana: ${new Date(`${c.pior_semana.semana}T00:00:00`).toLocaleDateString(
                      "pt-BR",
                      { day: "2-digit", month: "short" },
                    )} · ${formatCents(c.pior_semana.saldo_cents)}`
                  : "Sem semana crítica no horizonte"}
              </p>
              {d !== null ? (
                <p className="mt-2 flex items-center gap-1 text-[11px] font-medium">
                  <ArrowRight className="size-3 shrink-0" aria-hidden />
                  <span className={d < 0 ? "text-flow-out" : "text-flow-in"}>
                    {formatCents(Math.abs(d))} {d < 0 ? "a menos" : "a mais"} no caixa em 30 dias
                  </span>
                  <span className="text-muted-foreground">que na apuração mensal</span>
                </p>
              ) : null}
            </article>
          );
        })}
      </div>

      {/* observação com a fonte e a data vem da RPC, não do código */}
      <p className="mt-4 flex gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>{observacao}</span>
      </p>
    </section>
  );
}
