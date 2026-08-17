import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Semaphore } from "@/components/techiva/badges";
import { DataTable } from "@/components/techiva/data-table";
import { ErrorState, NoPermissionState } from "@/components/techiva/empty-state";
import { KpiCard } from "@/components/techiva/metrics";
import { CnpjText, MoneyText } from "@/components/techiva/money";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  daysUntil,
  formatDate,
  ingestHealth,
  useBatchRegimeSim,
  usePortfolio,
  windowUrgency,
  type PortfolioRow,
} from "@/lib/portfolio";
import { useShellData } from "@/lib/tenant-shell-data";

export const Route = createFileRoute("/_authenticated/t/$tenantId/portfolio")({
  component: PortfolioScreen,
  head: () => ({
    meta: [
      { title: "Carteira do canal — TECH-IVA" },
      {
        name: "description",
        content:
          "Carteira do canal contábil: buraco de caixa por empresa, saúde da ingestão fiscal, janelas de regime e alertas críticos em uma única tabela.",
      },
      { property: "og:title", content: "Carteira do canal — TECH-IVA" },
      {
        property: "og:description",
        content: "Acompanhe todas as empresas do canal por buraco de caixa, urgência de regime e alertas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function PortfolioScreen() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const portfolio = usePortfolio(tenantId);
  const batch = useBatchRegimeSim();
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const rows = useMemo(
    () => [...(portfolio.data ?? [])].sort((a, b) => b.gap_30_cents - a.gap_30_cents),
    [portfolio.data],
  );

  const kpis = useMemo(() => {
    const gap30 = rows.reduce((sum, r) => sum + r.gap_30_cents, 0);
    const windowSoon = rows.filter((r) => {
      const days = daysUntil(r.next_window);
      return days !== null && days <= 60 && days >= 0;
    }).length;
    const criticalAlerts = rows.reduce((sum, r) => sum + r.open_alerts, 0);
    return { active: rows.length, gap30, windowSoon, criticalAlerts };
  }, [rows]);

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  const columns = useMemo<ColumnDef<PortfolioRow, unknown>[]>(
    () => [
      {
        id: "select",
        header: () => (
          <Checkbox
            aria-label="Selecionar todas as empresas"
            checked={rows.length > 0 && selectedIds.length === rows.length}
            onCheckedChange={(value) =>
              setSelected(
                value === true ? Object.fromEntries(rows.map((r) => [r.tenant_id, true])) : {},
              )
            }
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label={`Selecionar ${row.original.name}`}
            checked={Boolean(selected[row.original.tenant_id])}
            onCheckedChange={(value) =>
              setSelected((prev) => ({ ...prev, [row.original.tenant_id]: value === true }))
            }
          />
        ),
      },
      { accessorKey: "name", header: "Empresa" },
      {
        accessorKey: "cnpj",
        header: "CNPJ",
        cell: ({ row }) =>
          row.original.cnpj ? <CnpjText value={row.original.cnpj} /> : <span className="text-muted-foreground">—</span>,
      },
      {
        accessorKey: "plan_code",
        header: "Plano",
        cell: ({ row }) => (
          <span className="text-xs uppercase text-muted-foreground">{row.original.plan_code ?? "—"}</span>
        ),
      },
      {
        accessorKey: "last_ingest",
        header: "Última ingestão",
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-2">
            <Semaphore level={ingestHealth(row.original.last_ingest)} showLabel={false} />
            <span className="font-mono tabular text-xs">{formatDate(row.original.last_ingest)}</span>
          </span>
        ),
      },
      {
        accessorKey: "gap_30_cents",
        header: "Buraco 30d",
        cell: ({ row }) => <MoneyText cents={row.original.gap_30_cents} />,
      },
      {
        accessorKey: "gap_90_cents",
        header: "Buraco 90d",
        cell: ({ row }) => <MoneyText cents={row.original.gap_90_cents} />,
      },
      {
        accessorKey: "next_window",
        header: "Janela de regime",
        cell: ({ row }) => {
          const days = daysUntil(row.original.next_window);
          return (
            <span className="inline-flex items-center gap-2">
              <Semaphore level={windowUrgency(row.original.next_window)} showLabel={false} />
              <span className="font-mono tabular text-xs">
                {days === null ? "—" : `${days} dias`}
              </span>
            </span>
          );
        },
      },
      {
        accessorKey: "open_alerts",
        header: "Alertas",
        cell: ({ row }) => <span className="font-mono tabular text-xs">{row.original.open_alerts}</span>,
      },
      {
        id: "actions",
        header: "Ações",
        cell: ({ row }) => (
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/t/$tenantId/cash" params={{ tenantId: row.original.tenant_id }}>
                Abrir
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link to="/t/$tenantId/regime" params={{ tenantId: row.original.tenant_id }}>
                Relatório
              </Link>
            </Button>
          </div>
        ),
      },
    ],
    [rows, selected, selectedIds.length],
  );

  if (shell.data && shell.data.tenant.kind !== "channel" && shell.data.tenant.kind !== "platform") {
    return (
      <div className="p-6">
        <NoPermissionState hint="A carteira é uma tela de canal contábil." />
      </div>
    );
  }

  if (portfolio.error) {
    return (
      <div className="p-6">
        <ErrorState
          message={portfolio.error.message}
          onRetry={() => {
            void portfolio.refetch();
          }}
        />
      </div>
    );
  }

  async function runBatch() {
    const result = await batch.mutateAsync(selectedIds);
    if (result.failed > 0) {
      toast.warning(`${result.queued} relatórios na fila, ${result.failed} falharam.`);
    } else {
      toast.success(`${result.queued} relatórios enfileirados.`);
    }
    setSelected({});
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Carteira</h1>
          <p className="text-sm text-muted-foreground">
            Todas as empresas sob {shell.data?.tenant.name ?? "este canal"}, ordenadas pelo buraco de 30 dias.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/t/$tenantId/tenants" params={{ tenantId }}>
            Empresas e convites
          </Link>
        </Button>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="CNPJs ativos"
          value={<span className="font-mono tabular">{kpis.active}</span>}
          loading={portfolio.isLoading}
        />
        <KpiCard
          label="Buraco total — 30 dias"
          valueCents={kpis.gap30}
          hint="Soma do descasamento de caixa das empresas"
          loading={portfolio.isLoading}
        />
        <KpiCard
          label="Janela de regime em < 60 dias"
          value={<span className="font-mono tabular">{kpis.windowSoon}</span>}
          hint="Empresas que precisam decidir agora"
          loading={portfolio.isLoading}
        />
        <KpiCard
          label="Alertas em aberto"
          value={<span className="font-mono tabular">{kpis.criticalAlerts}</span>}
          loading={portfolio.isLoading}
        />
      </div>

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-2 p-3 text-sm shadow-e1">
          <span className="font-medium">{selectedIds.length} selecionadas</span>
          <Button size="sm" onClick={() => void runBatch()} disabled={batch.isPending}>
            {batch.isPending ? "Enfileirando…" : "Gerar relatórios de regime"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected({})}>
            Limpar seleção
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={rows}
        loading={portfolio.isLoading}
        searchPlaceholder="Buscar por empresa ou CNPJ…"
        emptyTitle="Nenhuma empresa na carteira"
        emptyHint="Crie empresas em Empresas e convide o dono para iniciar o onboarding."
        exportName="carteira-canal"
        density="compact"
      />
    </div>
  );
}
