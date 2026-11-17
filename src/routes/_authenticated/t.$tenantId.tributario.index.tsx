import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Database,
  FileSpreadsheet,
  History,
  Layers,
  RefreshCw,
  Search,
  Table2,
  Upload,
} from "lucide-react";
import type { ReactNode } from "react";

import { CountUp } from "@/components/tax-intel/count-up";
import { ModuleTabs } from "@/components/tax-intel/module-tabs";
import { EmptyState, ErrorState } from "@/components/techiva/empty-state";
import { InfoHint } from "@/components/techiva/info-hint";
import { Page, PageHeader, Panel, Rise } from "@/components/techiva/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ImportRow } from "@/lib/tax-intel/import-client";
import {
  AUDIT_ACTION_LABEL,
  CLASSIFICATION_BAR,
  CLASSIFICATION_LABEL,
  CLASSIFICATIONS,
  CONSULTATION_LABEL,
  dateTime,
  n,
  pct,
  since,
  SOURCE_STATUS_LABEL,
  type ConsultationStatus,
} from "@/lib/tax-intel/labels";
import { loadOverview, type Overview, type SourceRow } from "@/lib/tax-intel/portfolio";
import { useShellData } from "@/lib/tenant-shell-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/t/$tenantId/tributario/")({
  head: () => ({
    meta: [
      { title: "Visão geral · Inteligência Tributária · TECH-IVA" },
      {
        name: "description",
        content: "Painel da carteira de clientes e fornecedores da Inteligência Tributária.",
      },
    ],
  }),
  component: OverviewPage,
});

const IMPORT_STATUS: Record<ImportRow["status"], { label: string; tone: string }> = {
  recebendo: { label: "Recebendo", tone: "text-primary" },
  finalizando: { label: "Finalizando", tone: "text-primary" },
  concluida: { label: "Concluída", tone: "text-flow-in" },
  falhou: { label: "Falhou", tone: "text-destructive" },
  cancelada: { label: "Cancelada", tone: "text-muted-foreground" },
};

const problems = (i: ImportRow) =>
  i.invalid_cnpj_count + i.missing_cnpj_count + i.invalid_relationship_count;

