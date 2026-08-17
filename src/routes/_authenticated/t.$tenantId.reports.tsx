import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { FileText } from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/techiva/data-table";
import { ErrorState, NoPermissionState } from "@/components/techiva/empty-state";
import { KpiCard } from "@/components/techiva/metrics";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useShellData } from "@/lib/tenant-shell-data";

export const Route = createFileRoute("/_authenticated/t/$tenantId/reports")({
  head: () => ({
    meta: [
      { title: "Relatórios da carteira — TECH-IVA" },
      {
        name: "description",
        content:
          "Relatórios de regime gerados para as empresas do canal: recomendação, janela de opção e PDF para o contador.",
      },
      { property: "og:title", content: "Relatórios da carteira — TECH-IVA" },
      {
        property: "og:description",
        content: "Histórico de simulações de regime das empresas do canal com PDF para download.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportsPage,
});

type ReportRow = {
  id: string;
  tenant_id: string;
  company: string;
  run_at: string;
  recommendation: string | null;
  next_window: string | null;
  report_path: string | null;
};

function ReportsPage() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const kind = shell.data?.tenant.kind;
  const canSee = kind === "channel" || kind === "platform";

  const reports = useQuery({
    queryKey: ["channel-reports", tenantId],
    enabled: canSee,
    queryFn: async (): Promise<ReportRow[]> => {
      const [{ data: sims, error }, { data: tenants }] = await Promise.all([
        supabase
          .from("regime_simulations")
          .select("id, tenant_id, run_at, recommendation, next_window, report_path")
          .order("run_at", { ascending: false })
          .limit(500),
        supabase.from("tenants").select("id, name"),
      ]);
      if (error) throw error;
      const names = new Map((tenants ?? []).map((t) => [t.id, t.name]));
      return (sims ?? []).map((s) => ({
        id: s.id,
        tenant_id: s.tenant_id,
        company: names.get(s.tenant_id) ?? "—",
        run_at: s.run_at ?? "",
        recommendation: s.recommendation,
        next_window: s.next_window,
        report_path: s.report_path,
      }));
    },
  });

  const rows = reports.data ?? [];

  const columns = useMemo<ColumnDef<ReportRow, unknown>[]>(
    () => [
      {
        accessorKey: "company",
        header: "Empresa",
        cell: ({ row }) => (
          <Link
            to="/t/$tenantId/regime"
            params={{ tenantId: row.original.tenant_id }}
            className="font-medium hover:underline"
          >
            {row.original.company}
          </Link>
        ),
      },
      {
        accessorKey: "run_at",
        header: "Gerado em",
        cell: ({ row }) =>
          row.original.run_at ? new Date(row.original.run_at).toLocaleString("pt-BR") : "—",
      },
      {
        accessorKey: "recommendation",
        header: "Recomendação",
        cell: ({ row }) =>
          row.original.recommendation === "hybrid"
            ? "Simples híbrido"
            : row.original.recommendation === "traditional"
              ? "Simples tradicional"
              : "—",
      },
      {
        accessorKey: "next_window",
        header: "Próxima janela",
        cell: ({ row }) =>
          row.original.next_window
            ? new Date(row.original.next_window).toLocaleDateString("pt-BR")
            : "—",
      },
      {
        id: "actions",
        header: "PDF",
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            disabled={!row.original.report_path}
            onClick={() => void openReport(row.original.report_path)}
          >
            <FileText className="mr-2 size-4" aria-hidden />
            Abrir
          </Button>
        ),
      },
    ],
    [],
  );

  if (shell.isSuccess && !canSee) {
    return <NoPermissionState hint="Relatórios da carteira existem no contexto de canal ou plataforma." />;
  }

  if (reports.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar os relatórios"
        message={(reports.error as Error)?.message}
        onRetry={() => void reports.refetch()}
      />
    );
  }

  const withPdf = rows.filter((r) => r.report_path).length;
  const hybrid = rows.filter((r) => r.recommendation === "hybrid").length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
        <p className="text-sm text-muted-foreground">
          Simulações de regime geradas para as empresas da carteira, com PDF para o contador.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Relatórios gerados" value={`${rows.length}`} loading={reports.isLoading} />
        <KpiCard label="Com PDF disponível" value={`${withPdf}`} loading={reports.isLoading} />
        <KpiCard
          label="Recomendam híbrido"
          value={`${hybrid}`}
          hint="Empresas em que o híbrido reduz a carga"
          loading={reports.isLoading}
        />
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={reports.isLoading}
        searchPlaceholder="Buscar empresa ou recomendação…"
        emptyTitle="Nenhum relatório ainda"
        emptyHint="Enfileire simulações em Carteira para gerar relatórios em lote."
        exportName="relatorios-regime"
      />
    </div>
  );
}

async function openReport(path: string | null) {
  if (!path) return;
  const { data, error } = await supabase.storage.from("reports").createSignedUrl(path, 300);
  if (error || !data) {
    toast.error("Não foi possível abrir o relatório.");
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener");
}
