/** Célula de CSV segura: troca ";" e neutraliza fórmulas de planilha (=, +, -, @, tab, CR). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const t = String(v).replace(/;/g, ",").replace(/[\r\n]+/g, " ");
  return /^[=+\-@\t\r]/.test(t) && !/^-?\d+([.,]\d+)?$/.test(t) ? `'${t}` : t;
}
