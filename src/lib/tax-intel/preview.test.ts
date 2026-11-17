import { describe, expect, it } from "vitest";

import { cnpjCheckDigits } from "./cnpj";
import { buildPreview } from "./preview";
import type { RawRow } from "./read-file";

const cnpj = (body12: string) => body12 + cnpjCheckDigits(body12);
let n = 0;
const row = (c: string | null, rel: string | null = null): RawRow => {
  n += 1;
  return { r: n, line: n + 1, cnpj: c, razao: null, fantasia: null, rel };
};

describe("prévia da importação (mesmas regras do banco)", () => {
  it("reproduz a base de 12 linhas da suíte SQL", () => {
    n = 0;
    const rows = [
      row("11.222.333/0001-81", "Cliente"),
      row(cnpj("112223330002"), "fornecedor"),
      row("12.ABC.345/01DE-35", "Ambos"),
      row("11222333000182", "cliente"),
      row(null, "cliente"),
      row(cnpj("998887770001"), "parceiro"),
      row("11222333000181", "cliente"),
      row("11222333000181", "Fornecedor"),
      row(cnpj("012345670001").replace(/^0/, ""), "cliente"),
      row("12.abc.345/01de-35", null),
      row("2ABC34501DE35", "cliente"),
      row(cnpj("554443330001"), "FORNECEDOR"),
    ];
    const pv = buildPreview(rows, "cliente");
    // Mesmos números que 20_import.sql confere no banco.
    expect(pv).toMatchObject({
      total: 12,
      valid: 6,
      duplicateInFile: 2,
      invalidCnpj: 2,
      missingCnpj: 1,
      invalidRelationship: 1,
      padded: 1,
      uniqueCnpjs: 5,
      uniqueRoots: 4,
      alfanumericos: 1,
    });
    expect(pv.rows[9]!.verdict).toBe("duplicado_no_arquivo"); // alfanumérico em minúsculas = linha 3
  });

  it("sem padrão definido, relacionamento vazio é inválido", () => {
    n = 0;
    const pv = buildPreview([row("11222333000181", null)], null);
    expect(pv.rows[0]!.verdict).toBe("relacionamento_invalido");
  });
});
