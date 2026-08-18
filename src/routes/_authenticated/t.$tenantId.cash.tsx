import { createFileRoute, Link } from "@tanstack/react-router";
import { BadgeCheck, Banknote, Landmark, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { AlertList } from "@/components/techiva/alerts";
import { CashTimelineChart } from "@/components/techiva/cash-timeline-chart";
import { EmptyState, ErrorState, NoPermissionState } from "@/components/techiva/empty-state";
import { HeroMetric, KpiCard } from "@/components/techiva/metrics";
import { formatCents, MoneyText } from "@/components/techiva/money";
import { SideSheet } from "@/components/techiva/side-sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CASH_HORIZONS,
  useAckAlert,
  useAlerts,
  useCashAutoRefresh,
  useDashboardCash,
  useResolveAlert,
  useWeekEvents,
  type CashHorizon,
} from "@/lib/cash";
import { useShellData } from "@/lib/tenant-shell-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/t/$tenantId/cash")({
  component: CashScreen,
  head: () => ({
    meta: [
      { title: "Caixa do Imposto — TECH-IVA" },
      {
        name: "description",
        content:
          "Projeção semanal do caixa tributário: buraco líquido em 30/60/90 dias, créditos a recuperar, provisão sugerida e próximo aperto.",
      },
      { property: "og:title", content: "Caixa do Imposto — TECH-IVA" },
      {
        property: "og:description",
        content: "Projeção do caixa tributário da sua empresa em 12 semanas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const KIND_LABELS: Record<string, string> = {
  tax_out: "Imposto a pagar",
  credit_in: "Crédito a receber",
  provision: "Provisão",
  credit_advance: "Antecipação",
  loan_in: "Empréstimo (entrada)",
  loan_out: "Empréstimo (saída)",
};

function weekLabel(week: string) {
  return new Date(`${week}T00:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
  });
}

function CashScreen() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const [horizon, setHorizon] = useState<CashHorizon>(90);
  const [week, setWeek] = useState<string | null>(null);

  useCashAutoRefresh(tenantId);
  const cash = useDashboardCash(tenantId, horizon);
  const alerts = useAlerts(tenantId, 5);
  const events = useWeekEvents(tenantId, week);
  const ack = useAckAlert(tenantId);
  const resolve = useResolveAlert(tenantId);

  const kind = shell.data?.tenant.kind;
  if (kind && kind !== "company" && kind !== "unit") {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <NoPermissionState hint="O Caixa do Imposto existe apenas para empresas e filiais. Selecione uma empresa no seletor de organização." />
      </div>
    );
  }

  if (cash.error) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <ErrorState
          message="Não foi possível carregar a projeção de caixa."
          onRetry={() => void cash.refetch()}
        />
      </div>
    );
  }

  const data = cash.data;
  const hero = data?.hero;
  const kpis = data?.kpis;
  const heroValue =
    horizon === 30
      ? hero?.gap_30_cents
      : horizon === 60
        ? hero?.gap_60_cents
        : hero?.gap_90_cents;
  const timeline = data?.timeline ?? [];
  const nextGap = data?.next_gap ?? null;
  const conf = data?.confidence;
  // a RPC agrega apenas dentro do horizonte pedido: só exibimos as janelas
  // menores ou iguais a ele (senão 60d/90d repetiriam o valor de 30d).
  const heroSub = hero
    ? (
        [
          [30, hero.gap_30_cents],
          [60, hero.gap_60_cents],
          [90, hero.gap_90_cents],
        ] as const
      )
        .filter(([win]) => win <= horizon && win !== horizon)
        .map(([win, cents]) => `${win}d: ${formatCents(cents)}`)
        .join(" · ")
    : "";


  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Caixa do Imposto</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Quanto o imposto tira do seu caixa nas próximas semanas — e quando aperta.
          </p>
        </div>
        <div
          className="inline-flex rounded-lg border border-border bg-surface-1 p-1"
          role="group"
          aria-label="Horizonte da projeção"
        >
          {CASH_HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHorizon(h)}
              aria-pressed={horizon === h}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                horizon === h
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {h}d
            </button>
          ))}
        </div>
      </header>

      <HeroMetric
        label={`Buraco líquido — próximos ${horizon} dias`}
        valueCents={heroValue ?? 0}
        sub={heroSub || undefined}

        trend={hero?.trend}
        loading={cash.isLoading}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Imposto retido no mês"
          valueCents={kpis?.tax_out_month_cents ?? 0}
          loading={cash.isLoading}
        />
        <KpiCard
          label="Crédito a recuperar no mês"
          valueCents={kpis?.credit_in_month_cents ?? 0}
          loading={cash.isLoading}
        />
        <KpiCard
          label="Crédito acumulado"
          valueCents={kpis?.credit_backlog_cents ?? 0}
          hint={kpis ? `${kpis.credit_avg_days} dias médios de espera` : undefined}
          loading={cash.isLoading}
        />
        <KpiCard
          label="Provisão sugerida"
          valueCents={kpis?.provision_month_cents ?? 0}
          hint={
            kpis
              ? `Reserva do mês · ${formatCents(kpis.provision_horizon_cents)} nos próximos ${horizon} dias`
              : "Reserva sugerida do mês"
          }
          loading={cash.isLoading}
        />


      </div>

      <section className="rounded-xl border border-border bg-surface-1 p-4 shadow-e1">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Projeção semanal</h2>
          <p className="text-xs text-muted-foreground">Clique numa semana para ver os eventos</p>
        </div>
        {cash.isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : timeline.length === 0 ? (
          <EmptyState
            title="Sem projeção ainda"
            hint="Autorize a leitura das suas notas no onboarding para que o caixa seja projetado."
          />
        ) : (
          <CashTimelineChart data={timeline} onSelectWeek={setWeek} />
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-border bg-surface-1 p-4 shadow-e1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <TriangleAlert className="size-4 text-warn" aria-hidden /> Próximo aperto
          </h2>
          {cash.isLoading ? (
            <Skeleton className="mt-3 h-20 w-full" />
          ) : nextGap ? (
            <>
              <p className="mt-3 text-lg font-semibold">
                <MoneyText cents={nextGap.amount_cents} />
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Semana de {weekLabel(nextGap.week)}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {credit.enabled ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={!nextGap.offer_available}
                    onClick={() =>
                      void navigate({ to: "/t/$tenantId/finance", params: { tenantId } })
                    }
                  >
                    <Banknote className="size-4" aria-hidden /> Cobrir este buraco
                  </Button>
                ) : null}
                <Button type="button" size="sm" variant="outline" onClick={() => setWeek(nextGap.week)}>
                  Ver provisão sugerida
                </Button>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Nenhum aperto previsto no horizonte selecionado.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-border bg-surface-1 p-4 shadow-e1">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Alertas recentes</h2>
            <Link
              to="/t/$tenantId/audit"
              params={{ tenantId }}
              className="text-xs text-primary hover:underline"
            >
              Auditoria
            </Link>
          </div>
          {alerts.isLoading ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <AlertList
              alerts={alerts.data ?? []}
              onOpen={(a) => !a.read_at && ack.mutate(a.id)}
              onResolve={(a) => resolve.mutate({ alertId: a.id })}
            />
          )}
        </section>

        <section className="rounded-xl border border-border bg-surface-1 p-4 shadow-e1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <BadgeCheck className="size-4 text-primary" aria-hidden /> Confiança da projeção
          </h2>
          <ul className="mt-3 space-y-3 text-sm">
            <li className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Banco conectado</span>
              {conf?.bank_connected ? (
                <span className="text-xs font-medium text-flow-in">Sim</span>
              ) : (
                <Button type="button" size="sm" variant="outline">
                  <Landmark className="size-4" aria-hidden /> Conectar
                </Button>
              )}
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Histórico de recebimento</span>
              <span className="text-xs font-medium">
                {conf?.receipt_history ? "Completo" : "Parcial"}
              </span>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Índice de confiança</span>
              <span className="font-mono tabular text-xs">
                {Math.round((conf?.score ?? averageConfidence(timeline)) * 100)}%
              </span>
            </li>
          </ul>
        </section>
      </div>

      <SideSheet
        open={Boolean(week)}
        onOpenChange={(open) => !open && setWeek(null)}
        title="Eventos da semana"
        description={week ? `Semana de ${weekLabel(week)}` : undefined}
      >
        {events.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (events.data ?? []).length === 0 ? (
          <EmptyState title="Sem eventos nesta semana" />
        ) : (
          <ul className="divide-y divide-border">
            {(events.data ?? []).map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {KIND_LABELS[e.kind] ?? e.kind}
                    {e.kind === "provision" ? (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        sugestão de reserva — fora do caixa
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {new Date(`${e.event_date}T00:00:00`).toLocaleDateString("pt-BR")} · confiança{" "}
                    {Math.round(Number(e.confidence ?? 0) * 100)}%
                  </p>
                </div>
                <MoneyText cents={e.amount_cents} className="text-sm" />
              </li>
            ))}
          </ul>
        )}

      </SideSheet>
    </div>
  );
}

function averageConfidence(timeline: { confidence?: number | undefined }[]) {
  const vals = timeline.map((t) => t.confidence).filter((v): v is number => typeof v === "number");
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
