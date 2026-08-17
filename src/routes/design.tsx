import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AlertList, type AlertItem } from "@/components/techiva/alerts";
import { RegimeBadge, Semaphore, type RegimeKind } from "@/components/techiva/badges";
import { ComparisonCard, LedgerTable, OfferCard } from "@/components/techiva/cards";
import { CashTimelineChart, type CashTimelinePoint } from "@/components/techiva/cash-timeline-chart";
import { DataTable } from "@/components/techiva/data-table";
import { DiffJson } from "@/components/techiva/diff-json";
import { EmptyState, ErrorState, NoPermissionState } from "@/components/techiva/empty-state";
import { JobProgress } from "@/components/techiva/job-progress";
import { HeroMetric, KpiCard } from "@/components/techiva/metrics";
import { CnpjText, formatCents, MoneyText } from "@/components/techiva/money";
import { SideSheet } from "@/components/techiva/side-sheet";
import { Stepper } from "@/components/techiva/stepper";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/design")({
  component: DesignGallery,
  head: () => ({
    meta: [
      { title: "Design System — TECH-IVA" },
      {
        name: "description",
        content:
          "Galeria de componentes do design system TECH-IVA: métricas fiscais, tabelas densas, fluxo de caixa tributário e estados de sistema.",
      },
      { property: "og:title", content: "Design System — TECH-IVA" },
      {
        property: "og:description",
        content: "Componentes visuais padrão da plataforma TECH-IVA em tema dark premium.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const REGIMES: RegimeKind[] = ["simples", "simples_hibrido", "presumido", "real", "mei", "pf"];

const CASH: CashTimelinePoint[] = Array.from({ length: 12 }).map((_, i) => {
  const d = new Date(2026, 0, 5 + i * 7);
  const tax = 180000 + i * 24000;
  const credit = 90000 + ((i * 37) % 9) * 15000;
  return {
    week: d.toISOString().slice(0, 10),
    tax_out_cents: tax,
    credit_in_cents: credit,
    net_cents: credit - tax,
    confidence: 0.9 - i * 0.04,
  };
});

type Doc = { number: string; partner: string; cnpj: string; total_cents: number; status: string };

const DOCS: Doc[] = [
  { number: "000123", partner: "Distribuidora Beta", cnpj: "12345678000199", total_cents: 1249000, status: "Autorizada" },
  { number: "000124", partner: "Serviços Gama", cnpj: "98765432000188", total_cents: 389050, status: "Autorizada" },
  { number: "000125", partner: "Contábil Alfa", cnpj: "11222333000144", total_cents: 75500, status: "Cancelada" },
];

const ALERTS: AlertItem[] = [
  {
    id: "1",
    kind: "cash_gap",
    severity: "critical",
    title: "Caixa insuficiente para DAS de fevereiro",
    created_at: new Date().toISOString(),
  },
  {
    id: "2",
    kind: "credit_expiring",
    severity: "warning",
    title: "Crédito de PIS/COFINS vence em 30 dias",
    created_at: new Date().toISOString(),
    read_at: new Date().toISOString(),
  },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="border-b border-border pb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function DesignGallery() {
  const [sheet, setSheet] = useState(false);

  return (
    <main className="mx-auto max-w-6xl space-y-10 px-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold">Design System TECH-IVA</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Referência viva dos componentes de produto — tema dark premium, Inter + JetBrains Mono.
        </p>
      </header>

      <Section title="Tipografia numérica">
        <div className="flex flex-wrap items-center gap-6 rounded-xl border border-border bg-surface-1 p-4">
          <MoneyText cents={1249000} className="text-lg" />
          <MoneyText cents={-38905} className="text-lg" />
          <CnpjText value="12345678000199" />
          <span className="font-mono tabular text-sm">{formatCents(0)}</span>
        </div>
      </Section>

      <Section title="Métricas">
        <HeroMetric label="Saldo tributário projetado (90d)" valueCents={-482300} sub="12 semanas" trend={-0.08} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Impostos a pagar" valueCents={1840000} delta={0.12} hint="Próximos 30 dias" />
          <KpiCard label="Créditos a recuperar" valueCents={764500} delta={-0.03} />
          <KpiCard label="Documentos processados" value="1.284" delta={0.21} />
          <KpiCard label="Carregando" loading />
        </div>
      </Section>

      <Section title="Regimes e semáforo">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-1 p-4">
          {REGIMES.map((r) => (
            <RegimeBadge key={r} regime={r} />
          ))}
          <Semaphore level="ok" showLabel />
          <Semaphore level="warn" showLabel />
          <Semaphore level="crit" showLabel />
        </div>
      </Section>

      <Section title="Fluxo de caixa tributário">
        <div className="rounded-xl border border-border bg-surface-1 p-4 shadow-e1">
          <CashTimelineChart data={CASH} />
        </div>
      </Section>

      <Section title="Tabela de dados">
        <DataTable<Doc>
          exportName="documentos"
          data={DOCS}
          columns={[
            { accessorKey: "number", header: "Número", cell: (c) => <span className="font-mono tabular">{String(c.getValue())}</span> },
            { accessorKey: "partner", header: "Parceiro" },
            { accessorKey: "cnpj", header: "CNPJ", cell: (c) => <CnpjText value={String(c.getValue())} /> },
            {
              accessorKey: "total_cents",
              header: "Total",
              cell: (c) => <MoneyText cents={Number(c.getValue())} />,
            },
            { accessorKey: "status", header: "Situação" },
          ]}
        />
      </Section>

      <Section title="Comparação e ofertas">
        <ComparisonCard
          winner="right"
          left={{
            title: "Cenário atual (Presumido)",
            rows: [
              { label: "Carga anual", value: <MoneyText cents={9840000} /> },
              { label: "Créditos", value: <MoneyText cents={120000} /> },
            ],
          }}
          right={{
            title: "Cenário Real",
            rows: [
              { label: "Carga anual", value: <MoneyText cents={8420000} /> },
              { label: "Créditos", value: <MoneyText cents={1560000} /> },
            ],
          }}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <OfferCard
            kind="Antecipação de recebíveis"
            amountCents={2500000}
            costLabel="1,89% a.m."
            term="45 dias"
            breakdown={[
              { label: "Deságio", value: "R$ 708,75" },
              { label: "Líquido", value: "R$ 24.291,25" },
            ]}
          />
          <OfferCard kind="Crédito para DAS" amountCents={860000} costLabel="2,15% a.m." term="30 dias" />
        </div>
      </Section>

      <Section title="Razão contábil">
        <LedgerTable
          rows={[
            { date: "2026-01-05", description: "Apuração ICMS", debit_cents: 240000, balance_cents: -240000 },
            { date: "2026-01-12", description: "Crédito de entrada", credit_cents: 90000, balance_cents: -150000 },
            { date: "2026-01-20", description: "Pagamento DAS", debit_cents: 180000, balance_cents: -330000 },
          ]}
        />
      </Section>

      <Section title="Jobs e auditoria">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <JobProgress
              job={{
                id: "j1",
                kind: "import_nfe",
                status: "running",
                progress: 42,
                message: "Processando 420 de 1000 documentos",
                started_at: new Date(Date.now() - 60000).toISOString(),
              }}
            />
            <JobProgress
              job={{ id: "j2", kind: "recompute_cash", status: "failed", progress: 78, error: "Timeout na SEFAZ" }}
            />
          </div>
          <DiffJson
            before={{ role: "viewer", active: true, limit_cents: 100000 }}
            after={{ role: "finance", active: true, limit_cents: 500000 }}
          />
        </div>
      </Section>

      <Section title="Alertas">
        <AlertList alerts={ALERTS} onResolve={() => {}} />
      </Section>

      <Section title="Processo e painéis">
        <Stepper
          steps={["Empresa", "Certificado", "Integrações", "Revisão"]}
          current={1}
        />
        <Button type="button" variant="outline" onClick={() => setSheet(true)}>
          Abrir painel lateral
        </Button>
        <SideSheet open={sheet} onOpenChange={setSheet} title="Detalhe do documento" description="NF-e 000123">
          <DiffJson before={{ status: "pendente" }} after={{ status: "autorizada" }} />
        </SideSheet>
      </Section>

      <Section title="Estados">
        <div className="grid gap-4 lg:grid-cols-3">
          <EmptyState title="Nenhum documento importado" hint="Conecte uma integração para começar." />
          <ErrorState message="Falha ao carregar apurações." onRetry={() => {}} />
          <NoPermissionState hint="Requer papel finance ou superior." />
        </div>
      </Section>
    </main>
  );
}
