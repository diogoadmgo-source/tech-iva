import { describe, expect, it } from "vitest";
import { refValido } from "./refvalido";

describe("formato da referência do webhook", () => {
  it("aceita 48 caracteres hexadecimais minúsculos", () => {
    expect(refValido("a".repeat(48))).toBe(true);
    expect(refValido("0123456789abcdef".repeat(3))).toBe(true);
  });

  it("recusa tamanho errado, maiúscula e caractere fora do hex", () => {
    expect(refValido("a".repeat(47))).toBe(false);
    expect(refValido("a".repeat(49))).toBe(false);
    expect(refValido("A".repeat(48))).toBe(false);
    expect(refValido("g".repeat(48))).toBe(false);
    expect(refValido("")).toBe(false);
  });
});
