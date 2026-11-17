/**
 * Tipo de relacionamento por texto livre — espelho de
 * public.tax_parse_relationship (migration 0241).
 *
 * null  → célula vazia (vale o padrão escolhido na importação)
 * []    → texto não reconhecido
 */
export type RelationshipKind = "cliente" | "fornecedor";

const ACCENTS: Record<string, string> = {
  á: "a",
  à: "a",
  â: "a",
  ã: "a",
  ä: "a",
  é: "e",
  è: "e",
  ê: "e",
  ë: "e",
  í: "i",
  ì: "i",
  î: "i",
  ï: "i",
  ó: "o",
  ò: "o",
  ô: "o",
  õ: "o",
  ö: "o",
  ú: "u",
  ù: "u",
  û: "u",
  ü: "u",
  ç: "c",
};

const CLIENTE = new Set(["cliente", "clientes", "c"]);
const FORNECEDOR = new Set(["fornecedor", "fornecedores", "f"]);
const AMBOS = new Set([
  "ambos",
  "cliente e fornecedor",
  "fornecedor e cliente",
  "cliente/fornecedor",
  "fornecedor/cliente",
  "cliente;fornecedor",
  "cliente,fornecedor",
  "c/f",
  "f/c",
  "cf",
]);

export function parseRelationship(raw: string | null | undefined): RelationshipKind[] | null {
  const v = (raw ?? "")
    .toLowerCase()
    .replace(/[áàâãäéèêëíìîïóòôõöúùûüç]/g, (ch) => ACCENTS[ch] ?? ch)
    .trim()
    .replace(/\s+/g, " ");
  if (!v) return null;
  if (CLIENTE.has(v)) return ["cliente"];
  if (FORNECEDOR.has(v)) return ["fornecedor"];
  if (AMBOS.has(v)) return ["cliente", "fornecedor"];
  return [];
}
