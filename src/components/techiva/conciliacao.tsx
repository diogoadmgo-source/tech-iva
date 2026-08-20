import { useState } from "react";
import { Coins, Download, ScanSearch } from "lucide-react";

import { EmptyState } from "@/components/techiva/empty-state";
import { formatCents } from "@/components/techiva/money";
import { Panel, Rise, Segmented } from "@/components/techiva/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadCsv } from "@/lib/pricing";
import {
  conciliacaoCsv,
  DEBITO_SITUACAO_LABEL,
  formatCompetencia,
  GRUPO_LABEL,
  motivoDivergencia,
  useConciliacaoDocumentos,
  useExtincaoResumo,
} from "@/lib/rtc";

/**
 * Conciliação nota a nota: sai do total e aponta a nota. Alimentado pelas RPCs
 * conciliacao_documentos e extincao_resumo (débito por documento da Receita).
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
  const docs = useConciliacaoDocumentos(tenantId, competencia, escopo === "divergentes");
  const rows = docs.data ?? [];

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
              disabled={rows.length === 0}
              onClick={() =>
                downloadCsv(
                  `conciliacao-${competencia.slice(0, 7)}.csv`,
                  conciliacaoCsv(rows),
                )
              }
            >
              <Download className="size-4" aria-hidden />
              CSV
            </Button>
          </>
        }
      >
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
              escopo === "divergentes"
                ? "Nenhum documento divergente nesta competência"
                : "Nenhum débito por documento recebido nesta competência"
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((doc, i) => {
              const diff = doc.diferenca_cents ?? 0;
              return (
                <li
                  key={`${doc.chave_dfe ?? doc.numero_dfe ?? "doc"}-${i}`}
                  className="flex flex-wrap items-start justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono text-xs text-muted-foreground">
                        {doc.numero_dfe ?? "s/n"}
                      </span>
                      <span className="truncate">{doc.contraparte ?? "contraparte não identificada"}</span>
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
                      {doc.chave_dfe ? ` · ${doc.chave_dfe}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <Coluna label="Receita" cents={doc.receita_cents ?? 0} />
                    <Coluna label="Nosso" cents={doc.nosso_cents ?? 0} />
                    <Coluna
                      label="Diferença"
                      cents={diff}
                      className={diff === 0 ? undefined : diff > 0 ? "text-flow-out" : "text-primary"}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
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
