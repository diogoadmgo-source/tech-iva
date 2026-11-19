import { describe, expect, it } from "vitest";
import { centavosParaReais, lerRespostaDarf, paReceita, pedidoPcont, pedidoRad } from "./darf";
import { urlDarf, urlDownload } from "./enderecos";

describe("pedido de DARF", () => {
  it("PCONT total não manda valor parcial", () => {
    expect(pedidoPcont({ pa: "2026-08", opcao: "PAGAMENTO_TOTAL", valorParcialCents: 999 })).toEqual({
      pa: "08/2026",
      opcaoPagamento: "PAGAMENTO_TOTAL",
    });
  });
  it("PCONT parcial converte centavos sem erro de ponto flutuante", () => {
    expect(pedidoPcont({ pa: "08/2026", opcao: "PAGAMENTO_PARCIAL", valorParcialCents: 150075 })).toEqual({
      pa: "08/2026",
      opcaoPagamento: "PAGAMENTO_PARCIAL",
      valorDarfParcial: 1500.75,
    });
    expect(centavosParaReais(1829)).toBe(18.29);
  });
  it("parcial sem valor é recusado antes de chamar a Receita", () => {
    expect(() => pedidoPcont({ pa: "08/2026", opcao: "PAGAMENTO_PARCIAL" })).toThrow(/valor maior que zero/);
    expect(() => paReceita("13/2026")).toThrow();
  });
  it("RAD monta uma entrada por nota e barra chave repetida", () => {
    const chave = "35260912345678000123550010000000011000000010";
    expect(
      pedidoRad([
        { chaveDFE: chave, opcao: "PAGAMENTO_PARCIAL", valorParcialCents: 50000 },
        { chaveDFE: chave.replace(/0$/, "1"), opcao: "PAGAMENTO_TOTAL" },
      ]),
    ).toEqual([
      { chaveDFE: chave, opcaoPagamento: "PAGAMENTO_PARCIAL", valorDarfParcial: 500 },
      { chaveDFE: chave.replace(/0$/, "1"), opcaoPagamento: "PAGAMENTO_TOTAL" },
    ]);
    expect(() => pedidoRad([{ chaveDFE: chave, opcao: "PAGAMENTO_TOTAL" }, { chaveDFE: chave, opcao: "PAGAMENTO_TOTAL" }])).toThrow(/repetida/);
    expect(() => pedidoRad([])).toThrow();
  });
});

describe("resposta de DARF", () => {
  it("lê o exemplo de sucesso do PCONT", () => {
    const [r] = lerRespostaDarf({
      cdRetorno: "DARF_GERADO",
      darf: { chavePIX: "pix", codigoBarras: "8587", linkDarfPDF: "https://x/d.pdf" },
      informacoesPagamento: {
        dataMaximaPagamento: "2026-08-13",
        valorDarfPrincipal: 1500.75,
        valorDarfMulta: 25.1,
        valorDarfJuros: 10.25,
        valorDarfTotal: 1536.1,
      },
    });
    expect(r).toMatchObject({
      gerado: true,
      totalCents: 153610,
      multaCents: 2510,
      dataMaxima: "2026-08-13",
      linkPdf: "https://x/d.pdf",
    });
  });
  it("RAD sem multa e juros deixa nulo, não zero", () => {
    const [r] = lerRespostaDarf({
      cdRetorno: "DARF_GERADO",
      darf: { codigoBarras: "1" },
      informacoesPagamento: { valorDarfPrincipal: 115.55, valorDarfTotal: 115.55 },
    });
    expect(r?.multaCents).toBeNull();
    expect(r?.totalCents).toBe(11555);
  });
  it("erro de entrada nunca vira DARF gerado", () => {
    const [r] = lerRespostaDarf({
      cdRetorno: "DADOS_DE_ENTRADA_INVALIDOS",
      mensagem: "Dados de entrada inválidos.",
      dadosInvalidos: ["pa"],
    });
    expect(r).toMatchObject({ gerado: false, dadosInvalidos: ["pa"] });
  });
  it("aceita lista de resultados (um por nota)", () => {
    expect(lerRespostaDarf([{ cdRetorno: "DFE_NAO_ENCONTRADO" }, { cdRetorno: "DARF_GERADO", darf: { chavePIX: "p" } }])).toHaveLength(2);
  });
});

describe("endereços novos", () => {
  const BASE = "https://api.receitafederal.gov.br";
  it("download do link e DARF", () => {
    expect(urlDownload(BASE, "producao", "T 1")).toBe("https://api.receitafederal.gov.br/apuracao-cbs/v2/download/T%201");
    expect(urlDarf(BASE, "producao", "pcont", "12.345.678/0001-95")).toBe(
      "https://api.receitafederal.gov.br/apuracao-cbs/v2/pcont/12345678000195",
    );
    expect(urlDarf(BASE, "restrita", "rad", "12345678000195")).toContain("/apuracao-cbs-prr/v2/rad/");
  });
});
