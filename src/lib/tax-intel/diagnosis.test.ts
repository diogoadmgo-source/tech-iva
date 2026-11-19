import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { diagnose, razaoDivergente } from "./diagnosis";
import { buildWorkbook, SANEAMENTO_COLUMNS } from "./excel";
import type { TaxClassification } from "./labels";
import type { PortfolioRow } from "./portfolio";

const row = (
  cnpj: string,
  c: TaxClassification,
  basis: Record<string, unknown> | null,
  extra: Partial<PortfolioRow["tax_entities"]> = {},
  declarada: string | null = "EMPRESA TESTE LTDA",
): PortfolioRow => ({
  tenant_id: "t",
  cnpj,
  relationship: "cliente",
  declared_razao_social: declarada,
  declared_nome_fantasia: null,
  first_import_id: null,
  last_import_id: null,
  created_at: "2026-11-18T10:00:00Z",
  tax_entities: {
    cnpj_raiz: cnpj.slice(0, 8),
    is_matriz: cnpj.slice(8, 12) === "0001",
    cnpj_alfanumerico: false,
    razao_social: "EMPRESA TESTE LTDA",
    situacao_cadastral: "ATIVA",
    uf: "SP",
    municipio: "SAO PAULO",
    public_classification: c,
    public_classification_basis: basis,
    last_consulted_at: "2026-11-18T10:00:00Z",
    ...extra,
  },
});

// Dados sintéticos: todas as classes e motivos que o banco grava.
const ROWS = [
  row("11111111000191", "simples_nacional", {
    fonte: "receita_simples",
    competencia: "2026-11",
    data_opcao_simples: "2018-01-01",
  }),
  row("22222222000191", "lucro_real", {
    fonte: "receita_regime_tributario",
    competencia: "2026-11",
    ano_calendario: 2024,
  }),
  row("33333333000191", "excluido_simples", {
    fonte: "receita_simples",
    data_exclusao: "2024-12-31",
  }),
  row("44444444000191", "nao_identificado", {
    motivo: "Sem opção pelo Simples e sem ECF publicada para esta empresa (matriz)",
  }),
  row(
    "00074823981804",
    "nao_identificado",
    { cnpj_inexistente: true, provavel_cpf: true },
    { situacao_cadastral: null, razao_social: "OUTRA EMPRESA DA RAIZ", natureza_juridica: "2062" },
  ),
  row(
    "55555555000191",
    "nao_identificado",
    { cnpj_inexistente: true },
    { situacao_cadastral: null, razao_social: null },
  ),
  row("66666666000191", "consulta_pendente", { motivo: "ainda não cruzado" }),
  row(
    "77777777000191",
    "simples_nacional",
    { fonte: "receita_simples" },
    { situacao_cadastral: "BAIXADA", situacao_data: "2023-05-02" },
  ),
];

describe("diagnóstico por linha", () => {
  it("toda linha tem status, causa e ação", () => {
    for (const r of ROWS) {
      const d = diagnose(r);
      expect(d.status).toBeTruthy();
      expect(d.causa.length).toBeGreaterThan(10);
      expect(d.acao.length).toBeGreaterThan(5);
    }
  });

  it("separa provável CPF, CNPJ inexistente, sem fonte e ressalva", () => {
    expect(ROWS.map((r) => diagnose(r).status)).toEqual([
      "identificado",
      "identificado",
      "ressalva",
      "sem_fonte_publica",
      "provavel_cpf",
      "cnpj_nao_encontrado",
      "aguardando",
      "identificado",
    ]);
  });

  it("não chama ausência de Simples de Presumido ou Real", () => {
    const d = diagnose(ROWS[3]!);
    expect(d.regime).toBe("—");
    expect(d.causa).toContain("não indica Lucro Presumido nem Lucro Real");
  });

  it("cadastro baixado vira alerta e prioridade alta, mesmo identificado", () => {
    const d = diagnose(ROWS[7]!);
    expect(d.prioridade).toBe("Alta");
    expect(d.alertas[0]).toContain("Baixada desde 02/05/2023");
  });

  it("Real/Presumido com ECF antiga vira ressalva, com o ano na causa", () => {
    const now = new Date("2026-11-18T12:00:00Z");
    const velha = diagnose(row("12345678000195", "lucro_presumido", { ano_calendario: 2019 }), now);
    expect(velha.status).toBe("ressalva");
    expect(velha.causa).toContain("2019");
    expect(velha.causa).toContain("2020 a 2024");
    expect(
      diagnose(row("12345678000195", "lucro_real", { ano_calendario: 2024 }), now).status,
    ).toBe("identificado");
  });

  it("Simples sem Consulta Optantes pede confirmação de IBS/CBS, com prioridade baixa", () => {
    const d = diagnose(ROWS[0]!, new Date(), null);
    expect(d.status).toBe("identificado");
    expect(d.precisaAcao).toBe(true);
    expect(d.prioridade).toBe("Baixa");
    expect(d.acao).toContain("IBS e CBS");
    // Sem informar (undefined), nada muda.
    expect(diagnose(ROWS[0]!).precisaAcao).toBe(false);
  });

  it("razão social: ignora sufixo e acento, acusa empresa diferente", () => {
    expect(razaoDivergente("Padaria São João Ltda - ME", "PADARIA SAO JOAO LTDA")).toBe(false);
    expect(razaoDivergente("Transportes Alfa", "BETA COMERCIO DE ALIMENTOS LTDA")).toBe(true);
    expect(razaoDivergente(null, "QUALQUER")).toBe(false);
  });
});

