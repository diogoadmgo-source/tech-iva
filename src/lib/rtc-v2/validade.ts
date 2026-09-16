/**
 * Até quando a URL pré-assinada da v2 ainda pode ser usada.
 *
 * A Receita documenta 48 h de validade, mas `urlAssinadaExpiraEm` é campo
 * OPCIONAL do retorno: `lerRetorno` já o devolve como `string | null`, o
 * webhook grava `nullif(...)` (NULL quando vem vazio) e a consulta de situação
 * grava o que veio, inclusive nada. Deixar a ausência do campo derrubar o
 * download significaria jogar fora um segredo de 48 h e ainda reportar um
 * motivo falso — "URL assinada expirada" — para uma URL que ninguém deu como
 * expirada.
 *
 * Regra, nesta ordem:
 *   1. expiração declarada e legível → é ela que vale;
 *   2. ausente, vazia ou fora de formato → vale o piso `solicitado_em + 48 h`;
 *   3. sem nem isso (linha sem `solicitado_em` legível) → a URL é tratada como
 *      utilizável. Quem diz que uma URL assinada morreu é a Receita, na
 *      resposta do download — não a falta de um campo opcional aqui.
 *
 * A URL em si é segredo temporário: este módulo só a lê para saber se está
 * preenchida, e nunca a devolve nem a registra.
 */

/** Validade documentada da URL pré-assinada da v2. */
export const VALIDADE_URL_ASSINADA_MS = 48 * 60 * 60 * 1000;

/** Instante em milissegundos, ou `null` quando o texto não é data legível. */
function instante(valor: string | null | undefined): number | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  if (!limpo) return null;
  const ms = Date.parse(limpo);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Instante em que a URL deixa de valer, já aplicando o piso de 48 h. `null`
 * quando não há base nenhuma para calcular — e aí não há expiração a afirmar.
 */
export function expiracaoUrlAssinada(
  expiraEm: string | null | undefined,
  solicitadoEm: string | null | undefined,
): number | null {
  const declarada = instante(expiraEm);
  if (declarada !== null) return declarada;
  const abertura = instante(solicitadoEm);
  if (abertura !== null) return abertura + VALIDADE_URL_ASSINADA_MS;
  return null;
}

export type EntradaUrlAssinada = {
  url: string | null | undefined;
  expiraEm: string | null | undefined;
  solicitadoEm: string | null | undefined;
  /** Agora explícito: quem chama passa `Date.now()`; o teste passa o que quiser. */
  agora: number;
};

/** Há URL assinada e ela ainda pode ser usada? */
export function urlAssinadaUtilizavel(entrada: EntradaUrlAssinada): boolean {
  const url = typeof entrada.url === "string" ? entrada.url.trim() : "";
  if (!url) return false;
  const expira = expiracaoUrlAssinada(entrada.expiraEm, entrada.solicitadoEm);
  if (expira === null) return true;
  return expira > entrada.agora;
}

/**
 * Validade do token de acesso da Receita. O manual (Passo 1) diz 1 hora;
 * descontamos 5 minutos de folga.
 *
 * A folga não é preciosismo: o download é de UM ÚNICO acesso por tíquete, e a
 * escolha do token acontece antes da única tentativa. Perto do limite, trocar
 * por um token novo é de graça; descobrir tarde demais custa o tíquete e a
 * consulta do dia junto.
 */
export const VALIDADE_TOKEN_MS = 55 * 60 * 1000;

export type EntradaTokenGuardado = {
  /** Referência do token cifrado; ausente significa que não há token guardado. */
  ref: string | null | undefined;
  /** Abertura da solicitação: o token foi obtido segundos antes dela. */
  solicitadoEm: string | null | undefined;
  /** Agora explícito: quem chama passa `Date.now()`; o teste passa o que quiser. */
  agora: number;
};

/**
 * Dá para confiar no token guardado, sem gastar o tíquete para descobrir?
 *
 * Só `true` quando há referência E dá para PROVAR que ele é novo o bastante.
 * Sem `solicitado_em` legível não há como provar, e a resposta é `false` — ao
 * contrário de `urlAssinadaUtilizavel`, onde a dúvida joga a favor de tentar.
 * A assimetria é proposital: lá, desistir joga fora um segredo de 48 h que
 * ninguém deu como morto; aqui, insistir gasta o único acesso ao tíquete.
 */
export function tokenGuardadoUtilizavel(entrada: EntradaTokenGuardado): boolean {
  const ref = typeof entrada.ref === "string" ? entrada.ref.trim() : "";
  if (!ref) return false;
  const abertura = instante(entrada.solicitadoEm);
  if (abertura === null) return false;
  return entrada.agora - abertura < VALIDADE_TOKEN_MS;
}
