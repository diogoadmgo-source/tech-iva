import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, CheckCircle2, FlaskConical, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/techiva/data-table";
import { ErrorState, NoPermissionState } from "@/components/techiva/empty-state";
import { KpiCard } from "@/components/techiva/metrics";
import { MoneyText, formatPct } from "@/components/techiva/money";
import { SideSheet } from "@/components/techiva/side-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  formatDate,
  formatDateTime,
  useCreateRuleVersion,
  usePublishRuleVersion,
  useReprocessProgress,
  useRuleDryRun,
  useRuleVersions,
  type DryRunResult,
  type ImpactSample,
  type RuleVersion,
} from "@/lib/platform";

export const Route = createFileRoute("/_authenticated/t/$tenantId/rules")({
  head: () => ({
    meta: [
      { title: "Versões de regra — TECH-IVA" },
      {
        name: "description",
        content:
          "Publique versões de cálculo e cClassTrib com simulação de impacto obrigatória antes de aplicar à base.",
      },
      { property: "og:title", content: "Versões de regra — TECH-IVA" },
      {
        property: "og:description",
        content: "Governança das regras fiscais da plataforma com dry-run e reprocessamento rastreável.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RulesPage,
});

function RulesPage() {
  const versions = useRuleVersions();
  const create = useCreateRuleVersion();
  const dryRun = useRuleDryRun();
  const publish = usePublishRuleVersion();

  const [createOpen, setCreateOpen] = useState(false);
  const [calcVersion, setCalcVersion] = useState("");
  const [cclasstrib, setCclasstrib] = useState("");
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const [selected, setSelected] = useState<RuleVersion | null>(null);
  const [preview, setPreview] = useState<DryRunResult | null>(null);
  const [publishedId, setPublishedId] = useState<string | null>(null);

  const progress = useReprocessProgress(publishedId);

  const current = versions.data?.find((v) => v.is_current) ?? null;

  const columns = useMemo<ColumnDef<RuleVersion, unknown>[]>(
    () => [
      {
        accessorKey: "calc_version",
        header: "Versão de cálculo",
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <span className="font-mono text-xs">{row.original.calc_version}</span>
            {row.original.is_current && (
              <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
                vigente
              </Badge>
            )}
          </span>
        ),
      },
      {
        accessorKey: "cclasstrib_version",
        header: "cClassTrib",
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.cclasstrib_version}</span>,
      },
      {
        accessorKey: "valid_from",
        header: "Vigência",
        cell: ({ row }) => formatDate(row.original.valid_from),
      },
      {
        accessorKey: "published_at",
        header: "Publicada",
        cell: ({ row }) =>
          row.original.published_at ? (
            <span className="text-xs text-muted-foreground">
              {formatDateTime(row.original.published_at)}
              {row.original.published_by_name ? ` · ${row.original.published_by_name}` : ""}
            </span>
          ) : (
            <Badge variant="outline" className="border-border text-muted-foreground">
              rascunho
            </Badge>
          ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-2"
            disabled={dryRun.isPending}
            onClick={() => {
              setSelected(row.original);
              setPreview(null);
              dryRun.mutate(row.original.id, {
                onSuccess: (result) => setPreview(result),
                onError: (error) => toast.error((error as Error).message),
              });
            }}
          >
            <FlaskConical className="size-3.5" aria-hidden />
            Simular
          </Button>
        ),
      },
    ],
    [dryRun],
  );

  const sampleColumns = useMemo<ColumnDef<ImpactSample, unknown>[]>(
    () => [
      { accessorKey: "name", header: "Organização" },
      {
        accessorKey: "tax_out_cents",
        header: "Hoje",
        cell: ({ row }) => <MoneyText cents={row.original.tax_out_cents} />,
      },
      {
        accessorKey: "projected_cents",
        header: "Projetado",
        cell: ({ row }) => <MoneyText cents={row.original.projected_cents} />,
      },
      {
        accessorKey: "delta_cents",
        header: "Δ",
        cell: ({ row }) => (
          <span className={row.original.delta_cents > 0 ? "text-flow-out" : "text-flow-in"}>
            <MoneyText cents={row.original.delta_cents} />
          </span>
        ),
      },
    ],
    [],
  );

  if (versions.isError) {
    const message = (versions.error as Error).message;
    if (message.includes("forbidden")) {
      return <NoPermissionState hint="Somente papéis da plataforma acessam as versões de regra." />;
    }
    return <ErrorState message={message} onRetry={() => void versions.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Versões de regra</h1>
          <p className="text-sm text-muted-foreground">
            Toda publicação exige simulação de impacto e MFA; o reprocessamento é enfileirado por empresa.
          </p>
        </div>
        <Button type="button" className="gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden />
          Nova versão
        </Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Versão vigente" value={current?.calc_version ?? "—"} hint={current ? `desde ${formatDate(current.valid_from)}` : "nenhuma publicada"} />
        <KpiCard label="cClassTrib vigente" value={current?.cclasstrib_version ?? "—"} />
        <KpiCard label="Rascunhos" value={String(versions.data?.filter((v) => !v.published_at).length ?? 0)} />
      </div>

      {publishedId && progress.data && (
        <section className="rounded-xl border border-border bg-surface-1 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Reprocessamento em andamento</p>
            <span className="font-mono text-xs text-muted-foreground">
              {progress.data.done}/{progress.data.total} concluídos · {progress.data.failed} com falha
            </span>
          </div>
          <Progress value={progress.data.progress_pct} className="mt-3" />
        </section>
      )}

      <DataTable
        columns={columns}
        data={versions.data ?? []}
        loading={versions.isLoading}
        emptyTitle="Nenhuma versão de regra"
        emptyHint="Crie a primeira versão para começar a governança fiscal."
        exportName="versoes-de-regra"
        searchPlaceholder="Buscar versão…"
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-surface-1">
          <DialogHeader>
            <DialogTitle>Nova versão de regra</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="calc">Versão de cálculo</Label>
              <Input id="calc" value={calcVersion} onChange={(e) => setCalcVersion(e.target.value)} placeholder="calc-2027.01" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ccl">Versão cClassTrib</Label>
              <Input id="ccl" value={cclasstrib} onChange={(e) => setCclasstrib(e.target.value)} placeholder="cclasstrib-1.02" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="from">Vigente a partir de</Label>
              <Input id="from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notas</Label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>
          </div>
          <Button
            type="button"
            disabled={create.isPending || !calcVersion.trim() || !cclasstrib.trim()}
            onClick={() =>
              create.mutate(
                {
                  calcVersion: calcVersion.trim(),
                  cclasstribVersion: cclasstrib.trim(),
                  validFrom,
                  ...(notes.trim() ? { notes: notes.trim() } : {}),
                },
                {
                  onSuccess: () => {
                    toast.success("Versão criada como rascunho.");
                    setCreateOpen(false);
                    setCalcVersion("");
                    setCclasstrib("");
                    setNotes("");
                  },
                  onError: (error) => toast.error((error as Error).message),
                },
              )
            }
          >
            Criar rascunho
          </Button>
        </DialogContent>
      </Dialog>

      <SideSheet
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setPreview(null);
          }
        }}
        title={selected ? `Impacto de ${selected.calc_version}` : "Impacto"}
        description="Simulação sobre os 90 dias projetados das empresas ativas."
        footer={
          selected && !selected.is_current ? (
            <Button
              type="button"
              className="w-full gap-2"
              disabled={!preview || publish.isPending}
              onClick={() =>
                publish.mutate(selected.id, {
                  onSuccess: (result) => {
                    setPublishedId(result.rule_version_id);
                    toast.success(`Publicada. ${result.jobs_enqueued} reprocessamentos enfileirados.`);
                    setSelected(null);
                    setPreview(null);
                  },
                  onError: (error) => {
                    const message = (error as Error).message;
                    toast.error(
                      message.includes("MFA required")
                        ? "Publicação exige autenticação em duas etapas (MFA)."
                        : message,
                    );
                  },
                })
              }
            >
              <ShieldAlert className="size-4" aria-hidden />
              Publicar (exige MFA)
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Esta versão já é a vigente.</p>
          )
        }
      >
        {dryRun.isPending && <p className="text-sm text-muted-foreground">Simulando impacto…</p>}
        {preview && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <KpiCard label="Imposto hoje" valueCents={preview.impact_preview.tax_out_before_cents} />
              <KpiCard
                label="Imposto projetado"
                valueCents={preview.impact_preview.tax_out_after_cents}
                hint={`${formatPct(preview.impact_preview.delta_pct)} vs. atual`}
              />
              <KpiCard label="Organizações afetadas" value={String(preview.impact_preview.tenants_affected)} />
              <KpiCard
                label="Alíquota IVA"
                value={`${formatPct(preview.impact_preview.iva_rate_current * 100)} → ${formatPct(preview.impact_preview.iva_rate_new * 100)}`}
              />
            </div>

            <div
              className={
                preview.impact_preview.delta_cents > 0
                  ? "flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn"
                  : "flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm text-muted-foreground"
              }
            >
              {preview.impact_preview.delta_cents > 0 ? (
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              ) : (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
              )}
              <span>
                Variação total de <MoneyText cents={preview.impact_preview.delta_cents} /> no imposto projetado.
              </span>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-medium text-muted-foreground">Amostra (10 maiores)</h4>
              <DataTable columns={sampleColumns} data={preview.impact_preview.sample} density="compact" />
            </div>
          </div>
        )}
      </SideSheet>
    </div>
  );
}
