/**
 * Prévia da importação no navegador, com as MESMAS regras do banco
 * (tax_import_add_items + tax_import_finalize). Serve só para mostrar ao
 * usuário o que vai acontecer antes de enviar; o banco revalida tudo e o
 * resumo oficial é o que tax_import_finalize devolve.
 */
import { parseCnpj } from "./cnpj";
import type { RawRow } from "./read-file";
import { parseRelationship, type RelationshipKind } from "./relationship";

export type RowVerdict =
  "valido" | "duplicado_no_arquivo" | "cnpj_invalido" | "cnpj_ausente" | "relacionamento_invalido";

export type PreviewRow = RawRow & {
  verdict: RowVerdict;
  cnpjNormalized: string | null;
  padded: boolean;
  relationships: RelationshipKind[];
};

export type Preview = {
  total: number;
  valid: number;
  duplicateInFile: number;
  invalidCnpj: number;
  missingCnpj: number;
  invalidRelationship: number;
  padded: number;
  uniqueCnpjs: number;
  uniqueRoots: number;
  matrizes: number;
  filiais: number;
  alfanumericos: number;
  rows: PreviewRow[];
};

export function buildPreview(
  rows: RawRow[],
  defaultRelationship: RelationshipKind | null,
): Preview {
  const seen = new Set<string>();
  const out: PreviewRow[] = [];
  const cnpjs = new Set<string>();
  let valid = 0;
  let dup = 0;
  let invalidCnpj = 0;
  let missing = 0;
  let invalidRel = 0;
  let padded = 0;

  for (const row of rows) {
    const parsed = parseCnpj(row.cnpj);
    const rels = parseRelationship(row.rel) ?? (defaultRelationship ? [defaultRelationship] : null);
    let verdict: RowVerdict;
    if (!parsed.ok) {
      verdict = parsed.reason === "ausente" ? "cnpj_ausente" : "cnpj_invalido";
    } else if (!rels || rels.length === 0) {
      verdict = "relacionamento_invalido";
    } else {
      const fresh = rels.filter((rel) => !seen.has(`${parsed.cnpj}|${rel}`));
      rels.forEach((rel) => seen.add(`${parsed.cnpj}|${rel}`));
      verdict = fresh.length === 0 ? "duplicado_no_arquivo" : "valido";
    }
    if (parsed.ok && parsed.padded) padded += 1;
    if (parsed.ok && verdict !== "relacionamento_invalido") cnpjs.add(parsed.cnpj);
    if (verdict === "valido") valid += 1;
    else if (verdict === "duplicado_no_arquivo") dup += 1;
    else if (verdict === "cnpj_invalido") invalidCnpj += 1;
    else if (verdict === "cnpj_ausente") missing += 1;
    else invalidRel += 1;
    out.push({
      ...row,
      verdict,
      cnpjNormalized: parsed.ok ? parsed.cnpj : null,
      padded: parsed.ok ? parsed.padded : false,
      relationships: rels ?? [],
    });
  }

  const list = [...cnpjs];
  return {
    total: rows.length,
    valid,
    duplicateInFile: dup,
    invalidCnpj,
    missingCnpj: missing,
    invalidRelationship: invalidRel,
    padded,
    uniqueCnpjs: list.length,
    uniqueRoots: new Set(list.map((c) => c.slice(0, 8))).size,
    matrizes: list.filter((c) => c.slice(8, 12) === "0001").length,
    filiais: list.filter((c) => c.slice(8, 12) !== "0001").length,
    alfanumericos: list.filter((c) => /[A-Z]/.test(c)).length,
    rows: out,
  };
}
