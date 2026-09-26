/**
 * Quanto esperar entre o retorno da Receita e o download (API v1).
 *
 * EXPERIMENTO de 23/09/2026 — não é regra da documentação. O manual da v1 não
 * diz quanto esperar. O que se sabe: o retorno chega em menos de 1 s e traz o
 * MESMO tíquete da resposta do pedido — é aviso de recebimento, não de arquivo
 * pronto. Em 23/09 cada tíquete foi tocado uma única vez e ainda assim voltou
 * 401 "Tíquete inexistente ou download já realizado". A v2 criou um endereço de
 * situação e um tempo estimado de atendimento, o que só faz sentido se for
 * preciso esperar.
 *
 * Como o tíquete tem UM acesso, baixar cedo demais o perde. Esperar custa
 * minutos; errar custa a consulta do dia. O valor mora aqui e só aqui, para ser
 * ajustado com a evidência do histórico (`rtc_apuracao.historico`).
 */
export const ESPERA_MINIMA_DOWNLOAD_MS = 10 * 60 * 1000;

export type EntradaEspera = {
  /** Quando o retorno da Receita chegou (`webhook_recebido_em`). */
  recebidoEm: string | null | undefined;
  /** Quando o pedido foi feito (`solicitado_em`) — usado se não houve retorno. */
  solicitadoEm: string | null | undefined;
  /** Agora explícito: quem chama passa `Date.now()`; o teste passa o que quiser. */
  agora: number;
};

function instante(valor: string | null | undefined): number | null {
  if (typeof valor !== "string" || !valor.trim()) return null;
  const ms = Date.parse(valor.trim());
  return Number.isFinite(ms) ? ms : null;
}

/** Instante a partir do qual o download pode ser tentado; `null` se não há data. */
export function liberacaoDoDownload(e: EntradaEspera): number | null {
  const base = instante(e.recebidoEm) ?? instante(e.solicitadoEm);
  return base === null ? null : base + ESPERA_MINIMA_DOWNLOAD_MS;
}

/**
 * Ainda é cedo demais para tocar no tíquete?
 *
 * Sem nenhuma data legível responde `false`: na prática é inalcançável (o banco
 * grava as duas sozinho), e bloquear prenderia a linha para sempre.
 */
export function cedoDemaisParaBaixar(e: EntradaEspera): boolean {
  const libera = liberacaoDoDownload(e);
  return libera !== null && e.agora < libera;
}

/**
 * Aviso depois de "Consultar Receita" (v1).
 *
 * Antes mandava clicar em "Reprocessar retorno" em 10 minutos. Isso só fazia
 * sentido se o comprovante da resposta ao pedido servisse para baixar — e não
 * serve (26/09): ele é o do pedido. O de download chega pelo endereço de
 * retorno quando a Receita termina o arquivo, e ainda não sabemos quanto isso
 * demora. O aviso não promete prazo e protege a segunda consulta do dia.
 */
export function avisoAposSolicitar(): string {
  return "Solicitação enviada. Agora a Receita avisa quando o arquivo estiver pronto — ainda não sabemos quanto isso demora. Não faça outra consulta hoje: esta continua aberta por até 24 horas.";
}
