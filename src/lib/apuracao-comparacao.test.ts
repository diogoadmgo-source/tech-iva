import { describe, expect, it } from "vitest";
import { compararApuracao } from "./apuracao-comparacao";

const base = {
  receita_debito_cents: 100_000,
  nosso_debito_cents: 100_000,
  diferenca_cents: 0,
  divergente: false,
};

describe("comparação Receita × nosso cálculo", () => {
  it("sem o débito da Receita não há comparação, mesmo que venha uma diferença", () => {
    // Banco antes da migração 0233: coalesce(debitos, 0) - nosso chegava como
    // diferença "calculada" e divergente = true. Não pode virar número na tela.
    const r = compararApuracao({
      ...base,
      receita_debito_cents: null,
      diferenca_cents: -100_000,
      divergente: true,
    });
    expect(r.estado).toBe("sem_comparacao");
  });

  it("sem o débito da Receita (banco já corrigido) também não há comparação", () => {
    const r = compararApuracao({
      ...base,
      receita_debito_cents: null,
      diferenca_cents: null,
      divergente: null,
    });
    expect(r).toEqual({
      estado: "sem_comparacao",
      motivo:
        "A Receita não informou o débito total desta competência. Sem ele não dá para comparar com o seu cálculo.",
    });
  });

  it("diferença ou veredito ausentes não viram 'bate'", () => {
    expect(compararApuracao({ ...base, diferenca_cents: null }).estado).toBe("sem_comparacao");
    expect(compararApuracao({ ...base, divergente: null }).estado).toBe("sem_comparacao");
    expect(compararApuracao({ ...base, nosso_debito_cents: null }).estado).toBe("sem_comparacao");
  });

  it("débito zero informado pela Receita é valor de verdade", () => {
    const r = compararApuracao({
      receita_debito_cents: 0,
      nosso_debito_cents: 0,
      diferenca_cents: 0,
      divergente: false,
    });
    expect(r).toEqual({ estado: "bate", diferencaCents: 0 });
  });

  it("dentro da tolerância do banco, bate", () => {
    const r = compararApuracao({ ...base, nosso_debito_cents: 99_950, diferenca_cents: 50 });
    expect(r).toEqual({ estado: "bate", diferencaCents: 50 });
  });

  it("fora da tolerância, diverge e guarda o sinal", () => {
    const r = compararApuracao({
      ...base,
      nosso_debito_cents: 120_000,
      diferenca_cents: -20_000,
      divergente: true,
    });
    expect(r).toEqual({ estado: "diverge", diferencaCents: -20_000 });
  });
});
