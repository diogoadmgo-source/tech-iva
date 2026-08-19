import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Calculator, History, ListChecks, Scale, SlidersHorizontal, Wallet } from "lucide-react";
import { toast } from "sonner";

import { RegimeBadge } from "@/components/techiva/badges";
import { ComparisonCard } from "@/components/techiva/cards";
import { DiffJson } from "@/components/techiva/diff-json";
import { EmptyState, ErrorState, NoPermissionState } from "@/components/techiva/empty-state";
import { KpiCard } from "@/components/techiva/metrics";
import { formatCents, formatPct, MoneyText } from "@/components/techiva/money";
import { Page, PageHeader, Panel, Rise } from "@/components/techiva/page";
import { SideSheet } from "@/components/techiva/side-sheet";
import { Stepper } from "@/components/techiva/stepper";
import { useChartColors } from "@/components/techiva/use-chart-colors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  daysUntil,
  inputsDiff,
  INPUT_LABELS,
  useRunSimulation,
  useShareSimulation,
  useSimulations,
  useWalletSummary,
  type RegimeInputs,
  type RegimeSimulation,
} from "@/lib/regime";
import { useShellData } from "@/lib/tenant-shell-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/t/$tenantId/regime")({
  component: RegimeScreen,
  head: () => ({
    meta: [
      { title: "Regime — Simples tradicional × híbrido | TECH-IVA" },
      {
        name: "description",
        content:
          "Simule Simples Nacional tradicional contra o híbrido de 2027 a 2033: carga efetiva, crédito transferido a clientes e custo de conformidade.",
      },
      { property: "og:title", content: "Regime — Simples tradicional × híbrido | TECH-IVA" },
      {
        property: "og:description",
        content: "Compare tradicional e híbrido com o número da sua carteira e a janela de opção.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const STEPS = ["Confirmar carteira", "Premissas", "Rodar"];

function RegimeScreen() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const wallet = useWalletSummary(tenantId);
  const history = useSimulations(tenantId);
  const run = useRunSimulation(tenantId);
  const share = useShareSimulation(tenantId);
  const colors = useChartColors();

  const [step, setStep] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState<RegimeSimulation | null>(null);
  const [premises, setPremises] = useState<RegimeInputs | null>(null);

  const w = wallet.data;
  const inputs: RegimeInputs =
    premises ??
    ({
      margin_pct: 20,
      b2b_share_pct: w ? Math.round(w.b2b_share_pct) : 50,
      growth_pct: 0,
      swap_simples_suppliers: false,
      base_year: 2027,
    } satisfies RegimeInputs);

  const setInput = <K extends keyof RegimeInputs>(key: K, value: RegimeInputs[K]) =>
    setPremises({ ...inputs, [key]: value });

  const list = history.data ?? [];
  const current = useMemo(
    () => list.find((s) => s.id === selectedId) ?? list[0] ?? null,
    [list, selectedId],
  );

  const kind = shell.data?.tenant.kind;
  if (kind && kind !== "company" && kind !== "unit") {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <NoPermissionState hint="A simulação de regime existe para empresas e filiais. Selecione uma empresa no seletor de organização." />
      </div>
    );
  }

  if (wallet.error) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <ErrorState
          message="Não foi possível carregar o resumo da carteira."
          onRetry={() => void wallet.refetch()}
        />
      </div>
    );
  }

  const chart = (current?.results.years ?? []).map((y) => ({
    year: String(y.year),
    Tradicional: y.traditional_cents / 100,
    Híbrido: y.hybrid_cents / 100,
  }));

  const nextWindow = current?.next_window ?? w?.next_window ?? null;
  const countdown = daysUntil(nextWindow);

  async function onRun() {
    try {
      const id = await run.mutateAsync(inputs);
      setSelectedId(id);
      toast.success("Simulação concluída");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao rodar a simulação");
    }
  }

  return (
    <Page className="max-w-6xl">
      <PageHeader
        eyebrow="regime"
        title="Regime tributário"
        helpTitle="Como ler esta tela"
        help={
          <p>
            Simples tradicional × híbrido de 2027 a 2033, com a carteira real da empresa. Confirme
            a carteira, ajuste as premissas e rode a comparação.
          </p>
        }
      />

      <Rise index={1}>
        <Stepper steps={STEPS} current={step} />
      </Rise>

      {/* -------------------------------------------------- passo 1 */}
      {step === 0 && (
        <Rise index={2}>
          <Panel
            title="Confirmar carteira (últimos 12 meses)"
            icon={Wallet}
            actions={
              <Link
                to="/t/$tenantId/chain"
                params={{ tenantId }}
                className="text-xs font-medium text-primary hover:underline"
              >
                Corrigir regimes na Carteira
              </Link>
            }
          >
            {wallet.isLoading ? (
              <div className="grid gap-3 sm:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20" />
                ))}
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <KpiCard label="Receita 12m" value={formatCents(w?.revenue_cents ?? 0)} />
                  <KpiCard label="Receita B2B" value={formatPct(w?.b2b_share_pct ?? 0)} hint={formatCents(w?.b2b_cents ?? 0)} />
                  <KpiCard
                    label="Receita com PJ em regime regular"
                    value={formatPct(w?.pj_regular_share_pct ?? 0)}
                  />
                  <KpiCard
                    label="Compras de fornecedores do Simples"
                    value={formatPct(w?.simples_supplier_share_pct ?? 0)}
                    hint={`Crédito de entrada: ${formatCents(w?.input_credit_cents ?? 0)}`}
                  />
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      ["Clientes por regime", w?.customers_by_regime ?? []],
                      ["Fornecedores por regime", w?.suppliers_by_regime ?? []],
                    ] as const
                  ).map(([title, rows]) => (
                    <div key={title} className="rounded-lg border border-border/60 bg-surface-2 p-3">
                      <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
                      {rows.length === 0 ? (
                        <p className="mt-2 text-xs text-muted-foreground">Sem dados ainda.</p>
                      ) : (
                        <ul className="mt-2 space-y-1.5">
                          {rows.map((r) => (
                            <li key={r.regime} className="flex items-center justify-between gap-3 text-sm">
                              <span className="flex items-center gap-2">
                                <RegimeBadge regime={r.regime} />
                                <span className="text-xs text-muted-foreground">{r.count}</span>
                              </span>
                              <MoneyText cents={r.volume_cents} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>

                {(w?.unknown_regime_count ?? 0) > 0 && (
                  <p className="mt-4 rounded-lg border border-flow-out/40 bg-flow-out/10 p-3 text-xs text-foreground">
                    {w?.unknown_regime_count} contraparte(s) com regime desconhecido — o resultado
                    sai com confiança parcial até classificá-las.
                  </p>
                )}
              </>
            )}

            <div className="mt-4 flex justify-end">
              <Button onClick={() => setStep(1)}>Confirmar e seguir</Button>
            </div>
          </Panel>
        </Rise>
      )}

      {/* -------------------------------------------------- passo 2 */}
      {step === 1 && (
        <Rise index={2}>
          <Panel title="Premissas" icon={SlidersHorizontal}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="margin">Margem bruta (%)</Label>
                <Input
                  id="margin"
                  type="number"
                  min={0}
                  max={90}
                  value={inputs.margin_pct}
                  onChange={(e) => setInput("margin_pct", Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="b2b">Mix B2B (%)</Label>
                  <InfoHintInline>
                    Sugerido pelos dados: {formatPct(w?.b2b_share_pct ?? 0)}
                  </InfoHintInline>
                </div>
                <Input
                  id="b2b"
                  type="number"
                  min={0}
                  max={100}
                  value={inputs.b2b_share_pct}
                  onChange={(e) => setInput("b2b_share_pct", Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="growth">Crescimento anual (%)</Label>
                <Input
                  id="growth"
                  type="number"
                  min={-50}
                  max={100}
                  value={inputs.growth_pct}
                  onChange={(e) => setInput("growth_pct", Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="year">Ano-base</Label>
                <Input
                  id="year"
                  type="number"
                  min={2027}
                  max={2033}
                  value={inputs.base_year}
                  onChange={(e) => setInput("base_year", Number(e.target.value))}
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-surface-2 p-3">
              <div className="flex items-center gap-2">
                <Label htmlFor="swap" className="text-sm">
                  Trocar fornecedores do Simples por regulares?
                </Label>
                <InfoHintInline>
                  Recupera crédito de entrada hoje perdido (
                  {formatPct(w?.simples_supplier_share_pct ?? 0)} das compras).
                </InfoHintInline>
              </div>
              <Switch
                id="swap"
                checked={inputs.swap_simples_suppliers}
                onCheckedChange={(v) => setInput("swap_simples_suppliers", v)}
              />
            </div>

            <div className="mt-4 flex justify-between">
              <Button variant="ghost" onClick={() => setStep(0)}>
                Voltar
              </Button>
              <Button onClick={() => setStep(2)}>Seguir para rodar</Button>
            </div>
          </Panel>
        </Rise>
      )}

      {/* -------------------------------------------------- passo 3 */}
      {step === 2 && (
        <Rise index={2}>
          <Panel
            title="Rodar simulação"
            icon={Calculator}
            actions={
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                  Ajustar premissas
                </Button>
                <Button size="sm" onClick={() => void onRun()} disabled={run.isPending}>
                  {run.isPending ? "Rodando…" : "Rodar simulação"}
                </Button>
              </div>
            }
          >
            {run.isPending && (
              <div className="rounded-lg border border-border/60 bg-surface-2 p-3 text-sm text-muted-foreground">
                Calculando carga 2027–2033 nos dois cenários…
              </div>
            )}
            {run.isError && (
              <ErrorState message={run.error instanceof Error ? run.error.message : "Falha na simulação."} />
            )}
            {!run.isPending && !run.isError && (
              <p className="text-sm text-muted-foreground">
                Pronto para rodar com as premissas definidas.
              </p>
            )}
          </Panel>
        </Rise>
      )}

      {/* -------------------------------------------------- resultado */}
      {history.isLoading ? (
        <Skeleton className="h-64" />
      ) : !current ? (
        <EmptyState
          title="Nenhuma simulação ainda"
          hint="Confirme a carteira, ajuste as premissas e rode a primeira comparação."
        />
      ) : (
        <Rise index={3} className="space-y-4">
          <div className="rounded-xl border border-primary/40 bg-primary/10 p-4">
            <p className="text-sm font-medium">{current.recommendation}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Rodada em {new Date(current.run_at).toLocaleString("pt-BR")} · confiança{" "}
              {current.results.confidence}
            </p>
          </div>

          <ComparisonCard
            winner={
              current.results.winner === "hybrid"
                ? "right"
                : current.results.winner === "traditional"
                  ? "left"
                  : undefined
            }
            left={{
              title: "Simples tradicional",
              rows: [
                { label: "Carga 2027", value: formatCents(current.results.traditional.load_2027_cents) },
                { label: "Carga 2033", value: formatCents(current.results.traditional.load_2033_cents) },
                { label: "Total 2027–2033", value: formatCents(current.results.traditional.total_cents) },
                {
                  label: "Crédito transferido a clientes",
                  value: formatCents(current.results.traditional.credit_transferred_cents),
                },
                {
                  label: "Custo de conformidade/ano",
                  value: formatCents(current.results.traditional.compliance_cost_cents),
                },
              ],
            }}
            right={{
              title: "Simples híbrido",
              rows: [
                { label: "Carga 2027", value: formatCents(current.results.hybrid.load_2027_cents) },
                { label: "Carga 2033", value: formatCents(current.results.hybrid.load_2033_cents) },
                { label: "Total 2027–2033", value: formatCents(current.results.hybrid.total_cents) },
                {
                  label: "Crédito transferido a clientes",
                  value: formatCents(current.results.hybrid.credit_transferred_cents),
                },
                {
                  label: "Custo de conformidade/ano",
                  value: formatCents(current.results.hybrid.compliance_cost_cents),
                },
              ],
            }}
          />

          <Panel title="Carga por ano (2027–2033)" icon={Scale}>
            <div className="h-72 min-w-0 overflow-x-auto">
              <div className="h-full min-w-[420px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart}>
                    <CartesianGrid stroke={colors.border} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="year" stroke={colors.muted} fontSize={12} />
                    <YAxis stroke={colors.muted} fontSize={12} width={80} />
                    <Tooltip
                      formatter={(v: number) =>
                        v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                      }
                      contentStyle={{ background: "var(--surface-2)", border: `1px solid ${colors.border}` }}
                    />
                    <Legend />
                    <Bar dataKey="Tradicional" fill={colors.flowOut} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Híbrido" fill={colors.primary} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel
              title="Próxima janela de opção"
              className={cn(
                countdown !== null && countdown <= 60 && "border-flow-out/50 bg-flow-out/10",
              )}
              help={<p>O silêncio mantém o tradicional após esta data.</p>}
            >
              <p className="font-mono text-3xl tabular-nums">
                {countdown !== null ? `${countdown} dias` : "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {nextWindow ? new Date(`${nextWindow}T00:00:00`).toLocaleDateString("pt-BR") : "sem data"}
              </p>
            </Panel>

            <Panel title="Ações" icon={ListChecks} className="lg:col-span-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (current.report_path) {
                      void supabaseReport(current.report_path);
                    } else {
                      window.print();
                    }
                  }}
                >
                  Gerar relatório para o contador
                </Button>
                <Button
                  variant="secondary"
                  disabled={share.isPending}
                  onClick={async () => {
                    try {
                      await share.mutateAsync({ id: current.id });
                      toast.success("Simulação compartilhada com o canal");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Falha ao compartilhar");
                    }
                  }}
                >
                  Compartilhar com o canal
                </Button>
                <Button variant="ghost" onClick={() => setStep(1)}>
                  Nova simulação
                </Button>
              </div>
            </Panel>
          </div>

          {/* histórico */}
          <Panel title="Histórico de simulações" icon={History}>
            <ul className="divide-y divide-border/60">
              {list.map((sim, i) => {
                const diff = inputsDiff(sim.inputs, list[i + 1]?.inputs);
                return (
                  <li key={sim.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm">
                        {new Date(sim.run_at).toLocaleString("pt-BR")} ·{" "}
                        <span className="font-mono tabular-nums">{formatPct(sim.results.delta_pct)}</span>{" "}
                        a favor do híbrido
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {diff.length === 0
                          ? "Mesmas premissas da anterior"
                          : diff
                              .map(
                                (d) =>
                                  `${INPUT_LABELS[d.key] ?? d.key}: ${String(d.from)} → ${String(d.to)}`,
                              )
                              .join(" · ")}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setSelectedId(sim.id)}>
                        Ver
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(sim)}>
                        Premissas
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </Rise>
      )}

      <SideSheet
        open={historyOpen !== null}
        onOpenChange={(o) => !o && setHistoryOpen(null)}
        title="Premissas da simulação"
        description={historyOpen ? new Date(historyOpen.run_at).toLocaleString("pt-BR") : undefined}
      >
        {historyOpen && <DiffJson before={null} after={historyOpen.inputs} />}
      </SideSheet>
    </Page>
  );
}

function InfoHintInline({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] text-muted-foreground">{children}</span>;
}

/** Abre o PDF gravado em Storage (reports/) com URL assinada. */
async function supabaseReport(path: string) {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.storage.from("reports").createSignedUrl(path, 300);
  if (error || !data) {
    toast.error("Não foi possível abrir o relatório.");
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener");
}
