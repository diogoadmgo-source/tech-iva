/**
 * Na v1 o ambiente era um prefixo (`rtc` / `prr-rtc`) antes do recurso. Na v2
 * ele faz parte do próprio caminho: `apuracao-cbs` ou `apuracao-cbs-prr`.
 * Trocar um pelo outro manda o pedido para o ambiente errado e queima uma das
 * 4 chamadas do dia — por isso isto é função pura, com teste.
 */
export type Ambiente = "producao" | "restrita";
export type Recurso = "debitos" | "creditos" | "pagamentos" | "recolhimentos";

const SEGMENTO: Record<Ambiente, string> = {
  producao: "apuracao-cbs",
  restrita: "apuracao-cbs-prr",
};

function raiz(base: string, ambiente: Ambiente): string {
  return `${base.replace(/\/+$/, "")}/${SEGMENTO[ambiente]}/v2`;
}

export function urlRecurso(base: string, ambiente: Ambiente, recurso: Recurso, cnpj: string) {
  const cnpj8 = cnpj.replace(/\D/g, "").slice(0, 8).padStart(8, "0");
  return `${raiz(base, ambiente)}/${recurso}/${cnpj8}`;
}

export function urlSituacao(base: string, ambiente: Ambiente, tiquete: string) {
  return `${raiz(base, ambiente)}/situacao/${encodeURIComponent(tiquete)}`;
}

/**
 * Link do arquivo de retorno (v2, desde 13/10/2026). Concluída a solicitação,
 * a URL assinada NÃO vem mais no aviso nem na situação: é este GET, com o
 * Bearer, que a devolve. Não entra no limite de 4 aberturas por dia.
 */
export function urlDownload(base: string, ambiente: Ambiente, tiquete: string) {
  return `${raiz(base, ambiente)}/download/${encodeURIComponent(tiquete)}`;
}

export type TipoDarf = "pcont" | "rad";

/**
 * Geração de DARF (síncrona). A documentação diz `String (14)` no campo, mas
 * um dos exemplos usa 8 dígitos. Seguimos a tabela de campos (14 dígitos, o
 * CNPJ completo do estabelecimento) — conferir na primeira chamada real.
 */
export function urlDarf(base: string, ambiente: Ambiente, tipo: TipoDarf, cnpj: string) {
  const cnpj14 = cnpj.replace(/[^0-9A-Za-z]/g, "").toUpperCase().padStart(14, "0");
  return `${raiz(base, ambiente)}/${tipo}/${cnpj14}`;
}
