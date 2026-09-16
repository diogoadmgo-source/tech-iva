/**
 * Qual versão da API da Receita abre uma competência.
 *
 * Existe porque a troca da v1 para a v2 NÃO é "a nova substitui a velha". São
 * duas regras diferentes convivendo:
 *
 *  - A v2 só atende o mês corrente. A janela dela é incremental (8 dias), e a
 *    primeira consulta do mês volta ao dia 1º. Competência fechada não tem
 *    endereço na v2 — pedir lá devolve erro e queima uma das chamadas do dia.
 *  - Enquanto a v2 não entra no ar (outubro/2026), tudo vai pela v1.
 *
 * Função pura e testada de propósito: errar a versão manda o pedido para o
 * endereço errado, e cada erro desses custa uma das 2 (v1) ou 4 (v2) consultas
 * diárias. A mesma razão de `enderecos.ts` e `valores.ts` serem puros.
 */
export type VersaoApi = 1 | 2;

/** "AAAA-MM-DD" ou "AAAA-MM" → "AAAA-MM". Qualquer outra coisa → null. */
function mes(competencia: string): string | null {
  const m = /^(\d{4}-\d{2})(?:-\d{2})?$/.exec(competencia.trim());
  return m ? (m[1] as string) : null;
}

/**
 * @param competencia   competência pedida ("AAAA-MM-01" ou "AAAA-MM")
 * @param mesCorrente   mês de hoje no fuso de São Paulo, no mesmo formato
 * @param v2Ligada      se a v2 já está no ar neste ambiente
 *
 * Competência ilegível cai na v1: é o caminho que existe hoje e que sabe
 * recusar com mensagem nossa, em vez de montar um endereço torto.
 */
export function versaoDaAbertura(
  competencia: string,
  mesCorrente: string,
  v2Ligada: boolean,
): VersaoApi {
  if (!v2Ligada) return 1;
  const pedida = mes(competencia);
  const corrente = mes(mesCorrente);
  if (!pedida || !corrente) return 1;
  return pedida === corrente ? 2 : 1;
}
