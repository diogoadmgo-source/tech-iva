/**
 * Valor de uma fatura do provedor de pagamento (Paddle), em centavos.
 *
 * O provedor manda o total como texto com o valor inteiro em centavos
 * (ex.: "12345" = R$ 123,45). Antes, `Number(total ?? "0") || 0` fazia fatura
 * sem total — ou com total ilegível — aparecer como R$ 0,00, igual a uma fatura
 * gratuita. AUSENTE NÃO É ZERO: se o valor não veio ou não se entende, devolve
 * `null` e a tela mostra "—".
 *
 * Função pura, fora de `billing-history.server.ts`, para poder ser testada.
 */
export function centavosDoPaddle(total: string | null | undefined): number | null {
  if (total === null || total === undefined) return null;
  const texto = total.trim();
  if (!/^-?\d+$/.test(texto)) return null;
  return Number(texto);
}
