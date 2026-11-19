import { describe, expect, it } from "vitest";
import { arquivoV2Reconhecido, lerPagamentosV2 } from "./pagamentos";

// Exemplos das páginas de recolhimentos e pagamentos (documentação 1.3).
const RECOLHIMENTOS = {
  tiqueteSolicitacao: "48d88a3c.1E0CE7A4",
  ni: "12345678",
  apuracao: [
    {
      dataArrecadacao: "2026-08-27",
      pagamentos: [
        {
          numeroDARF: "20260827000000001",
          tipo: 1,
          composicao: [
            {
              sequencial: 1,
              pa: "08/2026",
              vencimento: "2026-09-20",
              niFornecedor: "98765432000199",
              chaveDFE: "35260898765432000199550010000001231234567890",
              principal: 100.0,
              multa: 10.0,
              juros: 5.0,
              total: 115.0,
            },
          ],
        },
      ],
    },
  ],
};

const PAGAMENTOS = {
  apuracao: [
    {
      dataArrecadacao: "2026-08-27",
      pagamentos: [
        {
          numeroDARF: "20260827000000002",
          tipo: 2,
          niContribuinte: "12345678000195",
          composicao: [
            { sequencial: 1, pa: "08/2026", vencimento: "2026-09-20", principal: 80, multa: 0.5, juros: 1.25, total: 81.75 },
          ],
        },
      ],
    },
  ],
};

describe("leitor de pagamentos e recolhimentos v2", () => {
  it("achata o recolhimento como adquirente, item a item", () => {
    const [l, ...resto] = lerPagamentosV2(RECOLHIMENTOS);
    expect(resto).toHaveLength(0);
    expect(l).toMatchObject({
      data_arrecadacao: "2026-08-27",
      numero_darf: "20260827000000001",
      tipo: 1,
      sequencial: 1,
      pa: "08/2026",
      ni_fornecedor: "98765432000199",
      chave_dfe: "35260898765432000199550010000001231234567890",
      principal_cents: 10000,
      multa_cents: 1000,
      juros_cents: 500,
      total_cents: 11500,
    });
  });

  it("no PCONT o NI do contribuinte vem do pagamento", () => {
    const [l] = lerPagamentosV2(PAGAMENTOS);
    expect(l?.ni_contribuinte).toBe("12345678000195");
    expect(l?.chave_dfe).toBeNull();
    expect(l?.total_cents).toBe(8175);
  });

  it("lista vazia é arquivo válido sem linhas; sem lista não é reconhecido", () => {
    expect(lerPagamentosV2({ apuracao: [] })).toEqual([]);
    expect(arquivoV2Reconhecido({ apuracao: [] })).toBe(true);
    expect(arquivoV2Reconhecido({ outra: 1 })).toBe(false);
  });
});
