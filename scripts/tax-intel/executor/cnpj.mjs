// Validação de CNPJ (numérico e alfanumérico), igual a src/lib/tax-intel/cnpj.ts
// e a tax_cnpj_is_valid (0240). O teste executor.test.ts confere as três.
const W = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

export function cnpjValid(p) {
  if (typeof p !== "string" || !/^[0-9A-Z]{12}[0-9]{2}$/.test(p) || /^(.)\1{13}$/.test(p)) return false;
  const v = (i) => p.charCodeAt(i) - 48;
  let s = 0;
  for (let i = 0; i < 12; i++) s += v(i) * W[i + 1];
  let r = s % 11;
  const d1 = r < 2 ? 0 : 11 - r;
  s = d1 * W[12];
  for (let i = 0; i < 12; i++) s += v(i) * W[i];
  r = s % 11;
  const d2 = r < 2 ? 0 : 11 - r;
  return d1 === v(12) && d2 === v(13);
}

export const cnpjStrip = (p) => (p ?? "").toUpperCase().replace(/[\s./-]/g, "");
