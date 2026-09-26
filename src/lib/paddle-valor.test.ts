import { describe, expect, it } from "vitest";
import { centavosDoPaddle } from "./paddle-valor";

describe("valor da fatura vindo do provedor de pagamento", () => {
  it("lê o valor em centavos que o provedor manda como texto", () => {
    expect(centavosDoPaddle("12345")).toBe(12345);
  });

  it("zero informado pelo provedor é zero de verdade", () => {
    expect(centavosDoPaddle("0")).toBe(0);
  });

  it("valor ausente fica desconhecido, não vira zero", () => {
    expect(centavosDoPaddle(undefined)).toBeNull();
    expect(centavosDoPaddle(null)).toBeNull();
  });

  it("texto vazio ou ilegível fica desconhecido, não vira zero", () => {
    expect(centavosDoPaddle("")).toBeNull();
    expect(centavosDoPaddle("   ")).toBeNull();
    expect(centavosDoPaddle("abc")).toBeNull();
    expect(centavosDoPaddle("12.5")).toBeNull();
  });
});
