/**
 * CNPJ numérico e alfanumérico (IN RFB 2.119/2022, alterada pela 2.229/2024).
 *
 * Formato: 12 posições [0-9A-Z] (8 de raiz + 4 de ordem) e 2 dígitos
 * verificadores numéricos. Valor de cada caractere = código ASCII − 48
 * ("0".."9" → 0..9, "A".."Z" → 17..42). Módulo 11 com pesos 2..9 da direita
 * para a esquerda; resto 0 ou 1 → DV 0. Exemplo oficial: 12.ABC.345/01DE-35.
 *
 * Espelho exato de public.tax_cnpj_is_valid (migration 0240). Os dois são
 * comparados em 20 mil casos pela suíte SQL.
 */

const WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const BODY = /^[0-9A-Z]{12}$/;
const FULL = /^[0-9A-Z]{12}[0-9]{2}$/;

function value(ch: string): number {
  return ch.charCodeAt(0) - 48;
}

function dv(chars: string, weights: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < chars.length; i += 1) sum += value(chars[i]!) * weights[i]!;
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** Calcula os 2 DVs para 12 posições já normalizadas. */
export function cnpjCheckDigits(body12: string): string {
  if (!BODY.test(body12)) throw new Error("Base do CNPJ precisa de 12 posições [0-9A-Z]");
  const d1 = dv(body12, WEIGHTS.slice(1));
  const d2 = dv(body12 + String(d1), WEIGHTS);
  return `${d1}${d2}`;
}

/** Remove máscara e espaços e converte para maiúscula. Não completa zeros. */
export function stripCnpj(raw: string | null | undefined): string | null {
  const out = (raw ?? "").replace(/[\s./-]/g, "").toUpperCase();
  return out.length ? out : null;
}

export function isValidCnpj(normalized: string | null | undefined): boolean {
  if (!normalized || !FULL.test(normalized)) return false;
  if (/^(.)\1{13}$/.test(normalized)) return false;
  return cnpjCheckDigits(normalized.slice(0, 12)) === normalized.slice(12);
}

export type CnpjParse =
  | { ok: true; cnpj: string; padded: boolean }
  | { ok: false; reason: "ausente" | "formato" | "dv"; stripped: string | null };

/**
 * Normalização da importação, igual à do banco (tax_import_add_items):
 * zeros à esquerda perdidos pelo Excel só são completados quando o valor é
 * todo numérico com 12 ou 13 dígitos. Valor alfanumérico nunca é completado.
 */
export function parseCnpj(raw: string | number | null | undefined): CnpjParse {
  const stripped = stripCnpj(raw === null || raw === undefined ? null : String(raw));
  if (!stripped) return { ok: false, reason: "ausente", stripped: null };
  const padded = /^[0-9]{12,13}$/.test(stripped);
  const candidate = padded ? stripped.padStart(14, "0") : stripped;
  if (!FULL.test(candidate)) return { ok: false, reason: "formato", stripped };
  if (!isValidCnpj(candidate)) return { ok: false, reason: "dv", stripped };
  return { ok: true, cnpj: candidate, padded };
}

export type CnpjParts = {
  cnpj: string;
  raiz: string;
  ordem: string;
  dv: string;
  isMatriz: boolean;
  alfanumerico: boolean;
};

export function cnpjParts(cnpj: string): CnpjParts {
  return {
    cnpj,
    raiz: cnpj.slice(0, 8),
    ordem: cnpj.slice(8, 12),
    dv: cnpj.slice(12),
    isMatriz: cnpj.slice(8, 12) === "0001",
    alfanumerico: /[A-Z]/.test(cnpj),
  };
}

/** 12ABC34501DE35 → 12.ABC.345/01DE-35 */
export function formatCnpj(cnpj: string | null | undefined): string {
  if (!cnpj || cnpj.length !== 14) return cnpj ?? "";
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}