describe("Excel de saneamento", () => {
  const C = (t: string) => SANEAMENTO_COLUMNS.findIndex((c) => c[0] === t) + 1;
  const linhas = (ws: ExcelJS.Worksheet) => [...Array(ws.rowCount - 2).keys()].map((i) => i + 3);

  it("gera só Resumo e Saneamento, com a base inteira no Saneamento e as pendências primeiro", async () => {
    const blob = await buildWorkbook(ROWS, { filtro: "Toda a base", empresa: "Empresa de teste" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Resumo executivo", "Saneamento"]);
    const sn = wb.getWorksheet("Saneamento")!;
    expect(sn.getCell(2, 1).value).toBe("Documento");
    expect(sn.rowCount).toBe(ROWS.length + 2);
    for (const r of linhas(sn)) {
      expect(String(sn.getCell(r, C("Status")).value ?? "")).not.toBe("");
      expect(String(sn.getCell(r, C("Ação recomendada")).value ?? "")).not.toBe("");
    }
    // Pendências (7) antes das linhas sem ação, Alta primeiro.
    expect(sn.getCell(3, C("Prioridade")).value).toBe("Alta");
    expect(sn.getCell(3 + 7, C("Prioridade")).value).toBe("—");
    const simples = linhas(sn).find((r) => sn.getCell(r, 1).value === "11.111.111/0001-91")!;
    expect(sn.getCell(simples, C("Regime regular IBS/CBS")).value).toBe("A confirmar");
    const real = linhas(sn).find(
      (r) => sn.getCell(r, C("Regime identificado")).value === "Lucro Real",
    )!;
    expect(sn.getCell(real, C("Regime regular IBS/CBS")).value).toBe("Não se aplica");
    // CPF no formato de CPF, com o tipo ao lado.
    const cpfRow = linhas(sn).find((r) => sn.getCell(r, 2).value === "CPF")!;
    expect(sn.getCell(cpfRow, 1).value).toBe("748.239.818-04");
    // A raiz "00074823" pode ser de outra empresa: nada dela aparece na linha do CPF.
    expect(sn.getCell(cpfRow, C("Natureza jurídica")).value).toBeNull();
  });

  it("Simples consultado: opção e data em colunas próprias, sem pendência", async () => {
    const consultas = new Map([
      [
        "11111111",
        {
          raiz: "11111111",
          ibs: "sim" as const,
          cbs: "sim" as const,
          ibsDesde: "2027-01-01",
          cbsDesde: "2027-01-01",
          consultadoEm: "2026-11-19",
          descricao: "",
          temArquivo: false,
        },
      ],
    ]);
    const blob = await buildWorkbook(ROWS, { filtro: "Toda a base", consultas });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const sn = wb.getWorksheet("Saneamento")!;
    const r = linhas(sn).find((x) => sn.getCell(x, 1).value === "11.111.111/0001-91")!;
    expect(sn.getCell(r, C("Regime regular IBS/CBS")).value).toBe("Sim (IBS e CBS)");
    expect(
      (sn.getCell(r, C("Data da opção IBS/CBS")).value as Date).toISOString().slice(0, 10),
    ).toBe("2027-01-01");
    expect(sn.getCell(r, C("Prioridade")).value).toBe("—");
    expect(String(sn.getCell(r, C("Motivo")).value)).toContain(
      "IBS e CBS: optante desde 01/01/2027",
    );
    expect(String(sn.getCell(r, C("Motivo")).value)).not.toContain("consulta de");
  });

  it("une cliente e fornecedor do mesmo CNPJ numa linha e mostra o cadastro", async () => {
    const r = row(
      "11111111000191",
      "simples_nacional",
      { fonte: "receita_simples" },
      {
        data_abertura: "2010-05-20",
        cnae_principal: "4530703",
        cnae_descricao: "Comércio de peças",
        natureza_juridica: "2062",
        natureza_descricao: "Sociedade Empresária Limitada",
        porte: "03",
      },
    );
    const blob = await buildWorkbook([r, { ...r, relationship: "fornecedor" }], {
      filtro: "Toda a base",
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const sn = wb.getWorksheet("Saneamento")!;
    expect(sn.rowCount).toBe(3);
    expect(sn.getCell(3, C("Natureza jurídica")).value).toBe(
      "206-2 · Sociedade Empresária Limitada",
    );
    expect(sn.getCell(3, C("Porte")).value).toBe("Empresa de pequeno porte");
    expect(sn.getCell(3, C("CNAE principal")).value).toBe("4530-7/03 · Comércio de peças");
    expect(sn.getCell(3, C("Relacionamento")).value).toBe("Cliente e Fornecedor");
  });
});
