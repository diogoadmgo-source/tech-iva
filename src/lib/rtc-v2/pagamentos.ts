import { reaisParaCentavos } from "./valores";

/**
 * Leitor dos arquivos de PAGAMENTOS e RECOLHIMENTOS da v2 (documentação 1.3,
 * 13/11/2026). Os dois têm a mesma forma:
 *
 *   apuracao[].{ dataArrecadacao, pagamentos[].{ numeroDARF, tipo,
 *     composicao[].{ sequencial, pa, vencimento, ..., principal, multa, juros, total } } }
 *
 * Diferenças, todas opcionais e por isso lidas sem exigir:
 *   - recolhimentos (o que a empresa pagou como ADQUIRENTE, RAD): cada item
 *     traz `niFornecedor` e `chaveDFE`;
 *   - pagamentos (o que extinguiu débitos da empresa): `tipo` 1 = RAD (pago
 *     pelo cliente dela, com `niAdquirente`) ou 2 = PCONT (pago por ela, com
 *     `niContribuinte`).
 *
 * Nada aqui decide valor fiscal: só transporta o que veio, em centavos.
 * Uma linha por item de composição — é a granularidade em que a Receita
 * informa o valor.
 */
export type LinhaPagamentoV2 = {
  data_arrecadacao: string;
  numero_darf: string;
  tipo: number;
  ni_adquirente: string | null;
  ni_contribuinte: string | null;
  sequencial: number;
  pa: string;
  vencimento: string | null;
  ni_fornecedor: string | null;
  chave_dfe: string | null;
  principal_cents: number;
  multa_cents: number;
  juros_cents: number;
  total_cents: number;
};

function lista(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function texto(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  // Número de DARF, NI e chave podem chegar como número: sem notação científica.
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v)).toString();
  return null;
}
/** `-1` = não informado. Nunca é um tipo ou sequencial válido. */
function inteiro(v: unknown): number {
  if (v === null || v === undefined) return -1;
  if (typeof v === "string" && !v.trim()) return -1;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? Math.trunc(n) : -1;
}

export function lerPagamentosV2(arquivo: unknown): LinhaPagamentoV2[] {
  const out: LinhaPagamentoV2[] = [];
  for (const grupoBruto of lista(obj(arquivo)["apuracao"])) {
    const grupo = obj(grupoBruto);
    const data = texto(grupo["dataArrecadacao"]);
    if (!data) continue;
    for (const pagBruto of lista(grupo["pagamentos"])) {
      const pag = obj(pagBruto);
      const numero = texto(pag["numeroDARF"]);
      if (!numero) continue;
      for (const itemBruto of lista(pag["composicao"])) {
        const item = obj(itemBruto);
        const pa = texto(item["pa"]);
        if (!pa) continue;
        out.push({
          data_arrecadacao: data,
          numero_darf: numero,
          tipo: inteiro(pag["tipo"]),
          ni_adquirente: texto(pag["niAdquirente"]),
          // No PCONT o NI do contribuinte vem no pagamento; no RAD, no item.
          ni_contribuinte: texto(item["niContribuinte"]) ?? texto(pag["niContribuinte"]),
          sequencial: inteiro(item["sequencial"]),
          pa,
          vencimento: texto(item["vencimento"]),
          ni_fornecedor: texto(item["niFornecedor"]),
          chave_dfe: texto(item["chaveDFE"]),
          principal_cents: reaisParaCentavos(item["principal"]),
          multa_cents: reaisParaCentavos(item["multa"]),
          juros_cents: reaisParaCentavos(item["juros"]),
          total_cents: reaisParaCentavos(item["total"]),
        });
      }
    }
  }
  return out;
}

/**
 * O arquivo é um JSON com a lista `apuracao` — vazia quando não há nada na
 * janela. Sem a lista, não é o arquivo que esperamos: erro explícito, nunca
 * "zero recolhimentos".
 */
export function arquivoV2Reconhecido(arquivo: unknown): boolean {
  return Array.isArray(obj(arquivo)["apuracao"]);
}
