import { reaisParaCentavos } from "./valores";

/**
 * PORTÃO: escrito contra o esquema publicado na documentação da v2, sem
 * arquivo real (a v2 só liga em outubro/2026). Reconferir campo a campo
 * contra o primeiro arquivo real antes de confiar: nomes, se `cbs` vem como
 * objeto ou lista, escala dos valores, e o vocabulário de `origem` e
 * `documento`.
 *
 * Achata o arquivo v2 (`apuracao[].debitos[]`) em linhas, carregando o período
 * de apuração para dentro de cada uma. Créditos têm estrutura IDÊNTICA — a
 * única diferença é o nome da lista — por isso a função recebe qual ler.
 *
 * Nada aqui decide valor fiscal: só transporta o que veio, convertendo escala.
 */
export type LinhaV2 = {
  pa: string;
  chave: string;
  origem: number;
  documento: number;
  emissao: string | null;
  registro: string | null;
  atualizacao: string | null;
  apurado_cents: number;
  excedente_cents: number;
  inexigivel_cents: number;
  suspenso_cents: number;
  extinto_cents: number;
  saldo_devedor_cents: number;
};

function lista(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function texto(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  // A chave pode chegar como número: converter sem notação científica.
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v)).toString();
  return null;
}
function inteiro(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  return Number.isFinite(n) ? Math.trunc(n) : -1;
}

export function lerListaV2(arquivo: unknown, chaveLista: "debitos" | "creditos"): LinhaV2[] {
  const out: LinhaV2[] = [];
  for (const grupoBruto of lista(obj(arquivo)["apuracao"])) {
    const grupo = obj(grupoBruto);
    const pa = texto(grupo["pa"]);
    if (!pa) continue;
    for (const itemBruto of lista(grupo[chaveLista])) {
      const item = obj(itemBruto);
      const chave = texto(item["chave"]);
      if (!chave) continue;
      const cbs = obj(item["cbs"]);
      out.push({
        pa,
        chave,
        origem: inteiro(item["origem"]),
        documento: inteiro(item["documento"]),
        emissao: texto(item["emissao"]),
        registro: texto(item["registro"]),
        atualizacao: texto(item["atualizacao"]),
        apurado_cents: reaisParaCentavos(cbs["apurado"]),
        excedente_cents: reaisParaCentavos(cbs["excedente"]),
        inexigivel_cents: reaisParaCentavos(cbs["inexigivel"]),
        suspenso_cents: reaisParaCentavos(cbs["suspenso"]),
        extinto_cents: reaisParaCentavos(cbs["extinto"]),
        saldo_devedor_cents: reaisParaCentavos(cbs["saldoDevedor"]),
      });
    }
  }
  return out;
}

export const lerDebitosV2 = (arquivo: unknown) => lerListaV2(arquivo, "debitos");
export const lerCreditosV2 = (arquivo: unknown) => lerListaV2(arquivo, "creditos");
