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
