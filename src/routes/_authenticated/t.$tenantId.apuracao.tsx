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

import { InfoHint } from "@/components/techiva/info-hint";
import { EmptyState, ErrorState } from "@/components/techiva/empty-state";
import { NoticeBoard } from "@/components/techiva/notices";
import { MoneyText, formatCents } from "@/components/techiva/money";
import { ClassTribValidator, ItemsList } from "@/components/techiva/rtc";
import { NaturezaMoney, SituacaoStepper, TotalCard, VisoesTabs } from "@/components/techiva/apuracao";
import { ConciliacaoPanel, ExtincaoPanel } from "@/components/techiva/conciliacao";
import { Page, PageHeader, Panel, Rise } from "@/components/techiva/page";
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

  const compareIcon = divergente ? AlertTriangle : disponivel ? CheckCircle2 : Info;

  if (divergencia.isError) {
    return (
      <Page>
        <ErrorState
          message={(divergencia.error as Error).message}
          onRetry={() => void divergencia.refetch()}
        />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        eyebrow="apuração · cbs"
        title="Apuração assistida da CBS"
        helpTitle="Como ler esta tela"
        help={
          <>
            <p>
              Mesma estrutura do portal da Receita — as seis visões, os nomes das contas e a
              natureza C/D.
            </p>
            <p>
              O que o portal não faz vem primeiro: a comparação com o seu cálculo, a projeção do
              caixa e o que o crédito acumulado significa em dinheiro.
            </p>
            <p className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {CALCULADORA_OFFLINE}
            </p>
          </>
        }
        actions={
          <>
            <div className="flex items-end gap-1.5">
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
            </div>
            <Button type="button" variant="outline" onClick={() => setValidatorOpen(true)}>
              Validar CST × cClassTrib
            </Button>
          </>
        }
      />

      {/* avisos mantidos pela plataforma (notices_for) */}
      <Rise index={1}>
        <NoticeBoard scope="apuracao" />
      </Rise>

      {/* 1 — COMPARAÇÃO: o portal não sabe o que você calculou */}
      <Rise index={2}>
        <Panel
          title="Receita × nosso cálculo"
          icon={compareIcon}
          help={<p>{APURACAO_LIMITACAO}</p>}
          className={divergente ? "border-flow-out/50 bg-flow-out/10" : undefined}
        >
          {divergencia.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Débito apurado pela Receita</p>
                  <p className="mt-1 font-mono text-lg tabular-nums">
                    {disponivel ? formatCents(d.receita_debito_cents ?? 0) : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">O que calculamos das suas notas</p>
                  <p className="mt-1 font-mono text-lg tabular-nums">
                    {formatCents(d?.nosso_debito_cents ?? 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Divergência</p>
                  <p
                    className={`mt-1 font-mono text-lg tabular-nums ${divergente ? "text-flow-out" : "text-flow-in"}`}
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
                  <InfoHint title="Como conferir">
                    Confira os documentos da competência mais abaixo — cada item abre a memória de
                    cálculo com a base legal aplicada.
                  </InfoHint>
                </p>
              )}

              {disponivel && !divergente && (
                <p className="mt-3 text-sm text-flow-in">
                  Seu cálculo bate com a apuração da Receita nesta competência.
                </p>
              )}
            </>
          )}
        </Panel>
      </Rise>

      {/* 2 — PROJEÇÃO: o portal mostra o passado */}
      <Rise index={3}>
        <Panel
          title="O que vem pela frente"
          icon={TrendingUp}
          help={<p>A apuração acima é o passado fechado. Isto é a projeção do seu caixa: quanto sai de imposto e quando o crédito volta.</p>}
        >
          {cash.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
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
        </Panel>
      </Rise>

      {/* 3 — SIGNIFICADO PARA O CAIXA: crédito acumulado em linguagem de dinheiro */}
      {acumulado && (
        <Rise index={4}>
          <Panel
            title="Crédito acumulado parado"
            icon={Coins}
            help={
              <>
                <p>{CREDITO_ACUMULADO_COPY}</p>
                <p>No portal esse número aparece como “{acumulado.conta}”, em Outras Informações.</p>
              </>
            }
            className="border-primary/40 bg-primary/5"
          >
            <p className="text-base font-medium">
              Você tem <MoneyText cents={acumulado.valor_cents} /> de crédito acumulado parado
            </p>
          </Panel>
        </Rise>
      )}

      {/* 4 — os dois totais, com natureza C/D como a Receita apresenta */}
      {detalhe.isLoading ? (
        <Rise index={5}>
          <Skeleton className="h-24 w-full" />
        </Rise>
      ) : ap ? (
        <>
          <Rise index={5} className="grid gap-3 sm:grid-cols-2">
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
          </Rise>

          {/* 5 — stepper de situação, igual ao topo do portal */}
          <Rise index={6}>
            <Panel title="Situação da apuração" bodyClassName="flex flex-wrap items-center justify-between gap-3 p-4">
              <SituacaoStepper situacao={ap.situacao} />
              <Badge variant="outline" className="text-xs">
                Intenção de solicitar ressarcimento de saldo credor:{" "}
                {ap.intencao_ressarcimento ? "sim" : "não"}
              </Badge>
            </Panel>
          </Rise>

          {/* 6 — as seis visões com a árvore de contas */}
          <Rise index={7}>
            <Panel
              title="Detalhe por visão"
              help={<p>As mesmas abas, contas e ordem da apuração assistida da Receita.</p>}
            >
              <VisoesTabs visoes={ap.visoes} />
            </Panel>
          </Rise>
        </>
      ) : (
        <Rise index={5}>
          <EmptyState
            title="Apuração desta competência ainda não consultada"
            hint="Solicite a consulta abaixo. A Receita responde de forma assíncrona e a estrutura completa (abas e contas) aparece aqui."
          />
        </Rise>
      )}

      {/* cota da Receita — visível ANTES do clique */}
      <Rise index={8}>
        <Panel
          title="Consulta à Receita"
          help={
            <>
              <p>{quota.data?.mensagem ?? "Verificando a cota diária definida pela Receita Federal."}</p>
              <p>
                Este limite é da Receita Federal, não do TECH-IVA. Usamos 1 consulta automática por
                dia e deixamos a outra reservada para você.
              </p>
            </>
          }
          bodyClassName="flex flex-wrap items-center justify-between gap-3 p-4"
        >
          <p className="text-sm font-medium">
            {quota.isLoading
              ? "Verificando cota do dia…"
              : (quota.data?.restantes ?? 0) > 0
                ? `Consulta ${Math.min((quota.data?.usadas ?? 0) + 1, quota.data?.limite ?? 2)} de ${quota.data?.limite ?? 2} disponíveis hoje`
                : `0 de ${quota.data?.limite ?? 2} consultas disponíveis hoje`}
          </p>

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
        </Panel>
      </Rise>

      {/* documentos da competência */}
      <Rise index={9}>
        <Panel
          title="Documentos de saída da competência"
          actions={
            <Badge variant="outline" className="text-xs">
              {invoiceTotal.toLocaleString("pt-BR")} nota(s)
            </Badge>
          }
        >
          {invoices.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : invoiceTotal === 0 ? (
            <EmptyState title="Nenhuma nota de saída nesta competência" />
          ) : (
            <div className="overflow-x-auto">
              <ul className="divide-y divide-border">
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
            </div>
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
        </Panel>
      </Rise>

      {/* minhas apurações da CBS */}
      <Rise index={10}>
        <Panel
          title="Minhas apurações da CBS"
          help={<p>Cada solicitação consome uma das 2 consultas diárias permitidas pela Receita.</p>}
        >
          {lista.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (lista.data?.length ?? 0) === 0 ? (
            <EmptyState title="Nenhuma apuração recebida" />
          ) : (
            <div className="overflow-x-auto">
              <ul className="divide-y divide-border">
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
            </div>
          )}
        </Panel>
      </Rise>

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
    </Page>
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
      <p className="mt-1 font-mono text-base tabular-nums">{formatCents(cents)}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
