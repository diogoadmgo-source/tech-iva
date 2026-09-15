/**
 * A referência do webhook são 24 bytes aleatórios em hex, gerados por
 * `rtc_apuracao_solicitar`. Validar o formato antes de tocar o banco barra
 * varredura e permite responder ao HEAD sem consultar nada.
 */
export function refValido(ref: string): boolean {
  return /^[0-9a-f]{48}$/.test(ref);
}
