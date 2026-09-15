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
  });

  it("converte valor grande porem exato, dentro do alcance seguro", () => {
    // 90 trilhoes de reais em centavos ainda cabe em Number.MAX_SAFE_INTEGER;
    // nenhum documento fiscal real chega perto disso.
    expect(reaisParaCentavos("99999999.99")).toBe(9999999999);
    expect(reaisParaCentavos("12345678901.23")).toBe(1234567890123);
  });

  it("acima do alcance seguro, o valor perde precisao — documentado, nao silencioso", () => {
    // Nao e caso real: serve para fixar o comportamento por escrito, para
    // ninguem supor exatidao onde o JavaScript nao oferece.
    const fora = reaisParaCentavos("1234567890123456.78");
    expect(Number.isSafeInteger(fora)).toBe(false);
    expect(fora).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
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
