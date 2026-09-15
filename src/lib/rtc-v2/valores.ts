/**
 * PORTÃO: escrito contra o esquema publicado na documentação da v2, sem
 * arquivo real (a v2 só liga em outubro/2026). Reconferir campo a campo
 * contra o primeiro arquivo real antes de confiar.
 *
 * A v2 manda `number(18,2)` em reais; o banco guarda centavos em bigint.
 * A conversão é feita por TEXTO, nunca por `valor * 100`: em ponto flutuante
 * `18.29 * 100` é 1828.9999999999998, e um centavo perdido por documento vira
 * divergência com a Receita na soma da apuração.
 */
export function reaisParaCentavos(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const bruto = typeof v === "number" ? v.toFixed(2) : String(v).trim();
  if (!bruto) return 0;
  const m = /^(-?)(\d+)(?:[.,](\d*))?$/.exec(bruto);
  if (!m) return 0;
  const [, sinal, inteira, decimal = ""] = m;
  const centavos = `${decimal}00`.slice(0, 2);
  const total = Number(`${inteira}${centavos}`);
  // Nota: não barramos por Number.isSafeInteger aqui — valores de apuração
  // real jamais chegam perto de 2^53 centavos, e barrar nesse ponto faria a
  // função devolver 0 (silenciosamente incorreto) em vez do valor arredondado
  // que o próprio JS já produziria. Só descartamos o que não é finito.
  if (!Number.isFinite(total)) return 0;
  return sinal === "-" ? -total : total;
}
