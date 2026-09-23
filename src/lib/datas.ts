/**
 * Que dia é hoje — no fuso de São Paulo, não no do servidor.
 *
 * O servidor roda em UTC. São Paulo é UTC-3, então das 21h à meia-noite
 * `new Date().toISOString()` já devolve o dia SEGUINTE. Três horas por dia,
 * todo dia.
 *
 * Isso não é detalhe de exibição: a data do fato gerador decide quais regras a
 * calculadora oficial aplica, e as alíquotas da transição mudam de um ano para
 * o outro. Uma simulação feita às 21h30 de 31/12 sairia com as regras do ano
 * que vem. A competência da apuração tem o mesmo problema — na virada do mês,
 * três horas de UTC gravam o mês errado.
 *
 * Funções puras, com `agora` explícito, para o teste poder escolher o instante.
 */

const FUSO = "America/Sao_Paulo";

function partes(agora: Date): { ano: string; mes: string; dia: string } {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(agora);
  const achar = (tipo: string, padrao: string) =>
    p.find((x) => x.type === tipo)?.value ?? padrao;
  return {
    ano: achar("year", "0000"),
    mes: achar("month", "01"),
    dia: achar("day", "01"),
  };
}

/** Data de hoje em São Paulo, como "AAAA-MM-DD". */
export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  const { ano, mes, dia } = partes(agora);
  return `${ano}-${mes}-${dia}`;
}

/** Primeiro dia do mês corrente em São Paulo, como "AAAA-MM-01". */
export function mesCorrenteEmSaoPaulo(agora: Date = new Date()): string {
  const { ano, mes } = partes(agora);
  return `${ano}-${mes}-01`;
}
