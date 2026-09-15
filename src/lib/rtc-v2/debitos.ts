import { reaisParaCentavos } from "./valores";

/**
 * PORTÃO: escrito contra o esquema publicado na documentação da v2, sem
 * arquivo real (a v2 só liga em outubro/2026). Reconferir campo a campo
 * contra o primeiro arquivo real antes de confiar: nomes, se `cbs` vem como
 * objeto ou lista, escala dos valores, e o vocabulário de `origem` e
 * `documento`.
 *
 * CAMPO DE MAIOR RISCO: `cbs`. Este leitor assume `cbs` como OBJETO plano
 * (`{ apurado, excedente, inexigivel, suspenso, extinto, saldoDevedor }`).
 * Se a Receita mandar `cbs` como LISTA, `obj()` devolve `{}` para um array e
 * TODOS os `*_cents` da linha saem zerados — sem lançar, sem avisar. Isso
 * não aparece como erro nem em teste nem em produção: aparece como zero
 * onde deveria haver valor. Ao conferir o primeiro arquivo real: se
 * qualquer linha tiver todos os `*_cents` em zero, suspeitar primeiro de
 * `cbs` ter mudado de forma, antes de supor que o débito/crédito é mesmo
 * zero.
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
/**
 * Converte para inteiro, com `-1` como sentinela de "não informado / ilegível
 * — nunca um código de negócio da Receita". `-1` nunca é um `origem` ou
 * `documento` válido, então é seguro para essa finalidade.
 *
 * Cuidado ao mexer aqui: `origem: 0` é um código NORMAL de verdade (conforme
 * a documentação — 20-22 devolução, 30-32 cancelamento, 50-55 perecimento).
 * `Number("")` e `Number(undefined)` tratados ingenuamente (`Number(String(v
 * ?? "").trim())`) dão `0`, não `NaN` — então ausência colidiria em silêncio
 * com o código "normal" legítimo. Por isso ausência (`null`/`undefined`/
 * string vazia) é tratada ANTES do fallback, de forma explícita.
 */
function inteiro(v: unknown): number {
  if (v === null || v === undefined) return -1;
  if (typeof v === "string" && !v.trim()) return -1;
  const n = typeof v === "number" ? v : Number(String(v).trim());
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
