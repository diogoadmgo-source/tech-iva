import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { RegimeBadge, Semaphore, type RegimeKind, type SemaphoreLevel } from "@/components/techiva/badges";
import { DataTable } from "@/components/techiva/data-table";
import { EmptyState, ErrorState, NoPermissionState } from "@/components/techiva/empty-state";
import { formatCents, formatCnpj, formatPct, MoneyText } from "@/components/techiva/money";
import { SideSheet } from "@/components/techiva/side-sheet";
import { useChartColors } from "@/components/techiva/use-chart-colors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  sensitivity,
  useChainMap,
  useCounterpartyDetail,
  useMarkRenegotiate,
  useSetRegimeManual,
  type ChainRow,
  type PartyRole,
} from "@/lib/chain";
import { RegistrySummary } from "@/components/techiva/cnpj-autofill";
import { useClassifyCounterparties, useCnpjRecord } from "@/lib/cnpj";
import { useShellData } from "@/lib/tenant-shell-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/t/$tenantId/chain")({
  component: ChainScreen,
  head: () => ({
    meta: [
      { title: "Carteira — mapa da cadeia | TECH-IVA" },
      {
        name: "description",
        content:
          "Mapa da cadeia de clientes e fornecedores por regime tributário: concentração, crédito transferido, crédito perdido por ano e ação sugerida.",
      },
      { property: "og:title", content: "Carteira — mapa da cadeia | TECH-IVA" },
      {
        property: "og:description",
        content: "Concentração da carteira por regime e impacto do crédito na sua margem.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const REGIMES: RegimeKind[] = [
  "simples",
  "simples_hibrido",
  "presumido",
  "real",
  "mei",
  "pf",
  "imune",
  "desconhecido",
];

const REGIME_LABEL: Record<RegimeKind, string> = {
  simples: "Simples",
  simples_hibrido: "Simples híbrido",
  presumido: "Presumido",
  real: "Real",
  mei: "MEI",
  pf: "Pessoa física",
  imune: "Imune",
  desconhecido: "Desconhecido",
};

const ACTION_TONE: Record<string, string> = {
  Manter: "border-border text-muted-foreground",
  Classificar: "border-warn/40 bg-warn/10 text-warn",
  "Avaliar troca": "border-destructive/40 bg-destructive/10 text-destructive",
  "Atenção: exige crédito integral": "border-destructive/40 bg-destructive/10 text-destructive",
};

function ActionChip({ action }: { action: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        ACTION_TONE[action] ?? "border-border text-muted-foreground",
      )}
    >
      {action}
    </span>
  );
}

function ChainScreen() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const [role, setRole] = useState<PartyRole>("customer");
  const [regime, setRegime] = useState<RegimeKind | "all">("all");
  const [semaphore, setSemaphore] = useState<SemaphoreLevel | "all">("all");
  const [minValue, setMinValue] = useState("");
  const [selectedRegime, setSelectedRegime] = useState<RegimeKind | null>(null);
  const [openParty, setOpenParty] = useState<ChainRow | null>(null);

  const chain = useChainMap(tenantId, role);
  const mark = useMarkRenegotiate(tenantId);
  const colors = useChartColors();

  const isCustomer = role === "customer";
  const rows = chain.data ?? [];

  const filtered = useMemo(() => {
    const min = Number(minValue.replace(/\D/g, "")) * 100;
    return rows.filter(
      (r) =>
        (regime === "all" || r.regime === regime) &&
        (semaphore === "all" || r.semaphore === semaphore) &&
        (!min || r.total_cents >= min) &&
        (!selectedRegime || r.regime === selectedRegime),
    );
  }, [rows, regime, semaphore, minValue, selectedRegime]);

  const summary = useMemo(() => {
    const total = rows.reduce((s, r) => s + r.total_cents, 0);
    const regular = rows
      .filter((r) => r.regime === "real" || r.regime === "presumido")
      .reduce((s, r) => s + r.total_cents, 0);
    return {
      count: rows.length,
      total,
      regularPct: total ? (100 * regular) / total : 0,
      lost: rows.reduce((s, r) => s + r.credit_lost_cents, 0),
    };
  }, [rows]);

  const treemap = useMemo(() => {
    const byRegime = new Map<RegimeKind, ChainRow[]>();
    for (const r of rows) {
      const list = byRegime.get(r.regime) ?? [];
      list.push(r);
      byRegime.set(r.regime, list);
    }
    return [...byRegime.entries()].map(([reg, list]) => ({
      name: REGIME_LABEL[reg],
      regime: reg,
      children: list.slice(0, 20).map((r) => ({
        name: r.name || formatCnpj(r.cnpj),
        regime: reg,
        size: Math.max(r.total_cents, 1),
      })),
    }));
  }, [rows]);

  const columns = useMemo<ColumnDef<ChainRow, unknown>[]>(
    () => [
      {
        accessorKey: "cnpj",
        header: "CNPJ",
        cell: ({ row }) => (
          <span className="font-mono tabular text-xs">{formatCnpj(row.original.cnpj)}</span>
        ),
      },
      { accessorKey: "name", header: "Nome" },
      {
        accessorKey: "regime",
        header: "Regime",
        cell: ({ row }) => <RegimeBadge regime={row.original.regime} />,
      },
      {
        accessorKey: "share_pct",
        header: isCustomer ? "% receita" : "% compras",
        cell: ({ row }) => <span className="font-mono tabular">{formatPct(row.original.share_pct)}</span>,
      },
      {
        accessorKey: "total_cents",
        header: isCustomer ? "Receita 12m" : "Compras 12m",
        cell: ({ row }) => <MoneyText cents={row.original.total_cents} />,
      },
      {
        accessorKey: "credit_transfer_pct",
        header: isCustomer ? "Crédito transferido" : "Crédito recuperado",
        cell: ({ row }) => (
          <span className="font-mono tabular">{formatPct(row.original.credit_transfer_pct)}</span>
        ),
      },
      {
        accessorKey: "credit_lost_cents",
        header: isCustomer ? "Impacto crédito integral" : "Crédito perdido/ano",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <MoneyText cents={row.original.credit_lost_cents} className="text-flow-out" />
            <span className="text-[11px] text-muted-foreground">
              {formatPct(100 - row.original.credit_transfer_pct)} do valor
            </span>
          </div>
        ),
      },
      {
        accessorKey: "semaphore",
        header: "Semáforo",
        cell: ({ row }) => <Semaphore level={row.original.semaphore} />,
      },
      {
        accessorKey: "suggested_action",
        header: "Ação sugerida",
        cell: ({ row }) => <ActionChip action={row.original.suggested_action} />,
      },
      {
        id: "open",
        header: "",
        cell: ({ row }) => (
          <Button variant="ghost" size="sm" onClick={() => setOpenParty(row.original)}>
            Abrir
          </Button>
        ),
      },
    ],
    [isCustomer],
  );

  const kind = shell.data?.tenant.kind;
  if (kind && kind !== "company" && kind !== "unit") {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <NoPermissionState hint="A Carteira existe para empresas e filiais. Selecione uma empresa no seletor de organização." />
      </div>
    );
  }

  if (chain.error) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <ErrorState
          message="Não foi possível carregar o mapa da cadeia."
          onRetry={() => void chain.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Carteira</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {chain.isLoading
              ? "Carregando concentração da cadeia…"
              : `${summary.count} ${isCustomer ? "clientes" : "fornecedores"} · ${formatPct(summary.regularPct)} do volume em regime regular · crédito perdido/ano ${formatCents(summary.lost)}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
        <ClassifyCounterpartiesButton tenantId={tenantId} />
        <div
          className="inline-flex rounded-lg border border-border bg-surface-1 p-1"
          role="group"
          aria-label="Papel da contraparte"
        >
          {(["customer", "supplier"] as PartyRole[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setRole(r);
                setSelectedRegime(null);
              }}
              aria-pressed={role === r}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                role === r
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r === "customer" ? "Clientes" : "Fornecedores"}
            </button>
          ))}
        </div>
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="rounded-xl border border-border bg-surface-1 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Concentração por regime</h2>
            {selectedRegime && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedRegime(null)}>
                Limpar seleção
              </Button>
            )}
          </div>
          <div className="mt-3 h-[320px]">
            {chain.isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : treemap.length === 0 ? (
              <EmptyState
                title="Sem notas classificadas"
                hint="Assim que houver notas dos últimos 12 meses, a concentração aparece aqui."
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <Treemap
                  data={treemap}
                  dataKey="size"
                  stroke={colors.border}
                  fill={colors.primary}
                  isAnimationActive={false}
                  onClick={(node: unknown) => {
                    const reg = (node as { regime?: RegimeKind })?.regime;
                    if (reg) setSelectedRegime((cur) => (cur === reg ? null : reg));
                  }}
                >
                  <Tooltip
                    formatter={(value: number) => formatCents(Number(value))}
                    contentStyle={{
                      background: "hsl(var(--surface-2, 222 20% 12%))",
                      border: `1px solid ${colors.border}`,
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                </Treemap>
              </ResponsiveContainer>
            )}
          </div>
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs text-muted-foreground">Regime</Label>
                <Select value={regime} onValueChange={(v) => setRegime(v as RegimeKind | "all")}>
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {REGIMES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {REGIME_LABEL[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Semáforo</Label>
                <Select
                  value={semaphore}
                  onValueChange={(v) => setSemaphore(v as SemaphoreLevel | "all")}
                >
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="ok">Saudável</SelectItem>
                    <SelectItem value="warn">Atenção</SelectItem>
                    <SelectItem value="crit">Crítico</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground" htmlFor="min-value">
                Valor mínimo 12m (R$)
              </Label>
              <Input
                id="min-value"
                inputMode="numeric"
                value={minValue}
                onChange={(e) => setMinValue(e.target.value)}
                placeholder="0"
                className="mt-1 h-9 font-mono"
              />
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {filtered.length} de {rows.length} linhas
              {selectedRegime ? ` · regime ${REGIME_LABEL[selectedRegime]}` : ""}
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={filtered.length === 0 || mark.isPending}
              onClick={() => {
                mark.mutate(
                  { partyIds: filtered.map((r) => r.id), note: "Marcado em lote na Carteira" },
                  {
                    onSuccess: (n) => toast.success(`${n} contraparte(s) marcada(s) para renegociar`),
                    onError: (e) =>
                      toast.error(
                        e.message === "forbidden"
                          ? "Seu papel não permite esta ação."
                          : "Não foi possível marcar para renegociar.",
                      ),
                  },
                );
              }}
            >
              Marcar para renegociar
            </Button>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={chain.isLoading}
            density="compact"
            searchPlaceholder="Buscar por CNPJ ou nome…"
            emptyTitle="Nenhuma contraparte"
            emptyHint="Ajuste os filtros ou ingira notas fiscais para popular a carteira."
            exportName={`carteira-${role}`}
          />
        </div>
      </section>

      <PartySheet
        tenantId={tenantId}
        role={role}
        row={openParty}
        onClose={() => setOpenParty(null)}
      />
    </div>
  );
}

function PartySheet({
  tenantId,
  role,
  row,
  onClose,
}: {
  tenantId: string;
  role: PartyRole;
  row: ChainRow | null;
  onClose: () => void;
}) {
  const detail = useCounterpartyDetail(tenantId, row?.id ?? null);
  const setRegime = useSetRegimeManual(tenantId);
  const [newRegime, setNewRegime] = useState<RegimeKind | "">("");
  const [reason, setReason] = useState("");

  if (!row) return null;
  const party = detail.data?.party;
  const sens = sensitivity(row, role);

  return (
    <SideSheet
      open={Boolean(row)}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setNewRegime("");
          setReason("");
        }
      }}
      title={row.name || formatCnpj(row.cnpj)}
      description={formatCnpj(row.cnpj)}
    >
      <Tabs defaultValue="resumo">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="notas">Notas</TabsTrigger>
          <TabsTrigger value="sens">Sensib.</TabsTrigger>
          <TabsTrigger value="alertas">Alertas</TabsTrigger>
        </TabsList>

        <TabsContent value="resumo" className="space-y-4 pt-4">
          <dl className="space-y-2 text-sm">
            <Row label="Regime atual" value={<RegimeBadge regime={row.regime} />} />
            <Row label="Fonte do regime" value={party?.regime_source ?? "—"} />
            <Row
              label="Verificado em"
              value={
                party?.regime_checked_at
                  ? new Date(party.regime_checked_at).toLocaleDateString("pt-BR")
                  : "—"
              }
            />
            <Row label={role === "customer" ? "Receita 12m" : "Compras 12m"} value={formatCents(row.total_cents)} />
            <Row label="Participação" value={formatPct(row.share_pct)} />
          </dl>

          <div className="space-y-3 rounded-lg border border-border p-3">
            <p className="text-xs font-medium">Editar regime manualmente</p>
            <Select value={newRegime} onValueChange={(v) => setNewRegime(v as RegimeKind)}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Novo regime" />
              </SelectTrigger>
              <SelectContent>
                {REGIMES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {REGIME_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Motivo (obrigatório — vai para a auditoria)"
              rows={2}
            />
            <Button
              size="sm"
              disabled={!newRegime || reason.trim().length < 5 || setRegime.isPending}
              onClick={() => {
                setRegime.mutate(
                  { partyId: row.id, regime: newRegime as RegimeKind, reason: reason.trim() },
                  {
                    onSuccess: () => {
                      toast.success("Regime atualizado e registrado na auditoria");
                      setReason("");
                      setNewRegime("");
                    },
                    onError: (e) =>
                      toast.error(
                        e.message === "forbidden"
                          ? "Seu papel não permite alterar o regime."
                          : "Não foi possível alterar o regime.",
                      ),
                  },
                );
              }}
            >
              Salvar regime
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="notas" className="pt-4">
          {detail.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (detail.data?.invoices_12m.length ?? 0) === 0 ? (
            <EmptyState title="Sem notas nos últimos 12 meses" />
          ) : (
            <ul className="divide-y divide-border text-sm">
              {detail.data?.invoices_12m.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="font-mono text-xs">
                      {new Date(inv.issued_at).toLocaleDateString("pt-BR")} ·{" "}
                      {inv.direction === "out" ? "saída" : "entrada"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Crédito {formatCents(inv.credit_cents ?? 0)}
                    </p>
                  </div>
                  <MoneyText cents={inv.total_cents} className="text-sm" />
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="sens" className="space-y-3 pt-4">
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm font-medium">{sens.headline}</p>
            <p className="mt-1 text-xs text-muted-foreground">{sens.detail}</p>
            <p className="mt-3 font-mono text-xl text-flow-out">{formatCents(sens.amountCents)}</p>
            <p className="text-[11px] text-muted-foreground">estimativa anual</p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Estimativa baseada no crédito transferido informado ({formatPct(row.credit_transfer_pct)}) e
            no volume dos últimos 12 meses.
          </p>
        </TabsContent>

        <TabsContent value="alertas" className="pt-4">
          {detail.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (detail.data?.open_alerts ?? 0) === 0 ? (
            <EmptyState title="Nenhum alerta aberto" hint="Esta contraparte está sem pendências." />
          ) : (
            <p className="text-sm">
              <span className="font-mono text-lg">{detail.data?.open_alerts}</span> alerta(s) aberto(s)
              para este CNPJ.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </SideSheet>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

/**
 * "Classificar contrapartes": busca no cadastro público os CNPJs sem cache
 * (ou vencidos) e aplica regime + crédito transferido na carteira.
 */
function ClassifyCounterpartiesButton({ tenantId }: { tenantId: string }) {
  const classify = useClassifyCounterparties(tenantId);
  const { progress } = classify;
  const running = classify.isPending;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={running}
        onClick={() =>
          classify.mutate(undefined, {
            onSuccess: (r) => {
              if (r.total === 0) {
                toast.success("Carteira já classificada — nenhum CNPJ pendente.");
                return;
              }
              toast.success(
                `${r.ok} de ${r.total} CNPJ(s) encontrados na Receita · ${r.updated} contraparte(s) atualizada(s)` +
                  (r.regimeChanged ? ` · ${r.regimeChanged} mudança(s) de regime` : "") +
                  (r.notFound ? ` · ${r.notFound} sem registro público` : ""),
              );
            },
            onError: (e) =>
              toast.error(
                e.message === "forbidden"
                  ? "Seu papel não permite classificar contrapartes."
                  : "Falha ao classificar contrapartes.",
              ),
          })
        }
      >
        {running ? (
          <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="mr-2 size-4" aria-hidden />
        )}
        Classificar contrapartes
      </Button>
      {running && (
        <span className="text-[11px] text-muted-foreground">
          {progress.phase === "listing" && "Levantando CNPJs pendentes…"}
          {progress.phase === "fetching" &&
            `Consultando Receita ${progress.fetched}/${progress.total}…`}
          {progress.phase === "applying" && "Aplicando na carteira…"}
        </span>
      )}
      {!running && progress.phase === "done" && progress.total > 0 && (
        <span className="text-[11px] text-muted-foreground">
          {progress.updated} atualizada(s) · {progress.notFound} sem registro
        </span>
      )}
    </div>
  );
}

/** Dados cadastrais da contraparte no painel lateral, com a data da consulta. */
function CounterpartyRegistry({ cnpj }: { cnpj: string }) {
  const { data, isLoading } = useCnpjRecord(cnpj);

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!data?.found) {
    return (
      <p className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted-foreground">
        Sem dados do cadastro público para este CNPJ. Use “Classificar contrapartes” para consultar a
        Receita.
      </p>
    );
  }
  return <RegistrySummary record={data} />;
}
