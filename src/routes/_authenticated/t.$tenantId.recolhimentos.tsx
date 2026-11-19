import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, Download, FileText, Loader2, Plus, Receipt, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, ErrorState } from "@/components/techiva/empty-state";
import { MoneyText, formatCents } from "@/components/techiva/money";
import { Page, PageHeader, Panel, Rise, Segmented } from "@/components/techiva/page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DOCUMENTO_LABEL,
  ORIGEM_LABEL,
  paTexto,
  resumirPorPa,
  textoParaCentavos,
  useAbrirV2,
  useAtualizarV2,
  useBaixarPdfDarf,
  useCotaV2,
  useDarfs,
  useDebitosV2,
  useGerarDarfPcont,
  useGerarDarfRad,
  usePagamentosV2,
  usePodeEmitirDarf,
  useSolicitacoesV2,
  type DarfRow,
  type DebitoV2,
  type RecursoV2,
  type ResumoPa,
} from "@/lib/rtc-cbs-v2";
import { RETORNO_DARF_LABEL, type OpcaoPagamento, type ResultadoDarf as Resultado } from "@/lib/rtc-v2/darf";

export const Route = createFileRoute("/_authenticated/t/$tenantId/recolhimentos")({
  head: () => ({
    meta: [
      { title: "DARF e recolhimentos da CBS — TECH-IVA" },
      {
        name: "description",
        content:
          "Débitos, pagamentos e recolhimentos da CBS pela API v2 da Receita, e geração de DARF como contribuinte e como adquirente.",
      },
    ],
  }),
  component: RecolhimentosPage,
});

type Aba = "debitos" | "recolhimentos" | "pagamentos" | "rad" | "darfs";

const ABAS: { value: Aba; label: string }[] = [
  { value: "debitos", label: "Débitos e DARF" },
  { value: "rad", label: "DARF como adquirente" },
  { value: "recolhimentos", label: "Recolhimentos" },
  { value: "pagamentos", label: "Pagamentos" },
  { value: "darfs", label: "DARFs gerados" },
];

const RECURSO_LABEL: Record<RecursoV2, string> = {
  debitos: "débitos",
  pagamentos: "pagamentos",
  recolhimentos: "recolhimentos",
};

const STATUS_LABEL: Record<string, string> = {
  solicitada: "Aguardando a Receita",
  tiquete_recebido: "Arquivo pronto",
  disponivel: "Recebida",
  erro: "Erro",
};

