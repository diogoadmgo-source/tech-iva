import { describe, expect, it } from "vitest";

import { cnpjCheckDigits, cnpjParts, formatCnpj, isValidCnpj, parseCnpj, stripCnpj } from "./cnpj";

describe("CNPJ numérico e alfanumérico", () => {
  it("valida o exemplo oficial da Receita (12.ABC.345/01DE-35)", () => {
    expect(cnpjCheckDigits("12ABC34501DE")).toBe("35");
    expect(isValidCnpj("12ABC34501DE35")).toBe(true);
    expect(parseCnpj("12.abc.345/01de-35")).toEqual({
      ok: true,
      cnpj: "12ABC34501DE35",
      padded: false,
    });
  });

  it("valida CNPJ numérico e recusa DV errado", () => {
    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(isValidCnpj("11222333000182")).toBe(false);
    expect(parseCnpj("11.222.333/0001-82")).toMatchObject({ ok: false, reason: "dv" });
  });

  it("recusa sequência repetida e DV com letra", () => {
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCnpj("12ABC34501DEA5")).toBe(false);
  });

  it("completa zeros à esquerda só para 12 ou 13 dígitos numéricos", () => {
    // 01.234.567/0001-?? perdeu o zero no Excel (13 dígitos)
    const full = `01234567` + `0001` + cnpjCheckDigits("012345670001");
    const lost = full.replace(/^0/, "");
    expect(lost).toHaveLength(13);
    expect(parseCnpj(lost)).toEqual({ ok: true, cnpj: full, padded: true });
    expect(parseCnpj(Number(lost))).toEqual({ ok: true, cnpj: full, padded: true });
    // valor curto demais não é completado
    expect(parseCnpj("191")).toMatchObject({ ok: false, reason: "formato" });
    // alfanumérico com 13 posições nunca é completado
    expect(parseCnpj("2ABC34501DE35")).toMatchObject({ ok: false, reason: "formato" });
  });

  it("vazio é ausente, não inválido", () => {
    expect(parseCnpj("  ")).toMatchObject({ ok: false, reason: "ausente" });
    expect(parseCnpj(null)).toMatchObject({ ok: false, reason: "ausente" });
    expect(stripCnpj(" 11.222.333/0001-81 ")).toBe("11222333000181");
  });

  it("separa raiz, ordem, DV, matriz e filial", () => {
    expect(cnpjParts("12ABC34501DE35")).toEqual({
      cnpj: "12ABC34501DE35",
      raiz: "12ABC345",
      ordem: "01DE",
      dv: "35",
      isMatriz: false,
      alfanumerico: true,
    });
    expect(cnpjParts("11222333000181").isMatriz).toBe(true);
    expect(formatCnpj("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
  });
});
