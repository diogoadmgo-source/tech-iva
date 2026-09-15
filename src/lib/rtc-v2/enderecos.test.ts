import { describe, expect, it } from "vitest";
import { urlRecurso, urlSituacao } from "./enderecos";

const BASE = "https://api.receitafederal.gov.br";

describe("endereços da v2", () => {
  it("monta produção e produção restrita com o caminho certo", () => {
    expect(urlRecurso(BASE, "producao", "debitos", "23813386")).toBe(
      "https://api.receitafederal.gov.br/apuracao-cbs/v2/debitos/23813386",
    );
    expect(urlRecurso(BASE, "restrita", "debitos", "23813386")).toBe(
      "https://api.receitafederal.gov.br/apuracao-cbs-prr/v2/debitos/23813386",
    );
  });

  it("atende os quatro recursos", () => {
    for (const r of ["debitos", "creditos", "pagamentos", "recolhimentos"] as const) {
      expect(urlRecurso(BASE, "producao", r, "23813386")).toContain(`/v2/${r}/`);
    }
  });

  it("monta a consulta de situação", () => {
    expect(urlSituacao(BASE, "producao", "T-1")).toBe(
      "https://api.receitafederal.gov.br/apuracao-cbs/v2/situacao/T-1",
    );
  });

  it("normaliza o CNPJ para os 8 primeiros dígitos", () => {
    expect(urlRecurso(BASE, "producao", "debitos", "23.813.386/0001-56")).toContain("/23813386");
  });

  it("escapa o tíquete na URL", () => {
    expect(urlSituacao(BASE, "producao", "a/b c")).toContain("a%2Fb%20c");
  });

  it("tira a barra sobrando da base", () => {
    expect(urlRecurso(`${BASE}/`, "producao", "debitos", "23813386")).toBe(
      "https://api.receitafederal.gov.br/apuracao-cbs/v2/debitos/23813386",
    );
  });
});
