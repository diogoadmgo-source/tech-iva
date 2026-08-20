import { useEffect, useMemo, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Coins, Download, ScanSearch, Search } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/techiva/empty-state";
import { formatCents } from "@/components/techiva/money";
import { Panel, Rise, Segmented } from "@/components/techiva/page";
import { Pager } from "@/components/techiva/pager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_PAGE_SIZE } from "@/lib/paginate";
import { downloadCsv } from "@/lib/pricing";
import {
  CONCILIACAO_ORDER_LABEL,
  conciliacaoCsv,
  DEBITO_SITUACAO_LABEL,
  fetchConciliacaoAll,
  formatCompetencia,
  GRUPO_LABEL,
  motivoDivergencia,
  useConciliacaoPage,
  useExtincaoResumo,
  type ConciliacaoOrder,
} from "@/lib/rtc";

/**
 * Conciliação nota a nota: sai do total e aponta a nota. Paginada e ordenada no
 * SERVIDOR (RPC conciliacao_documentos_page) — a competência de uma empresa
 * grande tem centenas de milhares de documentos, e ordenar/cortar no navegador
 * significaria carregar tudo (e o PostgREST cortaria em 1000 linhas calado).
 */
export function ConciliacaoPanel({
  tenantId,
  competencia,
  index = 0,
}: {
  tenantId: string;
  competencia: string;
  index?: number | undefined;
}) {
  const [escopo, setEscopo] = useState<"divergentes" | "todos">("divergentes");
  const [order, setOrder] = useState<ConciliacaoOrder>("diferenca");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [busca, setBusca] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [exporting, setExporting] = useState(false);

  // busca no servidor, com respiro para não disparar RPC a cada tecla
  useEffect(() => {
    const t = setTimeout(() => setSearch(busca.trim()), 350);
    return () => clearTimeout(t);
  }, [busca]);

  // qualquer troca de filtro/ordem volta para a primeira página
  useEffect(() => {
    setPage(0);
  }, [escopo, order, dir, search, pageSize, competencia]);

  const query = useMemo(
    () => ({
      soDivergentes: escopo === "divergentes",
      order,
      dir,
      page,
      pageSize,
      search,
    }),
    [escopo, order, dir, page, pageSize, search],
  );

  const docs = useConciliacaoPage(tenantId, competencia, query);
  const rows = docs.data?.rows ?? [];
  const total = docs.data?.total ?? 0;

  async function exportarCsv() {
    setExporting(true);
    try {
      const all = await fetchConciliacaoAll(tenantId, competencia, {
        soDivergentes: query.soDivergentes,
        order,
        dir,
        search,
      });
      downloadCsv(`conciliacao-${competencia.slice(0, 7)}.csv`, conciliacaoCsv(all));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Rise index={index}>
      <Panel
        title="Conciliação nota a nota"
        icon={ScanSearch}
        help={
          <>
            <p>
              A Receita apura o débito de CBS <strong>documento por documento</strong>. Aqui cada
              chave de DF-e é casada com a sua nota, então a divergência deixa de ser um total e
              passa a ser uma nota com nome e valor.
            </p>
            <p>
              Linha sem valor no nosso cálculo é nota que a Receita tem e nós não recebemos.
              “Ainda devido” é o que falta pagar naquele documento.
            </p>
            <p>
              A lista é paginada e ordenada no servidor: a contagem e a ordem valem para a
              competência inteira, não só para as linhas visíveis. O CSV sai completo.
            </p>
          </>
        }
        actions={
          <>
            <Segmented
              label="Escopo da conciliação"
              value={escopo}
              onChange={setEscopo}
              options={[
                { value: "divergentes", label: "Divergentes" },
                { value: "todos", label: "Todos" },
              ]}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={total === 0 || exporting}
              onClick={exportarCsv}
            >
              <Download className="size-4" aria-hidden />
              {exporting ? "Gerando…" : "CSV"}
            </Button>
          </>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Número, chave ou contraparte"
              aria-label="Buscar documento na conciliação"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Select value={order} onValueChange={(v) => setOrder(v as ConciliacaoOrder)}>
            <SelectTrigger className="h-8 w-44 text-xs" aria-label="Ordenar por">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(CONCILIACAO_ORDER_LABEL) as ConciliacaoOrder[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {CONCILIACAO_ORDER_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-2 px-2 text-xs"
            onClick={() => setDir((d) => (d === "desc" ? "asc" : "desc"))}
            aria-label={dir === "desc" ? "Ordem decrescente" : "Ordem crescente"}
          >
            {dir === "desc" ? (
              <ArrowDownWideNarrow className="size-4" aria-hidden />
            ) : (
              <ArrowUpNarrowWide className="size-4" aria-hidden />
            )}
            {dir === "desc" ? "Maior primeiro" : "Menor primeiro"}
          </Button>
        </div>

        {docs.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : docs.isError ? (
          <EmptyState
            title="Não foi possível carregar a conciliação"
            hint={(docs.error as Error).message}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={
              search
                ? "Nenhum documento encontrado para esta busca"
                : escopo === "divergentes"
                  ? "Nenhum documento divergente nesta competência"
                  : "Nenhum débito por documento recebido nesta competência"
            }
          />
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[46rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border/70">
                    <th scope="col" className="th-label">
                      Situação
                    </th>
                    <th scope="col" className="th-label">
                      Documento
                    </th>
                    <th scope="col" className="th-label !text-right">
                      Receita
                    </th>
                    <th scope="col" className="th-label !text-right">
                      Nosso
                    </th>
                    <th scope="col" className="th-label !text-right">
                      Diferença
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((doc) => {
                    const diff = doc.diferenca_cents ?? 0;
                    const semNosso = (doc.nosso_cents ?? 0) === 0 && (doc.receita_cents ?? 0) > 0;
                    const level: SemaphoreLevel = diff === 0 ? "ok" : semNosso ? "crit" : "warn";
                    return (
                      <tr key={doc.debito_id} className="row-hover border-b border-border/50">
                        <td className="px-3 py-2.5 align-top">
                          <Semaphore level={level} showLabel={false} />
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="font-mono tabular text-xs text-muted-foreground">
                              {doc.numero_dfe ?? "s/n"}
                            </span>
                            <span className="truncate">
                              {doc.contraparte ?? "contraparte não identificada"}
                            </span>
                            {doc.grupo && doc.grupo !== "corrente" ? (
                              <Badge variant="outline" className="text-[10px]">
                                {GRUPO_LABEL[doc.grupo] ?? doc.grupo}
                              </Badge>
                            ) : null}
                            {doc.situacao ? (
                              <Badge variant="secondary" className="text-[10px]">
                                {DEBITO_SITUACAO_LABEL[doc.situacao] ?? doc.situacao}
                              </Badge>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {motivoDivergencia(doc)}
                            {doc.chave_dfe ? (
                              <span className="font-mono tabular"> · {doc.chave_dfe}</span>
                            ) : null}
                          </p>
                        </td>
                        <td className="num px-3 py-2.5 align-top">
                          {formatCents(doc.receita_cents ?? 0)}
                        </td>
                        <td className="num px-3 py-2.5 align-top">
                          {formatCents(doc.nosso_cents ?? 0)}
                        </td>
                        <td
                          className={`num px-3 py-2.5 align-top ${
                            diff === 0 ? "" : diff > 0 ? "text-flow-out" : "text-primary"
                          }`}
                        >
                          {formatCents(diff)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              unit="documento(s)"
              loading={docs.isFetching}
              className="-mx-4 mt-2 px-4 sm:-mx-5 sm:px-5"
            />
          </>
        )}
      </Panel>
    </Rise>
  );
}


function Coluna({
  label,
  cents,
  className,
}: {
  label: string;
  cents: number;
  className?: string | undefined;
}) {
  return (
    <div>
      <p className="text-[10px] tracking-[0.08em] text-muted-foreground uppercase">{label}</p>
      <p className={`font-mono text-sm tabular-nums ${className ?? ""}`}>{formatCents(cents)}</p>
    </div>
  );
}

/** Como o débito foi extinto: dinheiro, crédito de CBS ou crédito de PIS/COFINS. */
export function ExtincaoPanel({
  tenantId,
  competencia,
  index = 0,
}: {
  tenantId: string;
  competencia: string;
  index?: number | undefined;
}) {
  const resumo = useExtincaoResumo(tenantId, competencia);
  const r = resumo.data;

  return (
    <Rise index={index}>
      <Panel
        title="Como o imposto foi extinto"
        icon={Coins}
        help={
          <>
            <p>
              O débito de CBS pode ser quitado em dinheiro ou abatido com crédito — inclusive
              crédito de PIS/COFINS do estoque da transição, que reduz o desembolso real.
            </p>
            <p>
              Débito extemporâneo é de competência anterior que caiu neste mês: caixa que aparece
              do passado e a projeção mensal ignoraria.
            </p>
          </>
        }
      >
        {resumo.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : !r || r.documentos === 0 ? (
          <EmptyState title={`Sem débito por documento em ${formatCompetencia(competencia)}`} />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Coluna label="Débito total" cents={r.debito_total_cents} />
              <Coluna label="Pago em dinheiro" cents={r.por_pagamento_cents} />
              <Coluna label="Crédito de CBS" cents={r.por_credito_cbs_cents} />
              <Coluna label="Crédito PIS/COFINS" cents={r.por_credito_piscofins_cents} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                {r.documentos.toLocaleString("pt-BR")} documento(s)
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {r.documentos_em_aberto.toLocaleString("pt-BR")} em aberto ·{" "}
                {formatCents(r.ainda_devido_cents)}
              </Badge>
              {r.extemporaneos_cents > 0 ? (
                <Badge variant="secondary" className="text-[10px]">
                  extemporâneo {formatCents(r.extemporaneos_cents)}
                </Badge>
              ) : null}
            </div>
          </>
        )}
      </Panel>
    </Rise>
  );
}
