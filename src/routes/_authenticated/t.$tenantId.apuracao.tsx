import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, ErrorState } from "@/components/techiva/empty-state";
import { NoticeBoard } from "@/components/techiva/notices";
import { KpiCard } from "@/components/techiva/metrics";
import { MoneyText, formatCents } from "@/components/techiva/money";
import { ClassTribValidator, ItemsList } from "@/components/techiva/rtc";
import { Pager } from "@/components/techiva/pager";
import { SideSheet } from "@/components/techiva/side-sheet";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CALCULADORA_OFFLINE,
  formatCompetencia,
  lastCompetencias,
  useApuracaoDivergencia,
  useApuracoes,
  useCompetenciaInvoices,
  useInvoiceItems,
  useRequestApuracao,
  useRtcQuota,
  type InvoiceRow,
} from "@/lib/rtc";

export const Route = createFileRoute("/_authenticated/t/$tenantId/apuracao")({
  head: () => ({
    meta: [
      { title: "Apuração assistida — TECH-IVA" },
      {
        name: "description",
        content:
          "Compare a apuração de CBS da Receita com o cálculo do TECH-IVA por competência, com memória de cálculo e base legal por item.",
      },
      { property: "og:title", content: "Apuração assistida — TECH-IVA" },
      {
        property: "og:description",
        content:
          "Divergência entre sua apuração e a da Receita, cota diária de consultas e rastreabilidade normativa de cada número.",
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

  const divergencia = useApuracaoDivergencia(tenantId, competencia);
  const quota = useRtcQuota(tenantId);
  const request = useRequestApuracao(tenantId);
  const apuracoes = useApuracoes(tenantId);
  const [invPage, setInvPage] = useState(0);
  const [invPageSize, setInvPageSize] = useState(DEFAULT_PAGE_SIZE);
  const invoices = useCompetenciaInvoices(tenantId, competencia, invPage, invPageSize);
  const invoiceRows = invoices.data?.rows ?? [];
  // total EXATO do servidor: a competência pode ter 100 mil notas
  const invoiceTotal = invoices.data?.total ?? 0;
  const items = useInvoiceItems(invoice?.id ?? null);

  const d = divergencia.data;
  const disponivel = d?.disponivel === true;
  const divergente = disponivel && d.divergente;
  const podeConsultar = quota.data?.pode_manual !== false;

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
          <h1 className="text-lg font-semibold">Apuração assistida</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            O que a Receita apurou, lado a lado com o que calculamos a partir dos seus documentos.
            Divergência acima de R$ 1,00 é sinalizada.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Competência</Label>
            <Select value={competencia} onValueChange={setCompetencia}>
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
          {/* mensagem exata da RPC — o limite é da Receita, não nosso */}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {quota.data?.mensagem ?? "Verificando a cota diária definida pela Receita Federal."}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Este limite é da Receita Federal, não do TECH-IVA. Usamos 1 consulta automática por dia e
            deixamos a outra reservada para você.
          </p>
        </div>

        <Button
          type="button"
          className="gap-2"
          title={!podeConsultar ? quota.data?.mensagem : undefined}
          disabled={!podeConsultar || request.isPending || quota.isLoading}
          onClick={async () => {
            try {
              await request.mutateAsync(competencia);
              toast.success("Consulta enfileirada. A Receita responde de forma assíncrona.");
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
      </section>

      {/* comparação */}
      <div className="grid gap-3 md:grid-cols-3">
        <KpiCard
          label="Nosso débito de CBS"
          value={formatCents(d?.nosso_debito_cents ?? 0)}
          loading={divergencia.isLoading}
          hint={`Competência ${formatCompetencia(competencia)}`}
        />
        <KpiCard
          label="Débito apurado pela Receita"
          value={disponivel ? formatCents(d.receita_debito_cents ?? 0) : "—"}
          loading={divergencia.isLoading}
          hint={disponivel ? "Apuração assistida recebida" : "Ainda não consultada"}
        />
        <KpiCard
          label="Diferença"
          value={disponivel ? formatCents(d.diferenca_cents) : "—"}
          loading={divergencia.isLoading}
          hint={disponivel ? (divergente ? "acima do limite de R$ 1,00" : "dentro da tolerância") : "—"}
        />
      </div>

      {!divergencia.isLoading && !disponivel && (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-surface-1 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">
            {d && "mensagem" in d ? d.mensagem : "Apuração da Receita ainda não consultada."} Use
            “Consultar Receita” acima para solicitar.
          </p>
        </div>
      )}

      {divergente && (
        <div className="rounded-xl border border-flow-out/50 bg-flow-out/10 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-flow-out">
            <AlertTriangle className="size-4" aria-hidden />
            Sua apuração diverge da Receita em <MoneyText cents={Math.abs(d.diferenca_cents)} />
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {d.diferenca_cents > 0
              ? "A Receita apurou mais do que calculamos: pode haver documento emitido que não chegou até nós."
              : "Calculamos mais do que a Receita apurou: pode haver documento que a Receita ainda não processou, ou cancelamento/devolução (ver limitação abaixo)."}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Confira os documentos da competência na lista abaixo — cada item abre a memória de cálculo
            com a base legal aplicada.
          </p>
        </div>
      )}

      {disponivel && !divergente && (
        <p className="flex items-center gap-2 text-sm text-flow-in">
          <CheckCircle2 className="size-4" aria-hidden />
          Sua apuração bate com a da Receita nesta competência.
        </p>
      )}


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


      {/* histórico de consultas */}
      <section className="rounded-xl border border-border bg-surface-1 p-4">
        <h2 className="text-base font-medium">Consultas à Receita</h2>
        {apuracoes.isLoading ? (
          <Skeleton className="mt-4 h-20 w-full" />
        ) : (apuracoes.data?.length ?? 0) === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Nenhuma consulta registrada"
              hint="Cada solicitação consome uma das 2 consultas diárias permitidas pela Receita."
            />
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-border text-sm">
            {apuracoes.data?.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div>
                  <p>
                    {formatCompetencia(a.competencia.slice(0, 7) + "-01")}{" "}
                    <Badge variant="outline" className="ml-1 text-[10px]">
                      {a.status}
                    </Badge>
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Solicitada em {new Date(a.solicitado_em).toLocaleString("pt-BR")}
                    {a.recebido_em ? ` · recebida em ${new Date(a.recebido_em).toLocaleString("pt-BR")}` : ""}
                  </p>
                  {a.erro && <p className="mt-0.5 text-[11px] text-flow-out">{a.erro}</p>}
                </div>
                <MoneyText cents={a.debitos_cents ?? 0} className="text-sm" />
              </li>
            ))}
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