function dataBr(iso: string | null | undefined) {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function horaBr(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function copiar(texto: string, rotulo: string) {
  void navigator.clipboard.writeText(texto).then(
    () => toast.success(`${rotulo} copiado.`),
    () => toast.error("Não foi possível copiar."),
  );
}

function RecolhimentosPage() {
  const { tenantId } = Route.useParams();
  const [aba, setAba] = useState<Aba>("debitos");
  const [polling, setPolling] = useState(false);

  const cota = useCotaV2(tenantId);
  const solicitacoes = useSolicitacoesV2(tenantId, polling);
  const abrir = useAbrirV2(tenantId);
  const atualizar = useAtualizarV2(tenantId);
  const pode = usePodeEmitirDarf(tenantId);

  const pendentes = (solicitacoes.data ?? []).filter((s) => s.status === "solicitada" || s.status === "tiquete_recebido");

  // Enquanto houver solicitação aberta, acompanha sozinho: situação → link →
  // arquivo → banco. Desliga quando nada mais está pendente, ou após 20 min.
  useEffect(() => {
    if (pendentes.length > 0 && !polling) setPolling(true);
    if (pendentes.length === 0 && polling) setPolling(false);
  }, [pendentes.length, polling]);
  useEffect(() => {
    if (!polling) return;
    const passo = setInterval(() => {
      if (!atualizar.isPending) atualizar.mutate();
    }, 45_000);
    const teto = setTimeout(() => setPolling(false), 20 * 60_000);
    return () => {
      clearInterval(passo);
      clearTimeout(teto);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling]);

  const consultar = async (recurso: RecursoV2) => {
    try {
      await abrir.mutateAsync(recurso);
      toast.success(
        `Consulta de ${RECURSO_LABEL[recurso]} pedida à Receita. O arquivo costuma levar alguns minutos e esta tela acompanha sozinha.`,
      );
      setPolling(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao pedir a consulta.");
    }
  };

  const botaoConsultar = (recurso: RecursoV2) => {
    const c = cota.data?.[recurso];
    const esgotada = c ? !c.pode_manual : false;
    return (
      <Button
        type="button"
        variant="outline"
        className="gap-2"
        disabled={abrir.isPending || esgotada}
        title={`Gasta 1 das 4 consultas de ${RECURSO_LABEL[recurso]} do dia. A cota reinicia à meia-noite.`}
        onClick={() => void consultar(recurso)}
      >
        {abrir.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        Consultar {RECURSO_LABEL[recurso]}
        {c ? (
          <span className="text-xs text-muted-foreground">
            {c.restantes}/{c.limite}
          </span>
        ) : null}
      </Button>
    );
  };

  return (
    <Page>
      <PageHeader
        eyebrow="Caixa do imposto"
        title="DARF e recolhimentos da CBS"
        help={
          <>
            Dados da Apuração Assistida da CBS pela API v2 da Receita. Cada consulta (débitos, pagamentos ou
            recolhimentos) gasta 1 das 4 permitidas por dia para aquela API. O arquivo chega em alguns minutos. O
            DARF é gerado na hora, sobre os valores que a Receita já processou, e é um documento oficial: confira
            antes de confirmar.
          </>
        }
        meta={
          pendentes.length > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" /> {pendentes.length} consulta(s) aguardando a Receita
            </span>
          ) : solicitacoes.data?.[0] ? (
            <span>Última consulta: {horaBr(solicitacoes.data[0].solicitado_em)}</span>
          ) : (
            <span>Nenhuma consulta pela API v2 ainda</span>
          )
        }
        actions={
          <Button
            type="button"
            variant="ghost"
            className="gap-2"
            disabled={atualizar.isPending}
            title="Confere se a Receita já terminou as consultas abertas. Não gasta consulta do dia."
            onClick={async () => {
              try {
                const r = await atualizar.mutateAsync();
                if (r.processadas > 0) toast.success(`${r.processadas} arquivo(s) recebido(s).`);
                else if (r.falhas.length > 0) toast.message(r.falhas[0] ?? "Ainda aguardando a Receita.");
                else toast.message("Nada novo da Receita ainda.");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Falha ao atualizar.");
              }
            }}
          >
            {atualizar.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Atualizar
          </Button>
        }
      />

      <Rise index={1}>
        <Segmented label="Seções" value={aba} options={ABAS} onChange={setAba} />
      </Rise>

      {solicitacoes.data?.some((s) => s.status === "erro" && s.erro) ? (
        <Rise index={2}>
          <Panel>
            <p className="text-sm text-muted-foreground">
              Última consulta com erro ({RECURSO_LABEL[(solicitacoes.data.find((s) => s.status === "erro")?.recurso ?? "debitos") as RecursoV2] ?? "—"}):{" "}
              <span className="text-foreground">{solicitacoes.data.find((s) => s.status === "erro")?.erro}</span>
            </p>
          </Panel>
        </Rise>
      ) : null}

      <Rise index={3}>
        {aba === "debitos" ? (
          <DebitosAba tenantId={tenantId} acao={botaoConsultar("debitos")} podeDarf={pode.data === true} />
        ) : aba === "rad" ? (
          <RadAba tenantId={tenantId} podeDarf={pode.data === true} />
        ) : aba === "recolhimentos" ? (
          <PagamentosAba tenantId={tenantId} recurso="recolhimentos" acao={botaoConsultar("recolhimentos")} />
        ) : aba === "pagamentos" ? (
          <PagamentosAba tenantId={tenantId} recurso="pagamentos" acao={botaoConsultar("pagamentos")} />
        ) : (
          <DarfsAba tenantId={tenantId} />
        )}
      </Rise>
    </Page>
  );
}

/* ------------------------------------------------------- débitos + PCONT */

function DebitosAba({ tenantId, acao, podeDarf }: { tenantId: string; acao: ReactNode; podeDarf: boolean }) {
  const debitos = useDebitosV2(tenantId);
  const resumo = useMemo(() => resumirPorPa(debitos.data ?? []), [debitos.data]);
  const [paAberto, setPaAberto] = useState<string | null>(null);
  const [darfPa, setDarfPa] = useState<ResumoPa | null>(null);

  if (debitos.isLoading) return <Skeleton className="h-48 w-full" />;
  if (debitos.error) return <ErrorState message={debitos.error.message} onRetry={() => void debitos.refetch()} />;

  return (
    <Panel
      title="Débitos por período de apuração"
      icon={FileText}
      help="Somas dos débitos que a Receita devolveu na API v2. A janela da Receita é incremental: cada consulta traz o que foi incluído ou atualizado nos últimos 8 dias e atualiza o que já estava aqui."
      actions={acao}
      bodyClassName="p-0"
    >
      {resumo.length === 0 ? (
        <EmptyState
          className="m-4"
          title="Nenhum débito recebido pela API v2"
          hint="Use Consultar débitos. A primeira consulta traz desde o dia 1º do mês corrente."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Período</TableHead>
              <TableHead className="text-right">Documentos</TableHead>
              <TableHead className="text-right">Apurado</TableHead>
              <TableHead className="text-right">Extinto</TableHead>
              <TableHead className="text-right">Pgto. antecipado</TableHead>
              <TableHead className="text-right">Suspenso/inexigível</TableHead>
              <TableHead className="text-right">Saldo devedor</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {resumo.map((r) => (
              <Fragment key={r.pa}>
                <TableRow className="cursor-pointer" onClick={() => setPaAberto(paAberto === r.pa ? null : r.pa)}>
                  <TableCell className="font-medium">{paTexto(r.pa)}</TableCell>
                  <TableCell className="text-right">{r.documentos}</TableCell>
                  <TableCell className="text-right"><MoneyText cents={r.apurado_cents} /></TableCell>
                  <TableCell className="text-right"><MoneyText cents={r.extinto_cents} /></TableCell>
                  <TableCell className="text-right"><MoneyText cents={r.pgto_antecipado_cents} /></TableCell>
                  <TableCell className="text-right"><MoneyText cents={r.suspenso_cents + r.inexigivel_cents} /></TableCell>
                  <TableCell className="text-right font-semibold"><MoneyText cents={r.saldo_devedor_cents} /></TableCell>
                  <TableCell className="text-right">
                    {podeDarf && r.saldo_devedor_cents > 0 ? (
                      <Button
                        size="sm"
                        className="gap-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDarfPa(r);
                        }}
                      >
                        <Receipt className="size-4" /> Gerar DARF
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
                {paAberto === r.pa ? (
                  <TableRow>
                    <TableCell colSpan={8} className="bg-surface-2/40 p-0">
                      <DetalhePa linhas={(debitos.data ?? []).filter((l) => l.pa === r.pa)} />
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}
      {!podeDarf && resumo.length > 0 ? (
        <p className="px-4 pb-4 text-xs text-muted-foreground">
          Gerar DARF é permitido ao dono, ao financeiro e aos administradores da empresa.
        </p>
      ) : null}
      {darfPa ? <DialogPcont tenantId={tenantId} resumo={darfPa} onClose={() => setDarfPa(null)} /> : null}
    </Panel>
  );
}

function DetalhePa({ linhas }: { linhas: DebitoV2[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Documento</TableHead>
          <TableHead>Origem</TableHead>
          <TableHead>Chave</TableHead>
          <TableHead>Emissão</TableHead>
          <TableHead className="text-right">Apurado</TableHead>
          <TableHead className="text-right">Saldo devedor</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {linhas.slice(0, 200).map((l) => (
          <TableRow key={l.id}>
            <TableCell>{DOCUMENTO_LABEL[l.documento] ?? l.documento}</TableCell>
            <TableCell>{ORIGEM_LABEL[l.origem] ?? l.origem}</TableCell>
            <TableCell className="max-w-[16rem] truncate font-mono text-xs" title={l.chave}>{l.chave}</TableCell>
            <TableCell>{dataBr(l.emissao)}</TableCell>
            <TableCell className="text-right"><MoneyText cents={l.apurado_cents} /></TableCell>
            <TableCell className="text-right"><MoneyText cents={l.saldo_devedor_cents} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DialogPcont({ tenantId, resumo, onClose }: { tenantId: string; resumo: ResumoPa; onClose: () => void }) {
  const gerar = useGerarDarfPcont(tenantId);
  const [opcao, setOpcao] = useState<OpcaoPagamento>("PAGAMENTO_TOTAL");
  const [valor, setValor] = useState("");
  const valorCents = opcao === "PAGAMENTO_PARCIAL" ? textoParaCentavos(valor) : null;
  const invalido = opcao === "PAGAMENTO_PARCIAL" && (!valorCents || valorCents <= 0);
  const [resultado, setResultado] = useState<DarfRow | null>(null);

  return (
    <AlertDialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Gerar DARF da CBS · {paTexto(resumo.pa)}</AlertDialogTitle>
          <AlertDialogDescription>
            Pagamento como contribuinte. Saldo devedor informado pela Receita:{" "}
            <strong>{formatCents(resumo.saldo_devedor_cents)}</strong>. A Receita calcula multa e juros e devolve o
            valor final. O DARF gerado é um documento oficial.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {resultado ? (
          <ResultadoDarf darf={resultado} />
        ) : (
          <div className="space-y-3">
            <Segmented
              label="Opção de pagamento"
              value={opcao}
              onChange={setOpcao}
              options={[
                { value: "PAGAMENTO_TOTAL", label: "Total" },
                { value: "PAGAMENTO_PARCIAL", label: "Parcial" },
              ]}
            />
            {opcao === "PAGAMENTO_PARCIAL" ? (
              <div className="space-y-1">
                <Label htmlFor="valor-parcial">Valor do pagamento parcial (R$)</Label>
                <Input id="valor-parcial" inputMode="decimal" placeholder="1.500,75" value={valor} onChange={(e) => setValor(e.target.value)} />
              </div>
            ) : null}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{resultado ? "Fechar" : "Cancelar"}</AlertDialogCancel>
          {resultado ? null : (
            <AlertDialogAction
              disabled={invalido || gerar.isPending}
              onClick={async (e) => {
                e.preventDefault();
                try {
                  const darfs = await gerar.mutateAsync({ pa: resumo.pa.slice(0, 7), opcao, valorParcialCents: valorCents });
                  const r = darfs[0]?.resultado;
                  if (!r) throw new Error("A Receita não devolveu resultado.");
                  setResultado(paraLinha(r, "pcont", resumo.pa));
                  if (r.gerado) toast.success("DARF gerado.");
                  else toast.error(RETORNO_DARF_LABEL[r.cdRetorno] ?? r.cdRetorno);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Falha ao gerar o DARF.");
                }
              }}
            >
              {gerar.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Confirmar e gerar DARF
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function paraLinha(
  r: Resultado,
  tipo: "pcont" | "rad",
  pa: string | null,
): DarfRow {
  return {
    id: "",
    tipo,
    pa,
    chave_dfe: r.chaveDFE,
    opcao_pagamento: "PAGAMENTO_TOTAL",
    valor_parcial_cents: null,
    cd_retorno: r.cdRetorno,
    gerado: r.gerado,
    chave_pix: r.chavePix,
    codigo_barras: r.codigoBarras,
    link_pdf: r.linkPdf,
    data_maxima: r.dataMaxima,
    principal_cents: r.principalCents,
    multa_cents: r.multaCents,
    juros_cents: r.jurosCents,
    total_cents: r.totalCents,
    mensagem: r.mensagem,
    dados_invalidos: r.dadosInvalidos,
    criado_em: new Date().toISOString(),
  };
}

function ResultadoDarf({ darf }: { darf: DarfRow }) {
  if (!darf.gerado) {
    return (
      <div className="space-y-1 rounded-md border border-destructive/40 p-3 text-sm">
        <p className="font-medium text-destructive">{RETORNO_DARF_LABEL[darf.cd_retorno] ?? darf.cd_retorno}</p>
        {darf.mensagem ? <p className="text-muted-foreground">{darf.mensagem}</p> : null}
        {darf.dados_invalidos.length > 0 ? (
          <p className="text-muted-foreground">Campos recusados: {darf.dados_invalidos.join(", ")}</p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-border/60 p-3 text-sm">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="text-muted-foreground">Pagar até</span>
        <span className="text-right font-medium">{dataBr(darf.data_maxima)}</span>
        <span className="text-muted-foreground">Principal</span>
        <span className="text-right">{darf.principal_cents !== null ? formatCents(darf.principal_cents) : "—"}</span>
        {darf.multa_cents !== null ? (
          <>
            <span className="text-muted-foreground">Multa</span>
            <span className="text-right">{formatCents(darf.multa_cents)}</span>
          </>
        ) : null}
        {darf.juros_cents !== null ? (
          <>
            <span className="text-muted-foreground">Juros</span>
            <span className="text-right">{formatCents(darf.juros_cents)}</span>
          </>
        ) : null}
        <span className="font-medium">Total</span>
        <span className="text-right font-semibold">{darf.total_cents !== null ? formatCents(darf.total_cents) : "—"}</span>
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        {darf.chave_pix ? (
          <Button size="sm" variant="outline" className="gap-1" onClick={() => copiar(darf.chave_pix as string, "PIX")}>
            <Copy className="size-3.5" /> Copiar PIX
          </Button>
        ) : null}
        {darf.codigo_barras ? (
          <Button size="sm" variant="outline" className="gap-1" onClick={() => copiar(darf.codigo_barras as string, "Código de barras")}>
            <Copy className="size-3.5" /> Copiar código de barras
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">O PDF fica disponível na aba "DARFs gerados".</p>
    </div>
  );
}

/* -------------------------------------------------------------- RAD */

type LinhaRad = { chave: string; opcao: OpcaoPagamento; valor: string };

function RadAba({ tenantId, podeDarf }: { tenantId: string; podeDarf: boolean }) {
  const gerar = useGerarDarfRad(tenantId);
  const [linhas, setLinhas] = useState<LinhaRad[]>([{ chave: "", opcao: "PAGAMENTO_TOTAL", valor: "" }]);
  const [confirmar, setConfirmar] = useState(false);
  const [resultados, setResultados] = useState<DarfRow[]>([]);

  const preenchidas = linhas.filter((l) => l.chave.trim());
  const invalida = preenchidas.some(
    (l) =>
      !/^[0-9A-Za-z]{20,100}$/.test(l.chave.replace(/\s/g, "")) ||
      (l.opcao === "PAGAMENTO_PARCIAL" && !textoParaCentavos(l.valor)),
  );

  if (!podeDarf) {
    return (
      <Panel title="DARF como adquirente" icon={Receipt}>
        <EmptyState title="Sem permissão" hint="Gerar DARF é permitido ao dono, ao financeiro e aos administradores da empresa." />
      </Panel>
    );
  }

  const atualizar = (i: number, parte: Partial<LinhaRad>) =>
    setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, ...parte } : l)));

  return (
    <Panel
      title="DARF como adquirente (RAD)"
      icon={Receipt}
      help="Recolhimento da CBS pelo adquirente: você paga o débito do fornecedor, nota a nota, e o valor vira crédito seu. Informe a chave de cada documento fiscal em que sua empresa é a adquirente."
    >
      <div className="space-y-2">
        {linhas.map((l, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[18rem] flex-1 space-y-1">
              {i === 0 ? <Label>Chave do documento fiscal</Label> : null}
              <Input
                className="font-mono text-xs"
                placeholder="44 dígitos da NF-e, CT-e, NFS-e…"
                value={l.chave}
                onChange={(e) => atualizar(i, { chave: e.target.value })}
                onPaste={(e) => {
                  // Colar várias chaves de uma vez: uma por linha.
                  const texto = e.clipboardData.getData("text");
                  const chaves = texto.split(/[\s,;]+/).filter(Boolean);
                  if (chaves.length < 2) return;
                  e.preventDefault();
                  setLinhas((ls) => [
                    ...ls.slice(0, i),
                    ...chaves.slice(0, 50).map((c) => ({ chave: c, opcao: "PAGAMENTO_TOTAL" as const, valor: "" })),
                    ...ls.slice(i + 1),
                  ]);
                }}
              />
            </div>
            <Segmented
              label="Opção"
              value={l.opcao}
              onChange={(v) => atualizar(i, { opcao: v })}
              options={[
                { value: "PAGAMENTO_TOTAL", label: "Total" },
                { value: "PAGAMENTO_PARCIAL", label: "Parcial" },
              ]}
            />
            {l.opcao === "PAGAMENTO_PARCIAL" ? (
              <Input className="w-32" inputMode="decimal" placeholder="R$" value={l.valor} onChange={(e) => atualizar(i, { valor: e.target.value })} />
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remover"
              disabled={linhas.length === 1}
              onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            className="gap-1"
            disabled={linhas.length >= 50}
            onClick={() => setLinhas((ls) => [...ls, { chave: "", opcao: "PAGAMENTO_TOTAL", valor: "" }])}
          >
            <Plus className="size-4" /> Adicionar nota
          </Button>
          <Button type="button" className="gap-1" disabled={preenchidas.length === 0 || invalida || gerar.isPending} onClick={() => setConfirmar(true)}>
            <Receipt className="size-4" /> Gerar DARF ({preenchidas.length} nota{preenchidas.length === 1 ? "" : "s"})
          </Button>
        </div>
        {invalida ? (
          <p className="text-xs text-destructive">Confira as chaves (só letras e números) e os valores parciais.</p>
        ) : null}
      </div>

      {resultados.length > 0 ? (
        <div className="mt-4 space-y-2">
          {resultados.map((r, i) => (
            <div key={i}>
              {r.chave_dfe ? <p className="mb-1 font-mono text-xs text-muted-foreground">{r.chave_dfe}</p> : null}
              <ResultadoDarf darf={r} />
            </div>
          ))}
        </div>
      ) : null}

      <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar a geração do DARF</AlertDialogTitle>
            <AlertDialogDescription>
              {preenchidas.length} documento(s) fiscal(is), como adquirente. A Receita gera o documento de
              arrecadação na hora, com os valores que ela processou. É um documento oficial.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={gerar.isPending}
              onClick={async (e) => {
                e.preventDefault();
                try {
                  const darfs = await gerar.mutateAsync(
                    preenchidas.map((l) => ({
                      chaveDFE: l.chave.replace(/\s/g, ""),
                      opcao: l.opcao,
                      valorParcialCents: l.opcao === "PAGAMENTO_PARCIAL" ? textoParaCentavos(l.valor) : null,
                    })),
                  );
                  setResultados(darfs.map((d) => ({ ...paraLinha(d.resultado, "rad", null), chave_dfe: d.chaveDFE })));
                  const ok = darfs.filter((d) => d.resultado.gerado).length;
                  if (ok > 0) toast.success(`${ok} DARF(s) gerado(s).`);
                  else toast.error("A Receita não gerou o DARF. Veja o motivo abaixo.");
                  setConfirmar(false);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Falha ao gerar o DARF.");
                }
              }}
            >
              {gerar.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Confirmar e gerar DARF
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}

/* ------------------------------------------------ pagamentos/recolhimentos */

function PagamentosAba({
  tenantId,
  recurso,
  acao,
}: {
  tenantId: string;
  recurso: "pagamentos" | "recolhimentos";
  acao: ReactNode;
}) {
  const q = usePagamentosV2(tenantId, recurso);
  const titulo = recurso === "recolhimentos" ? "Recolhimentos como adquirente" : "Pagamentos que extinguiram seus débitos";
  const help =
    recurso === "recolhimentos"
      ? "DARFs que a sua empresa pagou como adquirente (RAD): extinguem o débito do fornecedor e viram crédito seu."
      : "Pagamentos que extinguiram débitos da sua empresa: os seus (PCONT) e os feitos pelos seus clientes como adquirentes (RAD).";

  if (q.isLoading) return <Skeleton className="h-48 w-full" />;
  if (q.error) return <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />;
  const linhas = q.data ?? [];
  const total = linhas.reduce((s, l) => s + Number(l.total_cents), 0);

  return (
    <Panel title={titulo} icon={Receipt} help={help} actions={acao} bodyClassName="p-0">
      {linhas.length === 0 ? (
        <EmptyState
          className="m-4"
          title={`Nenhum registro de ${recurso} recebido`}
          hint={`Use Consultar ${recurso}. A primeira consulta traz desde o dia 1º do mês corrente.`}
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Arrecadação</TableHead>
                <TableHead>DARF</TableHead>
                {recurso === "pagamentos" ? <TableHead>Tipo</TableHead> : null}
                <TableHead>Período</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>{recurso === "recolhimentos" ? "Fornecedor" : "Pago por"}</TableHead>
                <TableHead>Chave do documento</TableHead>
                <TableHead className="text-right">Principal</TableHead>
                <TableHead className="text-right">Multa + juros</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{dataBr(l.data_arrecadacao)}</TableCell>
                  <TableCell className="font-mono text-xs">{l.numero_darf}</TableCell>
                  {recurso === "pagamentos" ? (
                    <TableCell>
                      <Badge variant="outline">{l.tipo === 1 ? "RAD" : l.tipo === 2 ? "PCONT" : l.tipo}</Badge>
                    </TableCell>
                  ) : null}
                  <TableCell>{paTexto(l.pa)}</TableCell>
                  <TableCell>{dataBr(l.vencimento)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {recurso === "recolhimentos" ? (l.ni_fornecedor ?? "—") : l.tipo === 1 ? (l.ni_adquirente ?? "—") : "Sua empresa"}
                  </TableCell>
                  <TableCell className="max-w-[12rem] truncate font-mono text-xs" title={l.chave_dfe ?? ""}>
                    {l.chave_dfe ?? "—"}
                  </TableCell>
                  <TableCell className="text-right"><MoneyText cents={l.principal_cents} /></TableCell>
                  <TableCell className="text-right"><MoneyText cents={Number(l.multa_cents) + Number(l.juros_cents)} /></TableCell>
                  <TableCell className="text-right font-medium"><MoneyText cents={l.total_cents} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="px-4 py-3 text-right text-sm">
            Total: <strong>{formatCents(total)}</strong>
          </p>
        </>
      )}
    </Panel>
  );
}

/* --------------------------------------------------------- DARFs gerados */

function DarfsAba({ tenantId }: { tenantId: string }) {
  const q = useDarfs(tenantId);
  const pdf = useBaixarPdfDarf(tenantId);
  if (q.isLoading) return <Skeleton className="h-48 w-full" />;
  if (q.error) return <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />;
  const linhas = q.data ?? [];
  return (
    <Panel
      title="DARFs gerados pelo aplicativo"
      icon={Receipt}
      help="Todo pedido de DARF feito por aqui, inclusive os recusados pela Receita, com quem pediu e quando."
      bodyClassName="p-0"
    >
      {linhas.length === 0 ? (
        <EmptyState className="m-4" title="Nenhum DARF gerado ainda" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Gerado em</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Período / documento</TableHead>
              <TableHead>Resultado</TableHead>
              <TableHead>Pagar até</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((d) => (
              <TableRow key={d.id}>
                <TableCell>{horaBr(d.criado_em)}</TableCell>
                <TableCell>
                  <Badge variant="outline">{d.tipo === "pcont" ? "Contribuinte" : "Adquirente"}</Badge>
                </TableCell>
                <TableCell className="max-w-[14rem] truncate font-mono text-xs" title={d.chave_dfe ?? d.pa ?? ""}>
                  {d.pa ?? d.chave_dfe ?? "—"}
                  {d.opcao_pagamento === "PAGAMENTO_PARCIAL" ? " · parcial" : ""}
                </TableCell>
                <TableCell>
                  {d.gerado ? (
                    <Badge>Gerado</Badge>
                  ) : (
                    <span className="text-xs text-destructive" title={d.mensagem ?? ""}>
                      {RETORNO_DARF_LABEL[d.cd_retorno] ?? d.cd_retorno}
                    </span>
                  )}
                </TableCell>
                <TableCell>{dataBr(d.data_maxima)}</TableCell>
                <TableCell className="text-right font-medium">
                  {d.total_cents !== null ? <MoneyText cents={d.total_cents} /> : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {d.chave_pix ? (
                      <Button size="sm" variant="ghost" title="Copiar PIX" onClick={() => copiar(d.chave_pix as string, "PIX")}>
                        PIX
                      </Button>
                    ) : null}
                    {d.codigo_barras ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Copiar código de barras"
                        onClick={() => copiar(d.codigo_barras as string, "Código de barras")}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    ) : null}
                    {d.link_pdf ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Baixar PDF"
                        disabled={pdf.isPending}
                        onClick={async () => {
                          try {
                            await pdf.mutateAsync(d.id);
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Falha ao baixar o PDF.");
                          }
                        }}
                      >
                        <Download className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}
