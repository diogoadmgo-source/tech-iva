/**
 * Leitura do corpo que chega no endereço de retorno da Receita.
 *
 * Duas regras, de duas revisões de 26/09/2026:
 *
 * 1. NADA SE PERDE. Ainda não sabemos o formato real do retorno da v1 — até
 *    26/09 a Receita nunca tinha chamado o nosso endereço; o "retorno" que
 *    víamos era o próprio código. Se ela mandar formulário, texto ou lista em
 *    vez de objeto JSON, o conteúdo tem que ser guardado para análise, não
 *    recusado sem rastro.
 * 2. COM LIMITE. O endereço é público. Sem teto, qualquer um encheria o banco
 *    — e com o disco cheio o Supabase trava o projeto em modo só-leitura.
 *    Um retorno legítimo cabe folgado em 64 KB.
 */
export const TAMANHO_MAXIMO_RETORNO = 64 * 1024;
const MAXIMO_BRUTO_GUARDADO = 4000;
const MAXIMO_CABECALHO = 200;

export type CorpoRetorno =
  | { tipo: "grande_demais" }
  | { tipo: "objeto"; payload: Record<string, unknown> }
  | {
      tipo: "nao_objeto";
      payload: { _bruto: string; _motivo: "nao_json" | "nao_objeto" };
    };

export function lerCorpoRetorno(bruto: string): CorpoRetorno {
  if (new TextEncoder().encode(bruto).length > TAMANHO_MAXIMO_RETORNO) {
    return { tipo: "grande_demais" };
  }
  let valor: unknown;
  try {
    valor = JSON.parse(bruto);
  } catch {
    return {
      tipo: "nao_objeto",
      payload: { _bruto: bruto.slice(0, MAXIMO_BRUTO_GUARDADO), _motivo: "nao_json" },
    };
  }
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    return {
      tipo: "nao_objeto",
      payload: { _bruto: bruto.slice(0, MAXIMO_BRUTO_GUARDADO), _motivo: "nao_objeto" },
    };
  }
  return { tipo: "objeto", payload: valor as Record<string, unknown> };
}

export type MetaRequisicao = {
  content_type: string | null;
  user_agent: string | null;
  origem_ip: string | null;
  tamanho: number;
};

function cabecalho(h: Headers, nome: string): string | null {
  const v = h.get(nome);
  if (v === null || !v.trim()) return null;
  return v.trim().slice(0, MAXIMO_CABECALHO);
}

/**
 * Quem chamou. Serve para provar que uma linha do registro veio da Receita e
 * não de outra origem. `origem_ip` é o primeiro endereço de `x-forwarded-for`
 * (o cliente original, antes dos intermediários).
 */
export function metaDaRequisicao(h: Headers, tamanho: number): MetaRequisicao {
  const encaminhado = cabecalho(h, "x-forwarded-for");
  const primeiro = encaminhado ? encaminhado.split(",")[0]?.trim() || null : null;
  return {
    content_type: cabecalho(h, "content-type"),
    user_agent: cabecalho(h, "user-agent"),
    origem_ip: primeiro,
    tamanho,
  };
}
