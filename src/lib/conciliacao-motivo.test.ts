import { describe, expect, it } from "vitest";
import { motivoDivergencia } from "./conciliacao-motivo";

const base = { tem_correspondente: true, nosso_cents: 1000, diferenca_cents: 0, situacao: "nao_extinto" };

describe("motivo da divergência", () => {
  it("nota que a Receita tem e nós não", () => {
    expect(
      motivoDivergencia({ ...base, tem_correspondente: false, nosso_cents: null, diferenca_cents: null }),
    ).toBe("Nota na Receita sem correspondente aqui");
  });

  it("nota imune, calculada com zero, NÃO é 'sem correspondente'", () => {
    // O defeito: nosso_cents === 0 era lido como ausência.
    expect(motivoDivergencia({ ...base, nosso_cents: 0, diferenca_cents: 0 })).toBe("Valores iguais");
  });

  it("nota nossa ainda sem cálculo", () => {
    expect(motivoDivergencia({ ...base, nosso_cents: null, diferenca_cents: null })).toBe(
      "Nossa nota ainda não foi calculada",
    );
  });

  it("diferença desconhecida NÃO é 'Valores iguais'", () => {
    expect(motivoDivergencia({ ...base, diferenca_cents: null })).toBe("Diferença não calculada");
  });

  it("cancelado na Receita", () => {
    expect(motivoDivergencia({ ...base, situacao: "cancelado", diferenca_cents: 500 })).toBe(
      "Documento cancelado na Receita",
    );
  });

  it("sentido da diferença", () => {
    expect(motivoDivergencia({ ...base, diferenca_cents: 1 })).toBe("Receita apurou mais do que calculamos");
    expect(motivoDivergencia({ ...base, diferenca_cents: -1 })).toBe("Calculamos mais do que a Receita apurou");
  });
});
