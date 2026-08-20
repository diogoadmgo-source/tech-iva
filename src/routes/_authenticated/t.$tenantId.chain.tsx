import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import { Loader2, Network, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { InfoHint } from "@/components/techiva/info-hint";
import { RegimeBadge, Semaphore, type RegimeKind, type SemaphoreLevel } from "@/components/techiva/badges";
import { DataTable } from "@/components/techiva/data-table";
import { EmptyState, ErrorState, NoPermissionState } from "@/components/techiva/empty-state";
import { CnpjText, formatCents, formatCnpj, formatPct, MoneyText } from "@/components/techiva/money";
import { Kpi } from "@/components/techiva/kpi";
import { Page, PageHeader, Panel, Rise, Segmented } from "@/components/techiva/page";
import { SideSheet } from "@/components/techiva/side-sheet";
import { ItemsList } from "@/components/techiva/rtc";
import { useInvoiceItems } from "@/lib/rtc";
import { useChartColors, useRegimeColors } from "@/components/techiva/use-chart-colors";
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
  const regimeColors = useRegimeColors();

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
        cell: ({ row }) => <CnpjText value={row.original.cnpj} className="text-xs" />,
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
        cell: ({ row }) => <span className="num block">{formatPct(row.original.share_pct)}</span>,
      },
      {
        accessorKey: "total_cents",
        header: isCustomer ? "Receita 12m" : "Compras 12m",
        cell: ({ row }) => (
          <span className="num block">
            <MoneyText cents={row.original.total_cents} />
          </span>
        ),
      },
      {
        accessorKey: "credit_transfer_pct",
        header: isCustomer ? "Crédito transferido" : "Crédito recuperado",
        cell: ({ row }) => (
          <span className="num block">{formatPct(row.original.credit_transfer_pct)}</span>
        ),
      },
      {
        accessorKey: "credit_lost_cents",
        header: isCustomer ? "Impacto crédito integral" : "Crédito perdido/ano",
        cell: ({ row }) => (
          <div className="num">
            <MoneyText cents={row.original.credit_lost_cents} className="text-flow-out" />
            <span className="block text-[11px] text-muted-foreground">
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
      <Page>
        <NoPermissionState hint="A Carteira existe para empresas e filiais. Selecione uma empresa no seletor de organização." />
      </Page>
    );
  }

  if (chain.error) {
    return (
      <Page>
        <ErrorState
          message="Não foi possível carregar o mapa da cadeia."
          onRetry={() => void chain.refetch()}
        />
      </Page>
    );
  }

  const vazio = !chain.isLoading && rows.length === 0;

  const conviteIngestao = (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Button asChild size="sm" className="cta-lift">
        <Link to="/t/$tenantId/onboarding" params={{ tenantId }}>
          Conectar entrada de notas
        </Link>
      </Button>
      <Button asChild size="sm" variant="outline">
        <Link to="/t/$tenantId/validador" params={{ tenantId }}>
          Enviar XML manualmente
        </Link>
      </Button>
    </div>
  );

  return (
    <Page className="max-w-7xl">
      <PageHeader
        eyebrow="empresa · carteira"
        title="Carteira de parceiros"
        help={
          <>
            <p>
              Cada contraparte das suas notas dos últimos 12 meses, agrupada pelo regime tributário
              dela. O regime do parceiro decide quanto crédito de IBS/CBS chega até você — ou quanto
              se perde no caminho.
            </p>
            <p>
              O bloco de concentração mostra o peso de cada regime no seu volume; clique em um
              regime para filtrar a tabela.
            </p>
          </>
        }
        actions={
          <>
            <ClassifyCounterpartiesButton tenantId={tenantId} />
            <Segmented<PartyRole>
              label="Papel da contraparte"
              value={role}
              onChange={(r) => {
                setRole(r);
                setSelectedRegime(null);
              }}
              options={[
                { value: "customer", label: "Clientes" },
                { value: "supplier", label: "Fornecedores" },
              ]}
            />
          </>
        }
      />

      <Rise index={1} className="grid gap-4 sm:grid-cols-3">
        <Kpi
          label={isCustomer ? "Clientes na carteira" : "Fornecedores na carteira"}
          value={<span className="num">{summary.count.toLocaleString("pt-BR")}</span>}
          hint="contrapartes com nota nos últimos 12 meses"
          loading={chain.isLoading}
        />
        <Kpi
          label="Volume em regime regular"
          value={<span className="num">{formatPct(summary.regularPct)}</span>}
          hint="parte do volume com Real ou Presumido — onde o crédito é integral"
          loading={chain.isLoading}
        />
        <Kpi
          label="Crédito perdido por ano"
          valueCents={summary.lost}
          hint="crédito que não chega até você por causa do regime da contraparte"
          loading={chain.isLoading}
        />
      </Rise>

      <Rise index={2} as="section" className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel
            title="Concentração por regime"
            help={
              <p>
                O tamanho de cada bloco é o volume dos últimos 12 meses. A cor identifica o regime —
                a mesma paleta usada nos selos de regime em todo o sistema.
              </p>
            }
            actions={
              selectedRegime ? (
                <Button variant="ghost" size="sm" onClick={() => setSelectedRegime(null)}>
                  Limpar seleção
                </Button>
              ) : null
            }
          >
            <div className="h-[300px]">
              {chain.isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : treemap.length === 0 ? (
                <EmptyState
                  icon={Network}
                  title="Sem notas classificadas ainda"
                  hint="A concentração por regime aparece assim que houver notas dos últimos 12 meses."
                />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <Treemap
                    data={treemap}
                    dataKey="size"
                    stroke={colors.border}
                    fill={colors.primary}
                    isAnimationActive={false}
                    content={<RegimeCell />}
                    onClick={(node: unknown) => {
                      const reg = (node as { regime?: RegimeKind })?.regime;
                      if (reg) setSelectedRegime((cur) => (cur === reg ? null : reg));
                    }}
                  >
                    <Tooltip
                      formatter={(value: number) => formatCents(Number(value))}
                      contentStyle={{
                        background: "var(--surface-2)",
                        border: `1px solid ${colors.border}`,
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                  </Treemap>
                </ResponsiveContainer>
              )}
            </div>

            {treemap.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-border/60 pt-4">
                {treemap.map((t) => (
                  <li key={t.regime} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span
                      aria-hidden
                      className="size-2.5 rounded-sm"
                      style={{ background: regimeColors[t.regime] }}
                    />
                    {t.name}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Filtros"
            help={<p>Os filtros valem para a tabela ao lado e para a ação em lote.</p>}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs text-muted-foreground">Regime</Label>
                <Select value={regime} onValueChange={(v) => setRegime(v as RegimeKind | "all")}>
                  <SelectTrigger className="field focus-glow mt-1 h-9">
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
                  <SelectTrigger className="field focus-glow mt-1 h-9">
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
              <div className="sm:col-span-2">
                <Label className="text-xs text-muted-foreground" htmlFor="min-value">
                  Valor mínimo 12m (R$)
                </Label>
                <Input
                  id="min-value"
                  inputMode="numeric"
                  value={minValue}
                  onChange={(e) => setMinValue(e.target.value)}
                  placeholder="0"
                  className="field focus-glow mt-1 h-9 font-mono tabular"
                />
              </div>
            </div>
          </Panel>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              <span className="num">{filtered.length.toLocaleString("pt-BR")}</span> de{" "}
              <span className="num">{rows.length.toLocaleString("pt-BR")}</span> contrapartes
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
            emptyTitle={vazio ? "Sua carteira ainda está vazia" : "Nenhuma contraparte com esses filtros"}
            emptyHint={
              vazio
                ? "A carteira é montada a partir das suas notas fiscais: cada cliente e fornecedor entra aqui com o regime dele, o peso no seu volume e o crédito que se perde. Conecte a entrada de notas ou envie um XML para ver a primeira leitura."
                : "Solte o regime, o semáforo ou o valor mínimo para ver mais contrapartes."
            }
            emptyAction={vazio ? conviteIngestao : undefined}
            exportName={`carteira-${role}`}
          />
        </div>
      </Rise>


      <PartySheet
        tenantId={tenantId}
        role={role}
        row={openParty}
        onClose={() => setOpenParty(null)}
      />
    </Page>
  );
}

/**
 * Célula do treemap pintada com a cor do regime (tokens --regime-* do styles.css).
 */
function RegimeCell(props: unknown) {
  const p = props as {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    regime?: RegimeKind;
    name?: string;
    depth?: number;
    root?: { regime?: RegimeKind };
  };
  const colors = useRegimeColors();
  const regime = p.regime ?? p.root?.regime ?? "desconhecido";
  const fill = colors[regime] ?? colors["desconhecido"];
  const w = p.width ?? 0;
  const h = p.height ?? 0;
  return (
    <g>
      <rect
        x={p.x}
        y={p.y}
        width={w}
        height={h}
        fill={fill}
        fillOpacity={p.depth === 1 ? 0.22 : 0.72}
        stroke="var(--border)"
        style={{ cursor: "pointer" }}
      />
      {p.depth === 2 && w > 60 && h > 22 ? (
        <text
          x={(p.x ?? 0) + 6}
          y={(p.y ?? 0) + 15}
          fill="var(--foreground)"
          fontSize={10}
          pointerEvents="none"
        >
          {String(p.name ?? "").slice(0, Math.floor(w / 6))}
        </text>
      ) : null}
    </g>
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

          <CounterpartyRegistry cnpj={row.cnpj} />


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
                <InvoiceLine
                  key={inv.id}
                  invoiceId={inv.id}
                  issuedAt={inv.issued_at}
                  direction={inv.direction}
                  creditCents={inv.credit_cents ?? 0}
                  totalCents={inv.total_cents}
                />
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

/** Linha de nota com abertura dos itens e memória de cálculo por item. */
function InvoiceLine({
  invoiceId,
  issuedAt,
  direction,
  creditCents,
  totalCents,
}: {
  invoiceId: string;
  issuedAt: string;
  direction: "in" | "out";
  creditCents: number;
  totalCents: number;
}) {
  const [open, setOpen] = useState(false);
  const items = useInvoiceItems(open ? invoiceId : null);

  return (
    <li className="py-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs">
            {new Date(issuedAt).toLocaleDateString("pt-BR")} ·{" "}
            {direction === "out" ? "saída" : "entrada"}
          </p>
          <p className="text-[11px] text-muted-foreground">Crédito {formatCents(creditCents)}</p>
        </div>
        <div className="flex items-center gap-2">
          <MoneyText cents={totalCents} className="text-sm" />
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
            {open ? "Fechar" : "Itens"}
          </Button>
        </div>
      </div>
      {open && (
        <div className="mt-2 rounded-lg border border-border bg-surface-2 px-3">
          <ItemsList items={items.data} loading={items.isLoading} />
        </div>
      )}
    </li>
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
      <p className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted-foreground">
        Sem dados do cadastro público.
        <InfoHint title="Cadastro não consultado">
          Ainda não consultamos este CNPJ. Use “Classificar contrapartes” para buscar os dados
          cadastrais na Receita.
        </InfoHint>
      </p>
    );
  }
  return <RegistrySummary record={data} />;
}
