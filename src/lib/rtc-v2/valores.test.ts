import { describe, expect, it } from "vitest";
import { reaisParaCentavos } from "./valores";

describe("reais para centavos", () => {
  it("converte sem erro de ponto flutuante", () => {
    // 18.29 * 100 dá 1828.9999999999998 em ponto flutuante.
    expect(reaisParaCentavos(18.29)).toBe(1829);
    expect(reaisParaCentavos(1.005)).toBe(100); // trunca o terceiro decimal
    expect(reaisParaCentavos(0.1 + 0.2)).toBe(30);
  });

  it("aceita texto, que é como o JSON pode trazer", () => {
    expect(reaisParaCentavos("18.29")).toBe(1829);
    // Acima de 2^53 o próprio JS já arredonda, e é esse valor arredondado
    // (não zero) que a função deve devolver. Ver comentário em valores.ts.
    // eslint-disable-next-line no-loss-of-precision -- perda proposital
    expect(reaisParaCentavos("1234567890123456.78")).toBe(123456789012345678);
  });

  it("trata ausência como zero, nunca como NaN", () => {
    expect(reaisParaCentavos(undefined)).toBe(0);
    expect(reaisParaCentavos(null)).toBe(0);
    expect(reaisParaCentavos("")).toBe(0);
    expect(reaisParaCentavos("abc")).toBe(0);
  });

  it("preserva o sinal", () => {
    expect(reaisParaCentavos(-18.29)).toBe(-1829);
  });
});
