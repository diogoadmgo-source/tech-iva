import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Semaphore } from "@/components/techiva/badges";
import { DataTable } from "@/components/techiva/data-table";
import { ErrorState, NoPermissionState } from "@/components/techiva/empty-state";
import { KpiCard } from "@/components/techiva/metrics";
import { CnpjText } from "@/components/techiva/money";
import { SideSheet } from "@/components/techiva/side-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatDate,
  formatDateTime,
  useOpsOverview,
  useRetryJob,
  type OpsFailedJob,
  type OpsIntegration,
  type OpsQueue,
  type OpsStaleIngest,
} from "@/lib/platform";

export const Route = createFileRoute("/_authenticated/t/$tenantId/ops")({
  head: () => ({
    meta: [
      { title: "Operações da plataforma — TECH-IVA" },
      {
        name: "description",
        content:
          "Saúde das filas de processamento, jobs com falha, integrações e empresas com leitura fiscal atrasada.",
      },
      { property: "og:title", content: "Operações da plataforma — TECH-IVA" },
      {
        property: "og:description",
        content: "Monitore filas, falhas e integrações de toda a base em um só painel.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OpsPage,
});

function OpsPage() {
  const overview = useOpsOverview();
  const retry = useRetryJob();
  const [job, setJob] = useState<OpsFailedJob | null>(null);

  const queueColumns = useMemo<ColumnDef<OpsQueue, unknown>[]>(
    () => [
      { accessorKey: "kind", header: "Fila", cell: ({ row }) => <span className="font-mono text-xs">{row.original.kind}</span> },
      { accessorKey: "queued", header: "Na fila" },
      { accessorKey: "running", header: "Rodando" },
      {
        accessorKey: "failed",
        header: "Falhas",
        cell: ({ row }) => (
          <span className={row.original.failed > 0 ? "text-destructive" : undefined}>{row.original.failed}</span>
        ),
      },
      { accessorKey: "done_24h", header: "Concluídos 24h" },
      {
        accessorKey: "oldest_queued_at",
        header: "Mais antigo na fila",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{formatDateTime(row.original.oldest_queued_at)}</span>
        ),
      },
    ],
    [],
  );

  const failedColumns = useMemo<ColumnDef<OpsFailedJob, unknown>[]>(
    () => [
      { accessorKey: "tenant_name", header: "Organização" },
      { accessorKey: "kind", header: "Job", cell: ({ row }) => <span className="font-mono text-xs">{row.original.kind}</span> },
      {
        accessorKey: "error",
        header: "Erro",
        cell: ({ row }) => (
          <span className="line-clamp-1 max-w-[280px] text-xs text-destructive">
            {row.original.error ?? row.original.message ?? "sem detalhe"}
          </span>
        ),
      },
      {
        accessorKey: "finished_at",
        header: "Falhou em",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.finished_at)}</span>,
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setJob(row.original)}>
              Detalhes
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={retry.isPending}
              onClick={() =>
                retry.mutate(row.original.id, {
                  onSuccess: () => toast.success("Job reenfileirado."),
                  onError: (error) => toast.error((error as Error).message),
                })
              }
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Reprocessar
            </Button>
          </div>
        ),
      },
    ],
    [retry],
  );

  const integrationColumns = useMemo<ColumnDef<OpsIntegration, unknown>[]>(
    () => [
      { accessorKey: "kind", header: "Integração", cell: ({ row }) => <span className="font-mono text-xs">{row.original.kind}</span> },
      { accessorKey: "connected", header: "Conectadas" },
      { accessorKey: "pending", header: "Pendentes" },
      {
        accessorKey: "error",
        header: "Com erro",
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <Semaphore level={row.original.error > 0 ? "crit" : row.original.pending > 0 ? "warn" : "ok"} />
            {row.original.error}
          </span>
        ),
      },
      {
        accessorKey: "last_sync",
        header: "Última sincronização",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.last_sync)}</span>,
      },
    ],
    [],
  );

  const staleColumns = useMemo<ColumnDef<OpsStaleIngest, unknown>[]>(
    () => [
      { accessorKey: "name", header: "Empresa" },
      {
        accessorKey: "cnpj",
        header: "CNPJ",
        cell: ({ row }) => (row.original.cnpj ? <CnpjText value={row.original.cnpj} /> : "—"),
      },
      {
        accessorKey: "last_ingest",
        header: "Última leitura",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.last_ingest)}</span>,
      },
      {
        accessorKey: "days_since",
        header: "Dias sem leitura",
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <Semaphore level={row.original.days_since === null || row.original.days_since > 30 ? "crit" : "warn"} />
            <span className="font-mono tabular">{row.original.days_since ?? "nunca"}</span>
          </span>
        ),
      },
    ],
    [],
  );

  if (overview.isError) {
    const message = (overview.error as Error).message;
    if (message.includes("forbidden")) {
      return <NoPermissionState hint="Painel restrito a administração e operações da plataforma." />;
    }
    return <ErrorState message={message} onRetry={() => void overview.refetch()} />;
  }

  const data = overview.data;
  const totalQueued = data?.queues.reduce((acc, q) => acc + q.queued, 0) ?? 0;
  const totalFailed = data?.queues.reduce((acc, q) => acc + q.failed, 0) ?? 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Operações</h1>
          <p className="text-sm text-muted-foreground">
            Atualiza automaticamente a cada 30 s · leitura em {formatDateTime(data?.generated_at)}
          </p>
        </div>
        <Button type="button" variant="outline" className="gap-2" onClick={() => void overview.refetch()}>
          <RefreshCw className="size-4" aria-hidden />
          Atualizar
        </Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Jobs na fila" value={String(totalQueued)} loading={overview.isLoading} />
        <KpiCard label="Jobs com falha" value={String(totalFailed)} loading={overview.isLoading} />
        <KpiCard
          label="Empresas atrasadas"
          value={String(data?.stale_ingest.length ?? 0)}
          hint="sem leitura fiscal há mais de 7 dias"
          loading={overview.isLoading}
        />
        <KpiCard
          label="Regra vigente"
          value={data?.rule_current?.calc_version ?? "—"}
          hint={data?.rule_current ? `desde ${formatDate(data.rule_current.valid_from)}` : undefined}
          loading={overview.isLoading}
        />
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Filas</h2>
        <DataTable columns={queueColumns} data={data?.queues ?? []} loading={overview.isLoading} density="compact" emptyTitle="Nenhuma fila com histórico" />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Jobs com falha</h2>
        <DataTable
          columns={failedColumns}
          data={data?.failed_jobs ?? []}
          loading={overview.isLoading}
          density="compact"
          emptyTitle="Nenhuma falha"
          emptyHint="Todas as execuções recentes concluíram."
          exportName="jobs-com-falha"
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Integrações</h2>
        <DataTable columns={integrationColumns} data={data?.integrations_health ?? []} loading={overview.isLoading} density="compact" emptyTitle="Nenhuma integração cadastrada" />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Leitura fiscal atrasada</h2>
        <DataTable
          columns={staleColumns}
          data={data?.stale_ingest ?? []}
          loading={overview.isLoading}
          density="compact"
          emptyTitle="Nenhuma empresa atrasada"
          exportName="empresas-atrasadas"
        />
      </section>

      <SideSheet
        open={Boolean(job)}
        onOpenChange={(open) => !open && setJob(null)}
        title={job ? `Job ${job.kind}` : "Job"}
        description={job?.tenant_name}
      >
        {job && (
          <div className="space-y-4 text-sm">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Erro</p>
              <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 font-mono text-xs text-destructive">
                {job.error ?? job.message ?? "sem detalhe"}
              </p>
            </div>
            {job.retry_of && (
              <Badge variant="outline" className="border-warn/40 bg-warn/10 text-warn">
                reprocessamento de {job.retry_of.slice(0, 8)}
              </Badge>
            )}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Parâmetros</p>
              <pre className="overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs">
                {JSON.stringify(job.params ?? {}, null, 2)}
              </pre>
            </div>
            <p className="text-xs text-muted-foreground">
              Enfileirado em {formatDateTime(job.queued_at)} · falhou em {formatDateTime(job.finished_at)}
            </p>
          </div>
        )}
      </SideSheet>
    </div>
  );
}
