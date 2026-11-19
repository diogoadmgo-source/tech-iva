/**
 * Lê a resposta da consulta de situação da v2 (documentação 1.2, 14/10/2026).
 *
 * O campo é `situacao` — PENDENTE, EM_PROCESSAMENTO, CONCLUIDA, ERRO ou
 * EXPIRADA. Uma versão anterior deste código lia `estado`, que a Receita não
 * manda: nenhuma solicitação v2 seria dada como concluída. `estado` continua
 * aceito só como reserva, para não quebrar se um ambiente antigo responder
 * com ele.
 *
 * Em ERRO e EXPIRADA vêm `codigoErro` e `mensagemErro`.
 */
export type Situacao = "PENDENTE" | "EM_PROCESSAMENTO" | "CONCLUIDA" | "ERRO" | "EXPIRADA" | "DESCONHECIDA";

export type LeituraSituacao = {
  situacao: Situacao;
  codigo: string | null;
  mensagem: string | null;
};

const CONHECIDAS = new Set<Situacao>(["PENDENTE", "EM_PROCESSAMENTO", "CONCLUIDA", "ERRO", "EXPIRADA"]);

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function lerSituacao(corpo: unknown): LeituraSituacao {
  const o =
    corpo && typeof corpo === "object" && !Array.isArray(corpo) ? (corpo as Record<string, unknown>) : {};
  const bruto = (texto(o["situacao"]) ?? texto(o["estado"]) ?? "").toUpperCase();
  const situacao = CONHECIDAS.has(bruto as Situacao) ? (bruto as Situacao) : "DESCONHECIDA";
  return { situacao, codigo: texto(o["codigoErro"]), mensagem: texto(o["mensagemErro"]) };
}

/** Situações que não vão mudar mais: a linha precisa sair de "solicitada". */
export function situacaoFinal(s: Situacao): boolean {
  return s === "CONCLUIDA" || s === "ERRO" || s === "EXPIRADA";
}