function OverviewPage() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const kind = shell.data?.tenant.kind;
  const allowedKind = kind === "company" || kind === "unit";
  const q = useQuery({
    enabled: allowedKind,
    queryKey: ["tax-overview", tenantId],
    queryFn: () => loadOverview(tenantId),
  });

  if (shell.data && !allowedKind) {
    return (
      <Page>
        <PageHeader eyebrow="inteligência tributária" title="Visão geral" />
        <EmptyState
          icon={Layers}
          title="Disponível em empresa ou unidade"
          hint="A carteira de clientes e fornecedores pertence a uma empresa. Abra a empresa."
        />
      </Page>
    );
  }

  const d = q.data;
  const empty = d && d.cnpjs === 0 && d.imports.length === 0;

  return (
    <Page>
      <PageHeader
        eyebrow="inteligência tributária"
        title="Visão geral"
        helpTitle="Sobre este painel"
        help={
          <>
            <p>
              Números contados no banco, só da carteira desta empresa. A classificação vem das
              fontes públicas consultadas; enquanto não houver consulta, o CNPJ fica como “Consulta
              pendente”.
            </p>
            <p className="mt-2">Nenhum regime é presumido a partir da ausência de informação.</p>
          </>
        }
        meta={
          q.dataUpdatedAt ? (
            <span className="inline-flex items-center gap-1">
              <Clock3 className="size-3" aria-hidden /> atualizado{" "}
              {since(new Date(q.dataUpdatedAt).toISOString())}
            </span>
          ) : null
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void q.refetch()}
              disabled={q.isFetching}
              aria-label="Atualizar números"
            >
              <RefreshCw className={cn("size-4", q.isFetching && "animate-spin")} aria-hidden />
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/t/$tenantId/tributario/carteira" params={{ tenantId }}>
                <Table2 className="mr-2 size-4" aria-hidden /> Carteira
              </Link>
            </Button>
            <Button asChild size="sm" className="cta-lift">
              <Link to="/t/$tenantId/tributario/importacoes" params={{ tenantId }}>
                <Upload className="mr-2 size-4" aria-hidden /> Importar base
              </Link>
            </Button>
          </>
        }
      />
      <ModuleTabs tenantId={tenantId} />

      {q.error ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : empty ? (
        <FirstRun tenantId={tenantId} />
      ) : (
        <>
          <Rise index={1} className="grid gap-4 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
            <PortfolioHero d={d} loading={q.isLoading} />
            <Pending d={d} loading={q.isLoading} tenantId={tenantId} />
          </Rise>

          <Rise index={2} className="grid gap-4 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
            <Distribution d={d} loading={q.isLoading} tenantId={tenantId} />
            <Consultations d={d} loading={q.isLoading} />
          </Rise>

          <Rise index={3} className="grid gap-4 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
            <Timeline d={d} loading={q.isLoading} tenantId={tenantId} />
            <Sources rows={d?.sources} loading={q.isLoading} />
          </Rise>
        </>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------------------
function FirstRun({ tenantId }: { tenantId: string }) {
  const steps = [
    { icon: Upload, title: "Importe a base", text: "XLSX ou CSV com os CNPJs" },
    { icon: CheckCircle2, title: "Revise a validação", text: "Inválidos e repetidos à parte" },
    { icon: Search, title: "Acompanhe a carteira", text: "Filtros, detalhe e Excel" },
  ];
  return (
    <Rise index={1}>
      <section className="panel-hero relative overflow-hidden p-6 sm:p-10">
        <div className="max-w-xl">
          <p className="font-display text-[10px] tracking-[0.28em] text-primary uppercase">
            primeiros passos
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
            Sua carteira ainda está vazia
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Comece importando clientes e fornecedores.
          </p>
        </div>
        <ol className="mt-8 grid gap-3 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className="panel panel-hover sheen flex items-start gap-3 p-4"
              style={{ ["--rise-i" as string]: i }}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-border/70 bg-surface-2 text-primary">
                <s.icon className="size-4" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-medium">
                  <span className="mr-1 font-mono text-xs text-muted-foreground">{i + 1}.</span>
                  {s.title}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <Button asChild className="cta-lift mt-8">
          <Link to="/t/$tenantId/tributario/importacoes" params={{ tenantId }}>
            <Upload className="mr-2 size-4" aria-hidden /> Importar a primeira base
          </Link>
        </Button>
      </section>
    </Rise>
  );
}

function Split({
  items,
  label,
}: {
  items: { label: string; value: number; className: string }[];
  label: string;
}) {
  const total = items.reduce((a, b) => a + b.value, 0);
  return (
    <div>
      <div
        role="img"
        aria-label={`${label}: ${items.map((i) => `${i.label} ${n(i.value)}`).join(", ")}`}
        className="flex h-2 overflow-hidden rounded-full bg-surface-2"
      >
        {items.map((i) => (
          <span
            key={i.label}
            className={cn("h-full transition-[width] duration-700 ease-out", i.className)}
            style={{ width: total ? `${(i.value / total) * 100}%` : "0%" }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {items.map((i) => (
          <span key={i.label} className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className={cn("size-2 rounded-full", i.className)} aria-hidden />
            {i.label}
            <span className="font-mono tabular text-foreground">{n(i.value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function PortfolioHero({ d, loading }: { d: Overview | undefined; loading: boolean }) {
  return (
    <section className="panel-hero p-6 sm:p-7">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-muted-foreground">CNPJs na carteira</p>
        <InfoHint title="CNPJs na carteira">
          CNPJs distintos (estabelecimentos). Um CNPJ que é cliente e fornecedor conta uma vez aqui
          e uma vez em cada relacionamento.
        </InfoHint>
      </div>
      {loading || !d ? (
        <Skeleton className="mt-3 h-12 w-48" />
      ) : (
        <p className="mt-2 text-[2.5rem] leading-none font-semibold tracking-[-0.02em]">
          <CountUp value={d.cnpjs} />
        </p>
      )}
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        {loading || !d ? (
          <>
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </>
        ) : (
          <>
            <Split
              label="Relacionamentos"
              items={[
                { label: "Clientes", value: d.clientes, className: "bg-primary" },
                { label: "Fornecedores", value: d.fornecedores, className: "bg-regime-real" },
              ]}
            />
            <Split
              label="Estrutura"
              items={[
                { label: "Matrizes", value: d.matrizes, className: "bg-regime-simples" },
                { label: "Filiais", value: d.filiais, className: "bg-regime-presumido" },
              ]}
            />
          </>
        )}
      </div>
      {d && d.alfanumericos > 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          <span className="font-mono tabular text-foreground">{n(d.alfanumericos)}</span> CNPJs
          alfanuméricos
        </p>
      ) : null}
    </section>
  );
}

function PendingRow({
  icon: Icon,
  tone,
  value,
  label,
  action,
}: {
  icon: typeof AlertTriangle;
  tone: string;
  value: number;
  label: string;
  action?: ReactNode;
}) {
  return (
    <li className="row-hover flex items-center gap-3 rounded-lg px-2 py-2.5">
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2", tone)}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-mono tabular text-sm font-semibold">{n(value)}</p>
        <p className="truncate text-xs text-muted-foreground">{label}</p>
      </div>
      {action}
    </li>
  );
}

function Pending({
  d,
  loading,
  tenantId,
}: {
  d: Overview | undefined;
  loading: boolean;
  tenantId: string;
}) {
  const open =
    d?.imports.filter((i) => i.status === "recebendo" || i.status === "finalizando") ?? [];
  const lastDone = d?.imports.find((i) => i.status === "concluida");
  return (
    <Panel
      title="Pendências"
      icon={AlertTriangle}
      help="O que ainda pede ação: CNPJs sem consulta, linhas recusadas na última importação e envios interrompidos."
    >
      {loading || !d ? (
        <div className="space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          <PendingRow
            icon={Search}
            tone="text-muted-foreground"
            value={d.byClass.consulta_pendente}
            label="CNPJs aguardando consulta às fontes"
            action={
              <Button asChild size="sm" variant="ghost" aria-label="Ver CNPJs pendentes">
                <Link
                  to="/t/$tenantId/tributario/carteira"
                  params={{ tenantId }}
                  search={{ classe: "consulta_pendente" }}
                >
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
            }
          />
          <PendingRow
            icon={AlertTriangle}
            tone="text-warn"
            value={lastDone ? problems(lastDone) + lastDone.duplicate_count : 0}
            label={lastDone ? `Linhas recusadas em ${lastDone.file_name}` : "Linhas recusadas"}
            action={
              lastDone ? (
                <Button asChild size="sm" variant="ghost" aria-label="Ver linhas recusadas">
                  <Link
                    to="/t/$tenantId/tributario/importacoes"
                    params={{ tenantId }}
                    search={{ detalhe: lastDone.id }}
                  >
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>
              ) : null
            }
          />
          <PendingRow
            icon={Clock3}
            tone="text-primary"
            value={open.length}
            label="Importações interrompidas (retomáveis)"
            action={
              open.length ? (
                <Button asChild size="sm" variant="ghost" aria-label="Retomar importações">
                  <Link to="/t/$tenantId/tributario/importacoes" params={{ tenantId }}>
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>
              ) : null
            }
          />
        </ul>
      )}
    </Panel>
  );
}

function Distribution({
  d,
  loading,
  tenantId,
}: {
  d: Overview | undefined;
  loading: boolean;
  tenantId: string;
}) {
  const total = d?.cnpjs ?? 0;
  const rows = CLASSIFICATIONS.map((c) => ({ c, v: d?.byClass[c] ?? 0 }));
  return (
    <Panel
      title="Distribuição por regime"
      icon={Layers}
      help="Classificação pública de cada CNPJ, gravada a partir das fontes consultadas. A barra soma 100% da carteira."
    >
      {loading || !d ? (
        <div className="space-y-3">
          <Skeleton className="h-3" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-6" />
          ))}
        </div>
      ) : (
        <>
          <div
            role="img"
            aria-label={rows.map((r) => `${CLASSIFICATION_LABEL[r.c]} ${n(r.v)}`).join(", ")}
            className="flex h-3 overflow-hidden rounded-full bg-surface-2"
          >
            {rows
              .filter((r) => r.v > 0)
              .map((r) => (
                <span
                  key={r.c}
                  title={`${CLASSIFICATION_LABEL[r.c]}: ${n(r.v)}`}
                  className={cn(
                    "h-full transition-[width] duration-700 ease-out",
                    CLASSIFICATION_BAR[r.c],
                  )}
                  style={{ width: `${(r.v / Math.max(total, 1)) * 100}%` }}
                />
              ))}
          </div>
          <ul className="mt-4 divide-y divide-border/50">
            {rows.map((r) => (
              <li key={r.c}>
                <Link
                  to="/t/$tenantId/tributario/carteira"
                  params={{ tenantId }}
                  search={{ classe: r.c }}
                  className="row-hover focus-glow -mx-2 flex items-center gap-3 rounded-md px-2 py-2"
                >
                  <span
                    className={cn("size-2.5 shrink-0 rounded-sm", CLASSIFICATION_BAR[r.c])}
                    aria-hidden
                  />
                  <span
                    className={cn("flex-1 truncate text-sm", r.v === 0 && "text-muted-foreground")}
                  >
                    {CLASSIFICATION_LABEL[r.c]}
                  </span>
                  <span className="w-14 text-right font-mono tabular text-xs text-muted-foreground">
                    {pct(r.v, total)}
                  </span>
                  <span className="w-16 text-right font-mono tabular text-sm">{n(r.v)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

const CONSULT_TONE: Record<ConsultationStatus, string> = {
  ok: "text-flow-in",
  nao_encontrado: "text-muted-foreground",
  erro: "text-destructive",
  fonte_indisponivel: "text-warn",
};

function Consultations({ d, loading }: { d: Overview | undefined; loading: boolean }) {
  const total = d ? Object.values(d.consultations).reduce((a, b) => a + b, 0) : 0;
  return (
    <Panel
      title="Status das consultas"
      icon={Search}
      help="Cada consulta a uma fonte pública fica gravada, com a resposta original. Aqui está o resultado de todas as consultas da carteira."
    >
      {loading || !d ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : total === 0 ? (
        <EmptyState
          icon={Search}
          title="Nenhuma consulta realizada ainda"
          hint="As consultas às fontes públicas entram na próxima fase. Até lá, todo CNPJ fica como “Consulta pendente”."
          className="py-8"
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(CONSULTATION_LABEL) as ConsultationStatus[]).map((s) => (
              <div key={s} className="rounded-lg border border-border/60 bg-surface-2/40 p-3">
                <p className={cn("font-mono tabular text-lg font-semibold", CONSULT_TONE[s])}>
                  {n(d.consultations[s])}
                </p>
                <p className="text-xs text-muted-foreground">{CONSULTATION_LABEL[s]}</p>
              </div>
            ))}
          </div>
          {d.lastConsultedAt ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Última consulta {since(d.lastConsultedAt)}
            </p>
          ) : null}
        </>
      )}
    </Panel>
  );
}

function Timeline({
  d,
  loading,
  tenantId,
}: {
  d: Overview | undefined;
  loading: boolean;
  tenantId: string;
}) {
  return (
    <Panel
      title="Histórico de atualizações"
      icon={History}
      help="Importações e eventos registrados na auditoria do módulo, do mais recente para o mais antigo."
      actions={
        <Button asChild size="sm" variant="ghost">
          <Link to="/t/$tenantId/tributario/importacoes" params={{ tenantId }}>
            Ver tudo
          </Link>
        </Button>
      }
    >
      {loading || !d ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : d.imports.length === 0 ? (
        <EmptyState icon={History} title="Nada registrado ainda" className="py-8" />
      ) : (
        <ol className="relative space-y-4 pl-6 before:absolute before:top-2 before:bottom-2 before:left-[7px] before:w-px before:bg-border/70">
          {d.imports.map((i) => {
            const st = IMPORT_STATUS[i.status];
            return (
              <li key={i.id} className="relative">
                <span
                  className={cn(
                    "absolute top-1.5 -left-6 grid size-[15px] place-items-center rounded-full border-2 border-surface-1 bg-surface-2",
                  )}
                  aria-hidden
                >
                  <span className={cn("size-1.5 rounded-full bg-current", st.tone)} />
                </span>
                <Link
                  to="/t/$tenantId/tributario/importacoes"
                  params={{ tenantId }}
                  search={{ detalhe: i.id }}
                  className="focus-glow group block rounded-md"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="truncate text-sm font-medium group-hover:underline">
                      <FileSpreadsheet
                        className="mr-1.5 inline size-3.5 text-muted-foreground"
                        aria-hidden
                      />
                      {i.file_name}
                    </p>
                    <span
                      className="font-mono tabular text-[11px] text-muted-foreground"
                      title={dateTime(i.created_at)}
                    >
                      {since(i.created_at)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className={cn("font-medium", st.tone)}>{st.label}</span> ·{" "}
                    {n(i.expected_rows)} linhas · {n(i.valid_count)} novos · {n(i.existing_count)}{" "}
                    já existiam
                    {problems(i) + i.duplicate_count > 0
                      ? ` · ${n(problems(i) + i.duplicate_count)} recusadas`
                      : ""}
                  </p>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      {d?.audit && d.audit.length > 0 ? (
        <details className="mt-4 rounded-lg border border-border/60 bg-surface-2/30 px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground">
            Auditoria ({n(d.audit.length)} eventos recentes)
          </summary>
          <ul className="mt-2 space-y-1">
            {d.audit.map((a) => (
              <li key={a.id} className="flex justify-between gap-3">
                <span>{AUDIT_ACTION_LABEL[a.action] ?? a.action}</span>
                <span className="font-mono tabular text-muted-foreground">{dateTime(a.at)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Panel>
  );
}

const SOURCE_TONE: Record<SourceRow["status"], string> = {
  ativa: "text-flow-in border-flow-in/40 bg-flow-in/10",
  a_confirmar: "text-warn border-warn/40 bg-warn/10",
  indisponivel: "text-muted-foreground border-border bg-muted/40",
};

function Sources({ rows, loading }: { rows: SourceRow[] | undefined; loading: boolean }) {
  return (
    <Panel
      title="Fontes públicas"
      icon={Database}
      help="Fontes cadastradas no módulo, com cobertura e limitações conferidas. “A confirmar” = ainda não validada em produção."
    >
      {loading || !rows ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Database} title="Nenhuma fonte cadastrada" className="py-8" />
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {rows.map((s) => (
            <li key={s.code} className="row-hover flex items-center gap-3 rounded-lg px-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{s.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{s.coverage}</p>
              </div>
              <InfoHint title={s.name}>
                <p>{s.coverage}</p>
                <p className="mt-2 text-muted-foreground">{s.limitations}</p>
              </InfoHint>
              <span
                className={cn(
                  "shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium",
                  SOURCE_TONE[s.status],
                )}
              >
                {SOURCE_STATUS_LABEL[s.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
