import { describe, expect, it } from "vitest";
// @ts-expect-error módulo .mjs do executor, sem tipos
import { opcao } from "./ibs-cbs.mjs";

describe("opção IBS/CBS pela CNPJá", () => {
  // Formato observado no teste de 19/11/2026.
  const s = {
    optant: true,
    events: [
      { regime: "IBS", from: "2027-01-01", text: "Opção pelo regime regular" },
      { regime: "CBS", from: "2027-01-01", text: "Opção pelo regime regular" },
    ],
  };
  it("evento de opção vira sim com data", () => {
    expect(opcao(s, "IBS")).toEqual({ valor: "sim", desde: "2027-01-01" });
  });
  it("sem evento vira não", () => {
    expect(opcao({ optant: true, events: [] }, "CBS")).toEqual({ valor: "nao", desde: null });
  });
  it("sem o campo events (pedido sem histórico) não vira não", () => {
    expect(opcao({ optant: true, since: "2020-01-01" }, "IBS")).toBeNull();
  });
  it("evento de outro tipo não é adivinhado", () => {
    expect(opcao({ events: [{ regime: "IBS", from: "2027-07-01", text: "Exclusão" }] }, "IBS")).toBeNull();
  });
});
