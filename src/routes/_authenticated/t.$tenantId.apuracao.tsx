import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Coins,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState, ErrorState } from "@/components/techiva/empty-state";
import { NoticeBoard } from "@/components/techiva/notices";
import { MoneyText, formatCents } from "@/components/techiva/money";
import { ClassTribValidator, ItemsList } from "@/components/techiva/rtc";
import { NaturezaMoney, SituacaoStepper, TotalCard, VisoesTabs } from "@/components/techiva/apuracao";
import { Pager } from "@/components/techiva/pager";
import { SideSheet } from "@/components/techiva/side-sheet";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardCash } from "@/lib/cash";
import { DEFAULT_PAGE_SIZE } from "@/lib/paginate";
import {
  APURACAO_LIMITACAO,
  CALCULADORA_OFFLINE,
  CREDITO_ACUMULADO_COPY,
  SITUACAO_LABEL,
  creditoAcumulado,
  formatCompetencia,
  lastCompetencias,
  useApuracaoDetalhe,
  useApuracaoDivergencia,
  useApuracoesLista,
  useCompetenciaInvoices,
  useInvoiceItems,
  useRequestApuracao,
  useProcessarPendentesApuracao,
  useRtcQuota,
  type InvoiceRow,
} from "@/lib/rtc";

