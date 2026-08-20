import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Download, Loader2, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";

import { InfoHint } from "@/components/techiva/info-hint";
import { FormError } from "@/components/auth/auth-shell";
import { DataTable } from "@/components/techiva/data-table";
import { EmptyState, ErrorState } from "@/components/techiva/empty-state";
import { Kpi } from "@/components/techiva/kpi";
import { Page, PageHeader, Panel, Rise } from "@/components/techiva/page";
import { formatCents, formatPct, MoneyText } from "@/components/techiva/money";
import { RegimeBadge } from "@/components/techiva/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { authErrorMessage } from "@/lib/auth";
import {
  FISCAL_YEARS,
  downloadCsv,
  scenarioCsv,
  usePriceCustomers,
  usePriceScenarioDetail,
  usePriceScenarios,
  usePricingMutations,
  type PriceLine,
} from "@/lib/pricing";
import { useShellData } from "@/lib/tenant-shell-data";

export const Route = createFileRoute("/_authenticated/t/$tenantId/price")({
  head: () => ({
    meta: [
      { title: "Preço com IVA · TECH-IVA" },
      {
        name: "description",
        content:
          "Piso e preço-alvo por produto e por cliente na transição do IVA, com margem alvo, crédito na entrada e impacto agregado.",
      },
      { property: "og:title", content: "Preço com IVA · TECH-IVA" },
      {
        property: "og:description",
        content: "Cenários de precificação com piso, alvo e alerta de itens abaixo do piso.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PricePage,
});

const STATUS_LABEL: Record<string, string> = {
  draft: "rascunho",
  approved: "aprovado",
  archived: "arquivado",
};

function PricePage() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const scenarios = usePriceScenarios(tenantId);
  // Cenário "por cliente" é UM cliente por vez: 5 mil SKUs × 200 clientes seriam
  // 1 milhão de linhas. O seletor é busca no servidor, não a carteira inteira.
  const [customerSearch, setCustomerSearch] = useState("");
  const customers = usePriceCustomers(tenantId, customerSearch);
  const { createScenario, recompute, approve, updateProduct } = usePricingMutations(tenantId);

  const [scenarioId, setScenarioId] = useState<string>("");
  const [compareId, setCompareId] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draftName, setDraftName] = useState("");
  const [draftYear, setDraftYear] = useState("2027");
  const [draftMargin, setDraftMargin] = useState("25");
  const [draftVar, setDraftVar] = useState("5");
  const [draftCustomer, setDraftCustomer] = useState("all");

  useEffect(() => {
    const list = scenarios.data ?? [];
    if (!scenarioId && list.length > 0) setScenarioId(list[0]!.id);
  }, [scenarios.data, scenarioId]);

  const detail = usePriceScenarioDetail(scenarioId || null);
  const compare = usePriceScenarioDetail(compareId || null);

  const lines = detail.data?.lines ?? [];
  const totals = detail.data?.totals;
  const scenario = detail.data?.scenario;
  const editable = scenario?.status === "draft";

  const compareByProduct = useMemo(() => {
    const map = new Map<string, PriceLine>();
    for (const l of compare.data?.lines ?? []) map.set(l.product_id, l);
    return map;
  }, [compare.data]);

  async function submitCreate() {
    setError(null);
    const margin = Number(draftMargin.replace(",", "."));
    const varExp = Number(draftVar.replace(",", "."));
    if (!Number.isFinite(margin) || margin < 0 || margin >= 90) {
      setError("Margem alvo deve estar entre 0 e 89%.");
      return;
    }
    if (!Number.isFinite(varExp) || varExp < 0 || varExp > 50) {
      setError("Despesas variáveis devem estar entre 0 e 50%.");
      return;
    }
    try {
      const id = await createScenario.mutateAsync({
        name: draftName,
        targetMargin: margin,
        fiscalYear: Number(draftYear),
        counterpartyId: draftCustomer === "all" ? null : draftCustomer,
        varExpPct: varExp / 100,
      });
      setScenarioId(id);
      setCreateOpen(false);
      toast.success("Cenário calculado.");
    } catch (err) {
      setError(authErrorMessage(err));
    }
  }

  async function saveInline(line: PriceLine, field: "cost" | "current", value: string) {
    const parsed = Number(value.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error("Valor inválido.");
      return;
    }
    const cents = Math.round(parsed * 100);
    const currentCents = field === "cost" ? line.cost_cents : line.current_price_cents;
    if (cents === currentCents) return;
    try {
      await updateProduct.mutateAsync({
        productId: line.product_id,
        scenarioId,
        costCents: field === "cost" ? cents : null,
        currentPriceCents: field === "current" ? cents : null,
      });
    } catch (err) {
      toast.error(authErrorMessage(err));
    }
  }

  const columns = useMemo<ColumnDef<PriceLine, unknown>[]>(() => {
    const base: ColumnDef<PriceLine, unknown>[] = [
      {
        accessorKey: "sku",
        header: "SKU",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{row.original.sku ?? "—"}</span>
        ),
      },
      { accessorKey: "name", header: "Produto" },
      {
        accessorKey: "ncm",
        header: "NCM",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{row.original.ncm ?? "—"}</span>
        ),
      },
      {
        accessorKey: "cost_cents",
        header: "Custo",
        cell: ({ row }) =>
          editable ? (
            <InlineMoney
              cents={row.original.cost_cents}
              onCommit={(v) => void saveInline(row.original, "cost", v)}
            />
          ) : (
            <MoneyText cents={row.original.cost_cents} />
          ),
      },
      {
        accessorKey: "input_credit_cents",
        header: "Crédito entrada",
        cell: ({ row }) => <MoneyText cents={row.original.input_credit_cents} />,
      },
      {
        accessorKey: "current_price_cents",
        header: "Preço atual",
        cell: ({ row }) =>
          editable ? (
            <InlineMoney
              cents={row.original.current_price_cents}
              onCommit={(v) => void saveInline(row.original, "current", v)}
            />
          ) : (
            <MoneyText cents={row.original.current_price_cents} />
          ),
      },
      {
        accessorKey: "floor_price_cents",
        header: "Piso",
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            <MoneyText cents={row.original.floor_price_cents} />
            {row.original.below_floor && (
              <AlertTriangle className="size-3.5 text-flow-out" aria-label="abaixo do piso" />
            )}
          </span>
        ),
      },
      {
        accessorKey: "target_price_cents",
        header: "Alvo",
        cell: ({ row }) => (
          <MoneyText cents={row.original.target_price_cents} className="font-semibold" />
        ),
      },
      {
        accessorKey: "delta_pct",
        header: "Δ%",
        cell: ({ row }) => {
          const d = row.original.delta_pct;
          if (d === null) return <span className="text-muted-foreground">—</span>;
          return (
            <span
              className={
                d > 0 ? "font-mono tabular text-flow-in" : "font-mono tabular text-muted-foreground"
              }
            >
              {formatPct(d)}
            </span>
          );
        },
      },
    ];

    if (compareId && compareId !== scenarioId) {
      base.push({
        id: "diff",
        header: "Δ vs. comparado",
        cell: ({ row }) => {
          const other = compareByProduct.get(row.original.product_id);
          if (!other) return <span className="text-muted-foreground">novo</span>;
          const diff = row.original.target_price_cents - other.target_price_cents;
          if (diff === 0) return <span className="text-muted-foreground">=</span>;
          return <MoneyText cents={diff} sign />;
        },
      });
    }

    return base;
  }, [editable, compareId, scenarioId, compareByProduct]);

  if (scenarios.isError) {
    return (
      <Page>
        <ErrorState message={authErrorMessage(scenarios.error)} onRetry={() => void scenarios.refetch()} />
      </Page>
    );
  }

  const scenarioList = scenarios.data ?? [];

  return (
    <Page className="max-w-7xl">
      <PageHeader
        eyebrow="ferramentas · precificação"
        title="Preço com IVA"
        help={
          <p>
            Piso e preço-alvo por produto de <strong>{shell.data?.tenant.name ?? "…"}</strong>,
            considerando o crédito na entrada e a alíquota do ano fiscal. O piso sobe com a
            alíquota do ano fiscal, com despesas variáveis maiores e com clientes que aproveitam
            menos crédito (Simples/MEI); a margem alvo altera só o preço-alvo.
          </p>
        }
      />

      <Rise index={1}>
        <Panel interactive={false}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1 space-y-2">
              <Label>Cenário</Label>
              <Select value={scenarioId} onValueChange={setScenarioId}>
                <SelectTrigger className="field focus-glow">
                  <SelectValue placeholder="Nenhum cenário" />
                </SelectTrigger>
                <SelectContent>
                  {scenarioList.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} · {s.fiscal_year} · {STATUS_LABEL[s.status] ?? s.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="min-w-56 flex-1 space-y-2">
              <Label>Comparar com</Label>
              <Select value={compareId || "none"} onValueChange={(v) => setCompareId(v === "none" ? "" : v)}>
                <SelectTrigger className="field focus-glow">
                  <SelectValue placeholder="Sem comparação" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem comparação</SelectItem>
                  {scenarioList
                    .filter((s) => s.id !== scenarioId)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} · {s.fiscal_year}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {scenario ? (
                <Badge variant={scenario.status === "approved" ? "secondary" : "outline"}>
                  {STATUS_LABEL[scenario.status] ?? scenario.status} · IVA{" "}
                  {formatPct(scenario.iva_rate * 100)} · margem {formatPct(scenario.target_margin)}
                </Badge>
              ) : null}
              <Button variant="outline" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 size-4" /> Novo cenário
              </Button>
              <Button
                className="cta-lift"
                disabled={!scenarioId || !editable || recompute.isPending}
                onClick={async () => {
                  try {
                    await recompute.mutateAsync(scenarioId);
                    toast.success("Cenário recalculado.");
                  } catch (err) {
                    toast.error(authErrorMessage(err));
                  }
                }}
              >
                {recompute.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 size-4" />
                )}
                Recalcular
              </Button>
              <Button
                variant="outline"
                disabled={!detail.data || lines.length === 0}
                onClick={() => {
                  if (!detail.data) return;
                  downloadCsv(
                    `preco-${detail.data.scenario.fiscal_year}-${detail.data.scenario.name}.csv`.replace(
                      /\s+/g,
                      "-",
                    ),
                    scenarioCsv(detail.data),
                  );
                }}
              >
                <Download className="mr-2 size-4" /> Exportar ERP
              </Button>
              <Button disabled={!scenario || scenario.status !== "draft"} onClick={() => setApproveOpen(true)}>
                <Check className="mr-2 size-4" /> Aprovar
              </Button>
            </div>
          </div>
        </Panel>
      </Rise>

      {!scenarioId && !scenarios.isLoading ? (
        <Rise index={2}>
          <EmptyState
            title="Nenhum cenário de preço"
            hint="Crie um cenário informando a margem alvo e o ano fiscal para calcular piso e preço-alvo dos produtos."
          />
        </Rise>
      ) : null}

      {scenarioId ? (
        <>
          {/* resultado principal + memória de cálculo, no mesmo padrão do simulador */}
          <Rise index={2}>
            <Panel
              className="panel-hero"
              title="Resultado do cenário"
              help={
                <p>
                  O número grande é a receita do cenário no preço-alvo. A memória de cálculo abaixo
                  mostra as premissas que produziram piso e alvo — ano fiscal, margem, despesas
                  variáveis e crédito na entrada.
                </p>
              }
            >
              {detail.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Receita a preço-alvo</p>
                    <p className="mt-1 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
                      <MoneyText cents={totals?.revenue_target_cents ?? 0} />
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Δ médio{" "}
                      <span className="font-mono tabular text-foreground">
                        {formatPct(totals?.avg_delta_pct ?? 0)}
                      </span>{" "}
                      sobre o preço atual ·{" "}
                      <span className="font-mono tabular text-foreground">
                        {totals?.lines ?? 0}
                      </span>{" "}
                      linha(s) no cenário
                    </p>
                  </div>

                  <details className="rounded-xl border border-border/60 bg-surface-1/60 p-4">
                    <summary className="cursor-pointer text-sm font-semibold">
                      Memória de cálculo e premissas
                    </summary>
                    <dl className="mt-3 space-y-2 text-xs">
                      <Row label="Ano fiscal" value={String(scenario?.fiscal_year ?? "—")} />
                      <Row
                        label="Alíquota efetiva IBS+CBS do ano"
                        value={formatPct((scenario?.iva_rate ?? 0) * 100)}
                      />
                      <Row label="Margem alvo" value={formatPct(scenario?.target_margin ?? 0)} />
                      <Row
                        label="Despesas variáveis"
                        value={formatPct(
                          Number(scenario?.assumptions["var_exp_pct"] ?? 0) * 100,
                        )}
                      />
                      <Row
                        label="Escopo"
                        value={
                          scenario?.assumptions["counterparty_id"]
                            ? (lines[0]?.counterparty_name ?? "cliente selecionado")
                            : "Geral (crédito integral na entrada)"
                        }
                      />
                      <Row
                        label="Receita a preço atual"
                        value={formatCents(totals?.revenue_current_cents ?? 0)}
                      />
                      <Row
                        label="Margem média no alvo"
                        value={formatPct(totals?.avg_margin_pct ?? 0)}
                      />
                      <Row label="Itens abaixo do piso" value={String(totals?.below_floor ?? 0)} />
                    </dl>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Piso = custo líquido do crédito na entrada, recomposto pela alíquota do ano e
                      pelas despesas variáveis. O alvo aplica a margem sobre esse piso.
                    </p>
                  </details>
                </div>
              )}
            </Panel>
          </Rise>

          <Rise index={3} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

            <Kpi
              label="Receita a preço atual"
              valueCents={totals?.revenue_current_cents ?? 0}
              loading={detail.isLoading}
              hint="Soma dos preços atuais das linhas"
            />
            <Kpi
              label="Receita a preço-alvo"
              valueCents={totals?.revenue_target_cents ?? 0}
              loading={detail.isLoading}
              hint={`Δ médio ${formatPct(totals?.avg_delta_pct ?? 0)}`}
            />
            <Kpi
              label="Margem média no alvo"
              value={formatPct(totals?.avg_margin_pct ?? 0)}
              loading={detail.isLoading}
            />
            <Kpi
              label="Itens abaixo do piso"
              value={String(totals?.below_floor ?? 0)}
              loading={detail.isLoading}
              hint={
                (totals?.below_floor ?? 0) === 0
                  ? `Nenhum item abaixo do piso neste cenário · ${totals?.lines ?? 0} linhas avaliadas`
                  : `${totals?.lines ?? 0} linhas no cenário`
              }
            />
          </Rise>

          <Rise index={4} className="overflow-x-auto">
            {detail.isError ? (
              <ErrorState
                message={authErrorMessage(detail.error)}
                onRetry={() => void detail.refetch()}
              />
            ) : (
              <DataTable
                columns={columns}
                data={lines}
                loading={detail.isLoading}
                searchPlaceholder="Buscar SKU, produto ou NCM…"
                emptyTitle="Nenhuma linha calculada"
                emptyHint="Cadastre produtos com custo e preço atual para o cenário gerar piso e alvo."
                density="compact"
              />
            )}
          </Rise>

          <Rise index={5}>
            <p className="text-xs text-muted-foreground">
              {scenario?.assumptions["counterparty_id"] ? (
                <>
                  Cenário por cliente:{" "}
                  <span className="text-foreground">
                    {lines[0]?.counterparty_name ?? "cliente selecionado"}
                  </span>{" "}
                  — o crédito na entrada é ajustado pelo regime do cliente.
                </>
              ) : (
                "Cenário geral (crédito integral na entrada). Crie um cenário por cliente para ajustar pelo regime dele."
              )}
            </p>
          </Rise>
        </>
      ) : null}

      {scenarios.isLoading ? <Skeleton className="h-32 w-full" /> : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo cenário de preço</DialogTitle>
            <DialogDescription>
              A alíquota efetiva de IBS+CBS vem do ano fiscal escolhido (transição 2027–2033).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="scenario-name">Nome</Label>
              <Input
                id="scenario-name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="field focus-glow"
                placeholder="Ex.: Tabela 2027 — atacado"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Ano fiscal</Label>
                <Select value={draftYear} onValueChange={setDraftYear}>
                  <SelectTrigger className="field focus-glow">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FISCAL_YEARS.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="margin">Margem alvo (%)</Label>
                <Input
                  id="margin"
                  value={draftMargin}
                  onChange={(e) => setDraftMargin(e.target.value)}
                  className="field focus-glow font-mono tabular"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="var-exp">Desp. variáveis (%)</Label>
                <Input
                  id="var-exp"
                  value={draftVar}
                  onChange={(e) => setDraftVar(e.target.value)}
                  className="field focus-glow font-mono tabular"
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>Escopo</Label>
              </div>
              <Select value={draftCustomer} onValueChange={setDraftCustomer}>
                <SelectTrigger className="field focus-glow">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <div className="p-2">
                    <Input
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      placeholder="Buscar cliente por nome ou CNPJ…"
                      className="field focus-glow h-8 text-sm"
                      aria-label="Buscar cliente"
                    />
                  </div>
                  <SelectItem value="all">Geral (preço de tabela, sem cliente)</SelectItem>
                  {(customers.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                Um cliente por vez.
                <InfoHint title="Cenário por cliente">
                  O cenário por cliente calcula um cliente por vez (não a combinação produto ×
                  cliente inteira). Busque o cliente que você quer negociar.
                </InfoHint>
              </p>
              {draftCustomer !== "all" ? (
                <div className="pt-1">
                  <RegimeBadge
                    regime={
                      (customers.data ?? []).find((c) => c.id === draftCustomer)?.regime ??
                      "desconhecido"
                    }
                  />
                </div>
              ) : null}
            </div>
            <FormError message={error} />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button
              className="cta-lift"
              onClick={() => void submitCreate()}
              disabled={createScenario.isPending}
            >
              {createScenario.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Calcular cenário
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprovar cenário</DialogTitle>
            <DialogDescription>
              O cenário aprovado anterior será arquivado automaticamente. A ação fica registrada na
              auditoria.
            </DialogDescription>
          </DialogHeader>
          <dl className="space-y-2 text-sm">
            <Row label="Cenário" value={scenario?.name ?? "—"} />
            <Row label="Ano fiscal" value={String(scenario?.fiscal_year ?? "—")} />
            <Row label="Margem alvo" value={formatPct(scenario?.target_margin ?? 0)} />
            <Row label="Linhas" value={String(totals?.lines ?? 0)} />
            <Row label="Abaixo do piso" value={String(totals?.below_floor ?? 0)} />
            <Row
              label="Receita no alvo"
              value={formatCents(totals?.revenue_target_cents ?? 0)}
            />
          </dl>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setApproveOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={approve.isPending}
              onClick={async () => {
                try {
                  await approve.mutateAsync(scenarioId);
                  setApproveOpen(false);
                  toast.success("Cenário aprovado.");
                } catch (err) {
                  toast.error(authErrorMessage(err));
                }
              }}
            >
              {approve.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Aprovar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular text-foreground">{value}</dd>
    </div>
  );
}

/** Edição inline em reais; grava no blur ou Enter. */
function InlineMoney({ cents, onCommit }: { cents: number; onCommit: (value: string) => void }) {
  const initial = (cents / 100).toFixed(2).replace(".", ",");
  const [value, setValue] = useState(initial);

  useEffect(() => {
    setValue(initial);
  }, [initial]);

  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="field focus-glow h-7 w-24 px-2 font-mono text-xs tabular"
      aria-label="Valor em reais"
    />
  );
}
