import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BadgeCheck, Banknote, Bell, Landmark, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { AlertList } from "@/components/techiva/alerts";
import { CashTimelineChart } from "@/components/techiva/cash-timeline-chart";
import { EmptyState, ErrorState, NoPermissionState } from "@/components/techiva/empty-state";
import { HeroMetric, KpiCard } from "@/components/techiva/metrics";
import { Page, PageHeader, Panel, Rise, Segmented } from "@/components/techiva/page";
import { ComparadorModalidades, ModalidadeSelector } from "@/components/techiva/modalidade";
import { NoticeBoard } from "@/components/techiva/notices";
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
import { useFeature } from "@/lib/features";
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
  const navigate = useNavigate();
  const credit = useFeature(tenantId, "credit");
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

  // "número real": há evento na linha do tempo ou algum agregado diferente de zero.
  const hasCashData =
    cash.isLoading ||
    timeline.length > 0 ||
    (heroValue ?? 0) !== 0 ||
    (kpis?.tax_out_month_cents ?? 0) !== 0 ||
    (kpis?.credit_in_month_cents ?? 0) !== 0 ||
    (kpis?.credit_backlog_cents ?? 0) !== 0 ||
    (kpis?.provision_month_cents ?? 0) !== 0;



  return (
    <Page>
      <PageHeader
        eyebrow="caixa · ibs e cbs"
        title="Caixa do Imposto"
        helpTitle="Como ler esta tela"
        help={
          <>
            <p>
              Mostramos <strong>quanto o imposto tira do seu caixa</strong> nas próximas semanas e
              em que semana ele aperta.
            </p>
            <p>
              Em 2027 o padrão é a <strong>apuração mensal</strong>: a guia vence no dia 20 do mês
              seguinte. Split payment e RAD continuam opcionais.
            </p>
            <p>Clique numa semana do gráfico para abrir os eventos que a compõem.</p>
          </>
        }
        actions={
          <Segmented
            label="Horizonte da projeção"
            value={horizon}
            onChange={(h) => setHorizon(h as CashHorizon)}
            options={CASH_HORIZONS.map((h) => ({ value: h, label: `${h}d` }))}
          />
        }
      />

      {/* avisos mantidos pela plataforma — inclui o adiamento do split payment */}
      <Rise index={1}>
        <NoticeBoard scope="caixa" highlightKeys={["split_adiado"]} />
      </Rise>

      <Rise index={2}>
        <ModalidadeSelector
          tenantId={tenantId}
          canEdit={["platform_admin", "platform_ops", "channel_admin", "owner", "finance"].includes(
            shell.data?.role ?? "",
          )}
        />
      </Rise>

      {/* herói só existe quando há número real: sem eventos de caixa, mostramos o caminho */}
      {hasCashData ? (
        <Rise index={3}>
          <HeroMetric
            label={`Buraco líquido — próximos ${horizon} dias`}
            valueCents={heroValue ?? 0}
            sub={heroSub || undefined}
            trend={hero?.trend}
            loading={cash.isLoading}
            help={
              <p>
                Diferença entre o imposto que sai e o crédito que volta no período. Negativo é caixa
                que falta; positivo é caixa que sobra.
              </p>
            }
          />
        </Rise>
      ) : (
        <Rise index={3}>
          <EmptyState
            icon={Banknote}
            title="Sem eventos de caixa no período"
            hint="Importe ou emita documentos fiscais para o Caixa do Imposto projetar o buraco líquido, os créditos e a provisão do período."
            action={
              <Button asChild className="cta-lift">
                <Link to="/t/$tenantId/onboarding" params={{ tenantId }}>
                  Importar documentos
                </Link>
              </Button>
            }
          />
        </Rise>
      )}


      {hasCashData && (
      <Rise index={4} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

        <KpiCard
          label="Imposto retido no mês"
          valueCents={kpis?.tax_out_month_cents ?? 0}
          loading={cash.isLoading}
          help={<p>Soma do IBS e da CBS devidos nas notas do mês corrente.</p>}
        />
        <KpiCard
          label="Crédito a recuperar no mês"
          valueCents={kpis?.credit_in_month_cents ?? 0}
          loading={cash.isLoading}
          help={<p>Crédito das compras do mês que abate o imposto a pagar.</p>}
        />
        <KpiCard
          label="Crédito acumulado"
          valueCents={kpis?.credit_backlog_cents ?? 0}
          hint={kpis ? `${kpis.credit_avg_days} dias médios de espera` : undefined}
          loading={cash.isLoading}
          help={
            <p>
              Crédito reconhecido que ainda não voltou ao caixa. A espera média indica quanto tempo
              o dinheiro fica parado.
            </p>
          }
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
          help={
            <p>
              Quanto separar agora para não ser pego pela guia. É sugestão de reserva — não sai do
              caixa hoje.
            </p>
          }
        />
      </Rise>

      <Rise index={5}>
        <ComparadorModalidades tenantId={tenantId} horizonDays={horizon} />
      </Rise>

      <Rise index={6}>
        <Panel
          title="Projeção semanal"
          help={<p>Cada barra é uma semana. Clique para ver os eventos que formam o valor.</p>}
          actions={
            <span className="hidden text-xs text-muted-foreground sm:inline">
              clique numa semana
            </span>
          }
        >
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
        </Panel>
      </Rise>

      <Rise index={7} className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Próximo aperto"
          icon={TriangleAlert}
          help={<p>A primeira semana do horizonte em que falta caixa para pagar o imposto.</p>}
        >
          {cash.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : nextGap ? (
            <>
              <p className="text-lg font-semibold">
                <MoneyText cents={nextGap.amount_cents} />
              </p>
              <p className="mt-1 font-mono tabular text-xs text-muted-foreground">
                Semana de {weekLabel(nextGap.week)}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {credit.enabled ? (
                  <Button
                    type="button"
                    size="sm"
                    className="cta-lift"
                    disabled={!nextGap.offer_available}
                    onClick={() =>
                      void navigate({ to: "/t/$tenantId/finance", params: { tenantId } })
                    }
                  >
                    <Banknote className="size-4" aria-hidden /> Cobrir este buraco
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setWeek(nextGap.week)}
                >
                  Ver provisão sugerida
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum aperto previsto no horizonte selecionado.
            </p>
          )}
        </Panel>

        <Panel
          title="Alertas recentes"
          icon={Bell}
          help={<p>Inconsistências e prazos detectados nas suas notas e na apuração.</p>}
          actions={
            <Link
              to="/t/$tenantId/audit"
              params={{ tenantId }}
              className="text-xs text-primary hover:underline"
            >
              Auditoria
            </Link>
          }
        >
          {alerts.isLoading ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <AlertList
              alerts={alerts.data ?? []}
              onOpen={(a) => !a.read_at && ack.mutate(a.id)}
              onResolve={(a) => resolve.mutate({ alertId: a.id })}
            />
          )}
        </Panel>

        <Panel
          title="Confiança da projeção"
          icon={BadgeCheck}
          help={
            <p>
              Quanto mais fontes conectadas (notas, banco, histórico de recebimento), mais firme
              fica a projeção.
            </p>
          }
        >
          <ul className="space-y-3 text-sm">
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
        </Panel>
      </Rise>

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
    </Page>
  );
}

function averageConfidence(timeline: { confidence?: number | undefined }[]) {
  const vals = timeline.map((t) => t.confidence).filter((v): v is number => typeof v === "number");
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