export const Route = createFileRoute("/_authenticated/t/$tenantId/apuracao")({
  head: () => ({
    meta: [
      { title: "Apuração assistida da CBS — TECH-IVA" },
      {
        name: "description",
        content:
          "A apuração da CBS da Receita com as mesmas abas e contas do portal, mais o que o portal não faz: comparação com o seu cálculo, projeção de caixa e o significado do crédito acumulado.",
      },
      { property: "og:title", content: "Apuração assistida da CBS — TECH-IVA" },
      {
        property: "og:description",
        content:
          "Resultado e saldo atualizado com natureza C/D, árvore de contas por visão e a divergência entre a Receita e o seu cálculo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ApuracaoPage,
});

const COMPETENCIAS = lastCompetencias(12);

function ApuracaoPage() {
  const { tenantId } = Route.useParams();
  const [competencia, setCompetencia] = useState(COMPETENCIAS[0] as string);
  const [invoice, setInvoice] = useState<InvoiceRow | null>(null);
  const [validatorOpen, setValidatorOpen] = useState(false);

  const detalhe = useApuracaoDetalhe(tenantId, competencia);
  const divergencia = useApuracaoDivergencia(tenantId, competencia);
  const quota = useRtcQuota(tenantId);
  const request = useRequestApuracao(tenantId);
  const pendentes = useProcessarPendentesApuracao(tenantId);
  const lista = useApuracoesLista(tenantId);
  const cash = useDashboardCash(tenantId, 90);
  const [invPage, setInvPage] = useState(0);
  const [invPageSize, setInvPageSize] = useState(DEFAULT_PAGE_SIZE);
  const invoices = useCompetenciaInvoices(tenantId, competencia, invPage, invPageSize);
  const invoiceRows = invoices.data?.rows ?? [];
  const invoiceTotal = invoices.data?.total ?? 0;
  const items = useInvoiceItems(invoice?.id ?? null);

  const ap = detalhe.data?.disponivel ? detalhe.data : null;
  const d = divergencia.data;
  const disponivel = d?.disponivel === true;
  const divergente = disponivel && d.divergente;
  const podeConsultar = quota.data?.pode_manual !== false;
  const acumulado = creditoAcumulado(detalhe.data);

  if (divergencia.isError) {
    return (
      <ErrorState
        message={(divergencia.error as Error).message}
        onRetry={() => void divergencia.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Apuração assistida da CBS</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Mesma estrutura do portal da Receita — as seis visões, os nomes das contas e a natureza
            C/D. O que o portal não faz vem primeiro: a comparação com o seu cálculo, a projeção do
            caixa e o que o crédito acumulado significa em dinheiro.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Competência</Label>
            <Select
              value={competencia}
              onValueChange={(v) => {
                setInvPage(0);
                setCompetencia(v);
              }}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPETENCIAS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {formatCompetencia(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" onClick={() => setValidatorOpen(true)}>
            Validar CST × cClassTrib
          </Button>
        </div>
      </header>

      {/* 1 — COMPARAÇÃO: o portal não sabe o que você calculou */}
      <section
        className={
          divergente
            ? "rounded-xl border border-flow-out/50 bg-flow-out/10 p-4"
            : "rounded-xl border border-border bg-surface-1 p-4"
        }
      >
        <h2 className="flex items-center gap-2 text-base font-medium">
          {divergente ? (
            <AlertTriangle className="size-4 text-flow-out" aria-hidden />
          ) : disponivel ? (
            <CheckCircle2 className="size-4 text-flow-in" aria-hidden />
          ) : (
            <Info className="size-4 text-muted-foreground" aria-hidden />
          )}
          Receita × nosso cálculo
        </h2>

        {divergencia.isLoading ? (
          <Skeleton className="mt-3 h-16 w-full" />
        ) : (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Débito apurado pela Receita</p>
                <p className="mt-1 font-mono text-lg tabular">
                  {disponivel ? formatCents(d.receita_debito_cents ?? 0) : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">O que calculamos das suas notas</p>
                <p className="mt-1 font-mono text-lg tabular">
                  {formatCents(d?.nosso_debito_cents ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Divergência</p>
                <p
                  className={`mt-1 font-mono text-lg tabular ${divergente ? "text-flow-out" : "text-flow-in"}`}
                >
                  {disponivel ? formatCents(Math.abs(d.diferenca_cents)) : "—"}
                </p>
              </div>
            </div>

            {!disponivel && (
              <p className="mt-3 text-sm text-muted-foreground">
                {d && "mensagem" in d ? d.mensagem : "Apuração da Receita ainda não consultada."} Use
                “Consultar Receita” abaixo para solicitar.
              </p>
            )}

            {divergente && (
              <p className="mt-3 text-xs text-muted-foreground">
                {d.diferenca_cents > 0
                  ? "A Receita apurou mais do que calculamos: pode haver documento emitido que não chegou até nós."
                  : "Calculamos mais do que a Receita apurou: pode haver documento que a Receita ainda não processou, ou cancelamento/devolução."}{" "}
                Confira os documentos da competência mais abaixo — cada item abre a memória de cálculo
                com a base legal aplicada.
              </p>
            )}

            {disponivel && !divergente && (
              <p className="mt-3 text-sm text-flow-in">
                Seu cálculo bate com a apuração da Receita nesta competência.
              </p>
            )}

            <p className="mt-3 text-[11px] text-muted-foreground">{APURACAO_LIMITACAO}</p>
          </>
        )}
      </section>

      {/* 2 — PROJEÇÃO: o portal mostra o passado */}
      <section className="rounded-xl border border-border bg-surface-1 p-4">
        <h2 className="flex items-center gap-2 text-base font-medium">
          <TrendingUp className="size-4 text-primary" aria-hidden />
          O que vem pela frente
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          A apuração acima é o passado fechado. Isto é a projeção do seu caixa: quanto sai de imposto
          e quando o crédito volta.
        </p>
        {cash.isLoading ? (
          <Skeleton className="mt-3 h-16 w-full" />
        ) : (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <ProjecaoItem label="Sai em 30 dias" cents={cash.data?.hero.gap_30_cents ?? 0} />
              <ProjecaoItem label="Sai em 60 dias" cents={cash.data?.hero.gap_60_cents ?? 0} />
              <ProjecaoItem label="Sai em 90 dias" cents={cash.data?.hero.gap_90_cents ?? 0} />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <ProjecaoItem
                label="Crédito ainda a voltar"
                cents={cash.data?.kpis.credit_backlog_cents ?? 0}
                hint={`prazo médio de ${Math.round(cash.data?.kpis.credit_avg_days ?? 0)} dias`}
              />
              {cash.data?.next_gap ? (
                <ProjecaoItem
                  label="Próximo aperto"
                  cents={cash.data.next_gap.amount_cents}
                  hint={`semana de ${new Date(cash.data.next_gap.week).toLocaleDateString("pt-BR")}`}
                />
              ) : (
                <ProjecaoItem label="Próximo aperto" cents={0} hint="nenhum aperto projetado" />
              )}
            </div>
          </>
        )}
      </section>

      {/* 3 — SIGNIFICADO PARA O CAIXA: crédito acumulado em linguagem de dinheiro */}
      {acumulado && (
        <section className="rounded-xl border border-primary/40 bg-primary/5 p-4">
          <h2 className="flex items-center gap-2 text-base font-medium">
            <Coins className="size-4 text-primary" aria-hidden />
            Você tem <MoneyText cents={acumulado.valor_cents} /> de crédito acumulado parado
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{CREDITO_ACUMULADO_COPY}</p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            No portal esse número aparece como “{acumulado.conta}”, em Outras Informações.
          </p>
        </section>
      )}

      {/* 4 — os dois totais, com natureza C/D como a Receita apresenta */}
      {detalhe.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : ap ? (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <TotalCard
              label="Resultado da apuração"
              cents={ap.resultado_cents}
              natureza={ap.natureza_resultado}
              hint={formatCompetencia(ap.competencia.slice(0, 7) + "-01")}
            />
            <TotalCard
              label="Saldo atualizado"
              cents={ap.saldo_atualizado_cents}
              natureza={ap.natureza_saldo}
              {...(ap.recebido_em
                ? { hint: `recebido em ${new Date(ap.recebido_em).toLocaleString("pt-BR")}` }
                : {})}
            />
          </div>

          {/* 5 — stepper de situação, igual ao topo do portal */}
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-1 p-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Situação da apuração
              </p>
              <div className="mt-2">
                <SituacaoStepper situacao={ap.situacao} />
              </div>
            </div>
            <Badge variant="outline" className="text-xs">
              Intenção de solicitar ressarcimento de saldo credor:{" "}
              {ap.intencao_ressarcimento ? "sim" : "não"}
            </Badge>
          </section>

          {/* 6 — as seis visões com a árvore de contas */}
          <section className="rounded-xl border border-border bg-surface-1 p-4">
            <h2 className="text-base font-medium">Detalhe por visão</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              As mesmas abas, contas e ordem da apuração assistida da Receita.
            </p>
            <div className="mt-3">
              <VisoesTabs visoes={ap.visoes} />
            </div>
          </section>
        </>
      ) : (
        <EmptyState
          title="Apuração desta competência ainda não consultada"
          hint="Solicite a consulta abaixo. A Receita responde de forma assíncrona e a estrutura completa (abas e contas) aparece aqui."
        />
      )}

      {/* avisos mantidos pela plataforma (notices_for) */}
      <NoticeBoard scope="apuracao" />

      {/* cota da Receita — visível ANTES do clique */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-1 p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {quota.isLoading
              ? "Verificando cota do dia…"
              : (quota.data?.restantes ?? 0) > 0
                ? `Consulta ${Math.min((quota.data?.usadas ?? 0) + 1, quota.data?.limite ?? 2)} de ${quota.data?.limite ?? 2} disponíveis hoje`
                : `0 de ${quota.data?.limite ?? 2} consultas disponíveis hoje`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {quota.data?.mensagem ?? "Verificando a cota diária definida pela Receita Federal."}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Este limite é da Receita Federal, não do TECH-IVA. Usamos 1 consulta automática por dia e
            deixamos a outra reservada para você.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={pendentes.isPending}
            onClick={async () => {
              try {
                const r = await pendentes.mutateAsync();
                if (r.processadas > 0) toast.success(`${r.processadas} apuração(ões) baixada(s) da Receita.`);
                else if (r.falhas.length > 0) toast.error(r.falhas[0] ?? "Falha ao baixar a apuração.");
                else toast.info("Nenhum retorno da Receita aguardando download.");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Falha ao reprocessar.");
              }
            }}
          >
            {pendentes.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-4" aria-hidden />
            )}
            Reprocessar retorno
          </Button>

          <Button
            type="button"
            className="gap-2"
            title={!podeConsultar ? quota.data?.mensagem : undefined}
            disabled={!podeConsultar || request.isPending || quota.isLoading}
            onClick={async () => {
              try {
                await request.mutateAsync(competencia);
                toast.success("Solicitação enviada. A Receita retorna o resultado em seguida.");
              } catch (error) {
                const message = error instanceof Error ? error.message : "Falha ao consultar.";
                toast.error(message === "forbidden" ? "Seu papel não permite consultar a Receita." : message);
              }
            }}
          >
            {request.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-4" aria-hidden />
            )}
            Consultar Receita
          </Button>
        </div>
      </section>

      {/* documentos da competência */}
      <section className="rounded-xl border border-border bg-surface-1 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-medium">Documentos de saída da competência</h2>
          <Badge variant="outline" className="text-xs">
            {invoiceTotal.toLocaleString("pt-BR")} nota(s)
          </Badge>
        </div>
        {invoices.isLoading ? (
          <Skeleton className="mt-4 h-32 w-full" />
        ) : invoiceTotal === 0 ? (
          <div className="mt-4">
            <EmptyState title="Nenhuma nota de saída nesta competência" />
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {invoiceRows.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="font-mono text-xs text-muted-foreground">
                      {inv.series ? `${inv.series}/` : ""}
                      {inv.number ?? "s/n"}
                    </span>{" "}
                    · {new Date(inv.issued_at).toLocaleDateString("pt-BR")}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    IBS+CBS {formatCents((inv.ibs_cents ?? 0) + (inv.cbs_cents ?? 0))}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <MoneyText cents={inv.total_cents} className="text-sm" />
                  <Button type="button" size="sm" variant="outline" onClick={() => setInvoice(inv)}>
                    Ver itens
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {invoiceTotal > 0 && (
          <Pager
            page={invPage}
            pageSize={invPageSize}
            total={invoiceTotal}
            approx={invoices.data?.approx ?? false}
            loading={invoices.isFetching}
            unit="nota(s) de saída"
            onPageChange={setInvPage}
            onPageSizeChange={(n) => {
              setInvPageSize(n);
              setInvPage(0);
            }}
            className="-mx-4 -mb-4 mt-3"
          />
        )}
      </section>

      {/* minhas apurações da CBS */}
      <section className="rounded-xl border border-border bg-surface-1 p-4">
        <h2 className="text-base font-medium">Minhas apurações da CBS</h2>
        {lista.isLoading ? (
          <Skeleton className="mt-4 h-20 w-full" />
        ) : (lista.data?.length ?? 0) === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Nenhuma apuração recebida"
              hint="Cada solicitação consome uma das 2 consultas diárias permitidas pela Receita."
            />
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {lista.data?.map((a) => {
              const comp = a.competencia.slice(0, 7) + "-01";
              return (
                <li key={a.competencia} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="text-sm text-primary hover:underline"
                      onClick={() => {
                        setInvPage(0);
                        setCompetencia(comp);
                      }}
                    >
                      {formatCompetencia(comp)}
                    </button>
                    {a.situacao && (
                      <Badge variant="outline" className="text-[10px]">
                        {SITUACAO_LABEL[a.situacao]}
                      </Badge>
                    )}
                    {a.recebido_em && (
                      <span className="text-[11px] text-muted-foreground">
                        recebida em {new Date(a.recebido_em).toLocaleDateString("pt-BR")}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-xs text-muted-foreground">Resultado</span>
                    <NaturezaMoney cents={a.resultado_cents} natureza={a.natureza_resultado} />
                    <ArrowRight className="size-3.5 text-muted-foreground/60" aria-hidden />
                    <span className="text-xs text-muted-foreground">Saldo</span>
                    <NaturezaMoney cents={a.saldo_atualizado_cents} natureza={null} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {CALCULADORA_OFFLINE}
      </p>

      <SideSheet
        open={Boolean(invoice)}
        onOpenChange={(o) => !o && setInvoice(null)}
        title={`Nota ${invoice?.number ?? ""}`.trim()}
        description={
          invoice ? `Emitida em ${new Date(invoice.issued_at).toLocaleDateString("pt-BR")}` : undefined
        }
      >
        <ItemsList items={items.data} loading={items.isLoading} />
      </SideSheet>

      <SideSheet
        open={validatorOpen}
        onOpenChange={setValidatorOpen}
        title="Validar classificação"
        description="Matriz oficial CST × cClassTrib, com efeito, redução, direito a crédito e base legal."
      >
        <ClassTribValidator competencia={competencia} />
      </SideSheet>
    </div>
  );
}

function ProjecaoItem({
  label,
  cents,
  hint,
}: {
  label: string;
  cents: number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-base tabular">{formatCents(cents)}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
