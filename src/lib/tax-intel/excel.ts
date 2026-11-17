/**
 * Exportação Excel da carteira. Usa o exceljs que o projeto já tem (import
 * dinâmico, fora do bundle inicial). Só escreve o que veio do banco.
 */
import { formatCnpj } from "./cnpj";
import { CLASSIFICATION_LABEL, RELATIONSHIP_LABEL } from "./labels";
import type { PortfolioRow } from "./portfolio";

export const EXPORT_COLUMNS = [
  "CNPJ",
  "Raiz",
  "Estrutura",
  "Alfanumérico",
  "Relacionamento",
  "Razão social (declarada)",
  "Nome fantasia (declarado)",
  "Razão social (fonte pública)",
  "Situação cadastral",
  "UF",
  "Município",
  "Classificação pública",
  "Última consulta",
  "Na carteira desde",
] as const;

export function toExportRow(r: PortfolioRow): (string | Date | null)[] {
  const e = r.tax_entities;
  return [
    formatCnpj(r.cnpj),
    e.cnpj_raiz,
    e.is_matriz ? "Matriz" : "Filial",
    e.cnpj_alfanumerico ? "Sim" : "Não",
    RELATIONSHIP_LABEL[r.relationship],
    r.declared_razao_social,
    r.declared_nome_fantasia,
    e.razao_social,
    e.situacao_cadastral,
    e.uf,
    e.municipio,
    CLASSIFICATION_LABEL[e.public_classification],
    e.last_consulted_at ? new Date(e.last_consulted_at) : null,
    new Date(r.created_at),
  ];
}

export async function buildWorkbook(rows: PortfolioRow[], meta: { filtro: string }) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "TECH-IVA";
  wb.created = new Date();
  const ws = wb.addWorksheet("Carteira", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow([...EXPORT_COLUMNS]);
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(toExportRow(r));
  ws.columns.forEach((c, i) => {
    c.width = [20, 11, 10, 12, 14, 36, 28, 36, 18, 5, 22, 26, 18, 18][i] ?? 16;
  });
  ws.getColumn(13).numFmt = "dd/mm/yyyy hh:mm";
  ws.getColumn(14).numFmt = "dd/mm/yyyy hh:mm";
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: EXPORT_COLUMNS.length } };

  const info = wb.addWorksheet("Sobre");
  info.addRow(["Gerado em", new Date()]);
  info.addRow(["Linhas", rows.length]);
  info.addRow(["Filtro", meta.filtro]);
  info.addRow([
    "Observação",
    "Classificação pública vem das fontes consultadas. 'Consulta pendente' = ainda não consultado; nenhum regime é presumido.",
  ]);
  info.getColumn(1).width = 14;
  info.getColumn(2).width = 100;
  info.getCell("B1").numFmt = "dd/mm/yyyy hh:mm";

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
