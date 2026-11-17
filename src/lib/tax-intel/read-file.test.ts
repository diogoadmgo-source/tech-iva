import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { cnpjCheckDigits } from "./cnpj";
import { buildPreview } from "./preview";
import { cellText, decodeText, mapHeaders, readTabular } from "./read-file";
import { inspectZip } from "./zip-guard";

async function xlsx(build: (ws: ExcelJS.Worksheet) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  build(wb.addWorksheet("Base"));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const enc = (s: string) => new TextEncoder().encode(s);
const cnpj = (body12: string) => body12 + cnpjCheckDigits(body12);

describe("leitura de XLSX (exceljs)", () => {
  it("lê CNPJ numérico sem notação científica, rich text e fórmula como texto", async () => {
    const lostZero = Number(cnpj("012345670001")); // Excel guardou como número
    const bytes = await xlsx((ws) => {
      ws.addRow(["Relatório de clientes"]);
      ws.addRow([]);
      ws.addRow(["CNPJ", "Razão Social", "Nome Fantasia", "Tipo"]);
      ws.addRow([lostZero, "Alfa Ltda", "Alfa", "Cliente"]);
      ws.addRow([
        { richText: [{ text: "11.222.333/" }, { text: "0001-81" }] },
        "Beta SA",
        null,
        "Fornecedor",
      ]);
      ws.addRow([
        { formula: '"12ABC34501DE"&"35"', result: "12ABC34501DE35" },
        "Gama",
        null,
        "Ambos",
      ]);
      ws.addRow([]);
      ws.addRow([null, "Sem CNPJ", null, "cliente"]);
    });
    expect(inspectZip(bytes).entries).toBeGreaterThan(0);
    const res = await readTabular("base.xlsx", bytes);
    expect(res.kind).toBe("xlsx");
    expect(res.sheetName).toBe("Base");
    expect(res.headerLine).toBe(3);
    expect(res.columns).toEqual({
      cnpj: "CNPJ",
      razao: "Razão Social",
      fantasia: "Nome Fantasia",
      rel: "Tipo",
    });
    expect(res.rows.map((r) => r.cnpj)).toEqual([
      String(lostZero),
      "11.222.333/0001-81",
      "12ABC34501DE35",
      null,
    ]);
    expect(res.rows.map((r) => r.line)).toEqual([4, 5, 6, 8]);
    expect(String(lostZero)).not.toMatch(/e\+/i);

    const pv = buildPreview(res.rows, null);
    expect(pv).toMatchObject({ valid: 3, missingCnpj: 1, padded: 1, alfanumericos: 1 });
  });

  it("recusa planilha sem coluna de CNPJ", async () => {
    const bytes = await xlsx((ws) => {
      ws.addRow(["Nome", "Cidade"]);
      ws.addRow(["x", "y"]);
    });
    await expect(readTabular("x.xlsx", bytes)).rejects.toThrow(/coluna de CNPJ/);
  });

  it("cellText não perde dígitos de inteiro grande", () => {
    expect(cellText(11222333000181)).toBe("11222333000181");
    expect(cellText({ error: "#N/A" })).toBe("");
  });
});

describe("leitura de CSV (papaparse)", () => {
  it("detecta ponto e vírgula e UTF-8 com BOM", async () => {
    const res = await readTabular(
      "b.csv",
      enc("﻿cnpj;razão social;relacionamento\n11222333000181;Ação Ltda;cliente\n"),
    );
    expect(res.delimiter).toBe(";");
    expect(res.encoding).toBe("utf-8");
    expect(res.rows[0]).toMatchObject({
      cnpj: "11222333000181",
      razao: "Ação Ltda",
      rel: "cliente",
    });
  });

  it("detecta vírgula com campo entre aspas", async () => {
    const res = await readTabular(
      "b.csv",
      enc('CNPJ,Razao,Fantasia\n"11.222.333/0001-81","Silva, Souza e Cia",SS\n'),
    );
    expect(res.delimiter).toBe(",");
    expect(res.rows[0]).toMatchObject({
      cnpj: "11.222.333/0001-81",
      razao: "Silva, Souza e Cia",
      fantasia: "SS",
    });
  });

  it("cai para Windows-1252 quando o arquivo não é UTF-8", async () => {
    const latin1 = Uint8Array.from([
      ...enc("cnpj;razao\n11222333000181;Associa"),
      0xe7,
      0xe3,
      ...enc("o\n"),
    ]);
    expect(decodeText(latin1).encoding).toBe("windows-1252");
    const res = await readTabular("b.csv", latin1);
    expect(res.rows[0]!.razao).toBe("Associação");
  });

  it("mapeia cabeçalhos comuns", () => {
    expect(mapHeaders(["Nº", "CNPJ do Cliente", "Empresa", "Cliente/Fornecedor"])).toEqual({
      cnpj: 1,
      razao: 2,
      rel: 3,
    });
  });

  it("recusa mais de 100 mil linhas", async () => {
    const body = "cnpj\n" + "11222333000181\n".repeat(100_001);
    await expect(readTabular("big.csv", enc(body))).rejects.toThrow(/100\.000/);
  });
});

describe("volume: 70 mil linhas", () => {
  const N = 70_000;
  const rowsCsv = () => {
    const lines = ["CNPJ;Razão Social;Tipo"];
    for (let i = 1; i <= N; i += 1)
      lines.push(
        `${cnpj(String(40000000 + i) + "0001")};Empresa ${i};${i % 3 ? "cliente" : "fornecedor"}`,
      );
    return enc(lines.join("\n"));
  };

  it("CSV: lê e monta a prévia", async () => {
    const t0 = performance.now();
    const res = await readTabular("70k.csv", rowsCsv());
    const pv = buildPreview(res.rows, null);
    const ms = performance.now() - t0;
    expect(res.rows).toHaveLength(N);
    expect(pv.valid).toBe(N);
    console.info(`[tax-intel] CSV 70k: leitura + prévia em ${ms.toFixed(0)} ms`);
  });

  it("XLSX: lê e monta a prévia", async () => {
    const bytes = await xlsx((ws) => {
      ws.addRow(["CNPJ", "Razão Social", "Tipo"]);
      for (let i = 1; i <= N; i += 1)
        ws.addRow([Number(cnpj(String(40000000 + i) + "0001")), `Empresa ${i}`, "cliente"]);
    });
    const t0 = performance.now();
    const res = await readTabular("70k.xlsx", bytes);
    const pv = buildPreview(res.rows, null);
    const ms = performance.now() - t0;
    expect(res.rows).toHaveLength(N);
    expect(pv.valid).toBe(N);
    console.info(
      `[tax-intel] XLSX 70k (${(bytes.length / 1024 / 1024).toFixed(1)} MB): leitura + prévia em ${ms.toFixed(0)} ms`,
    );
  }, 120_000);
});
