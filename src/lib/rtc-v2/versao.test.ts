import { describe, expect, it } from "vitest";
import { versaoDaAbertura } from "./versao";

const CORRENTE = "2026-10-01";

describe("qual versão abre a competência", () => {
  it("com a v2 desligada, tudo vai pela v1", () => {
    expect(versaoDaAbertura("2026-10-01", CORRENTE, false)).toBe(1);
    expect(versaoDaAbertura("2026-09-01", CORRENTE, false)).toBe(1);
  });

  it("com a v2 ligada, o mês corrente vai pela v2", () => {
    expect(versaoDaAbertura("2026-10-01", CORRENTE, true)).toBe(2);
  });

  it("competência fechada continua na v1 mesmo com a v2 ligada", () => {
    // A v2 não tem endereço para período fechado: a janela dela é incremental
    // e começa no dia 1º do mês corrente. Mandar para lá queima uma chamada.
    expect(versaoDaAbertura("2026-09-01", CORRENTE, true)).toBe(1);
    expect(versaoDaAbertura("2025-12-01", CORRENTE, true)).toBe(1);
  });

  it("mês futuro também não é a v2", () => {
    expect(versaoDaAbertura("2026-11-01", CORRENTE, true)).toBe(1);
  });

  it("aceita competência sem o dia", () => {
    expect(versaoDaAbertura("2026-10", CORRENTE, true)).toBe(2);
    expect(versaoDaAbertura("2026-10-01", "2026-10", true)).toBe(2);
  });

  it("ignora espaço em volta", () => {
    expect(versaoDaAbertura(" 2026-10-01 ", CORRENTE, true)).toBe(2);
  });

  it("competência ilegível cai na v1, nunca na v2", () => {
    // Cair na v1 é o comportamento seguro: é o caminho que já existe e que
    // recusa com mensagem nossa, em vez de montar um endereço torto.
    for (const ruim of ["", "outubro", "2026", "26-10-01", "2026-13-01x", "null"]) {
      expect(versaoDaAbertura(ruim, CORRENTE, true)).toBe(1);
    }
    expect(versaoDaAbertura("2026-10-01", "", true)).toBe(1);
  });

  it("o dia dentro do mês não muda a decisão", () => {
    for (const dia of ["01", "09", "15", "28", "31"]) {
      expect(versaoDaAbertura(`2026-10-${dia}`, CORRENTE, true)).toBe(2);
    }
  });
});
