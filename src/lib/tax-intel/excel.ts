/**
 * Excel de diagnóstico para o cliente sanear a base. Usa o exceljs que o
 * projeto já tem (import dinâmico, fora do bundle inicial). Só escreve o que
 * veio do banco; o diagnóstico de cada linha vem de diagnose().
 *
 * Abas: Resumo · Base diagnosticada · Saneamento (com colunas para o cliente
 * responder) · Metodologia.
 */
import type { Worksheet } from "exceljs";
import { formatCnpj } from "./cnpj";
import {
  DIAGNOSIS_LABEL,
  DIAGNOSIS_ORDER,
  diagnose,
  type Diagnosis,
  type DiagnosisStatus,
} from "./diagnosis";
import { basisText, CLASSIFICATION_LABEL, RELATIONSHIP_LABEL, sourceName } from "./labels";
import type { PortfolioRow } from "./portfolio";

export const EXPORT_COLUMNS = [
  "CNPJ",
  "Razão social (seu cadastro)",
  "Razão social (Receita)",
  "Matriz/Filial",
  "Situação na Receita",
  "UF",
  "Município",
  "Regime tributário identificado",
  "Status do diagnóstico",
  "Causa",
  "Ação recomendada",
  "Prioridade",
  "Alertas do cadastro",
  "Fonte",
  "Evidência completa",
  "Relacionamento",
  "Última consulta",
] as const;
const WIDTHS = [20, 36, 36, 12, 16, 5, 20, 28, 34, 60, 46, 11, 40, 26, 70, 14, 17];

export function toExportRow(r: PortfolioRow, d: Diagnosis = diagnose(r)): (string | Date | null)[] {
  const e = r.tax_entities;
  const b = e.public_classification_basis;
  const foraDaReceita = d.status === "provavel_cpf" || d.status === "cnpj_nao_encontrado";
  return [
    formatCnpj(r.cnpj),
    r.declared_razao_social,
    e.razao_social,
    foraDaReceita ? "—" : e.is_matriz ? "Matriz" : "Filial",
    e.situacao_cadastral ?? (foraDaReceita ? "Não consta" : null),
    e.uf,
    e.municipio,
    d.regime,
    DIAGNOSIS_LABEL[d.status],
    d.causa,
    d.acao,
    d.prioridade,
    d.alertas.join(" · ") || null,
    b?.["fonte"] ? sourceName(String(b["fonte"])) : null,
    basisText(b) || null,
    RELATIONSHIP_LABEL[r.relationship],
    e.last_consulted_at ? new Date(e.last_consulted_at) : null,
  ];
}

// Paleta discreta (ARGB). Verde = resolvido, âmbar = confirmar, vermelho = corrigir.
const C = {
  ink: "FF0F172A",
  muted: "FF64748B",
  head: "FF1E293B",
  line: "FFE2E8F0",
  zebra: "FFF8FAFC",
  ok: "FFE7F6EC",
  okInk: "FF166534",
  warn: "FFFFF4DB",
  warnInk: "FF92400E",
  bad: "FFFDE8E8",
  badInk: "FF991B1B",
  idle: "FFF1F5F9",
  input: "FFFFFBEB",
};
const TONE: Record<DiagnosisStatus, [string, string]> = {
  identificado: [C.ok, C.okInk],
  ressalva: [C.warn, C.warnInk],
  sem_fonte_publica: [C.warn, C.warnInk],
  cnpj_nao_encontrado: [C.bad, C.badInk],
  provavel_cpf: [C.bad, C.badInk],
  aguardando: [C.idle, C.muted],
};
const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
const thin = { style: "thin" as const, color: { argb: C.line } };
const border = { top: thin, left: thin, bottom: thin, right: thin };
const FONT = "Calibri";

function styleHeader(ws: Worksheet, row: number, cols: number, argb = C.head) {
  const r = ws.getRow(row);
  r.height = 30;
  for (let i = 1; i <= cols; i++) {
    const c = r.getCell(i);
    c.fill = fill(argb);
    c.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    c.alignment = { vertical: "middle", wrapText: true };
    c.border = border;
  }
}

function table(
  ws: Worksheet,
  header: string[],
  rows: (string | number | Date | null)[][],
  widths: number[],
  tone?: (i: number) => [string, string] | null,
  toneCol?: number,
) {
  ws.addRow(header);
  styleHeader(ws, 1, header.length);
  rows.forEach((v, i) => {
    const row = ws.addRow(v);
    row.eachCell({ includeEmpty: true }, (c, col) => {
      c.font = { name: FONT, size: 10, color: { argb: C.ink } };
      c.alignment = { vertical: "top", wrapText: col > 1 };
      c.border = border;
      if (i % 2 === 1) c.fill = fill(C.zebra);
    });
    const t = tone?.(i);
    if (t && toneCol) {
      const c = row.getCell(toneCol);
      c.fill = fill(t[0]);
      c.font = { name: FONT, size: 10, bold: true, color: { argb: t[1] } };
    }
  });
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };
}

const pct = (a: number, t: number) => (t ? a / t : 0);

export async function buildWorkbook(
  rows: PortfolioRow[],
  meta: { filtro: string; empresa?: string | null },
) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "TECH-IVA";
  wb.created = new Date();
  const items = rows.map((r) => ({ r, d: diagnose(r) }));
  const diag = items.map((x) => x.d);
  const total = rows.length;
  const competencias = [
    ...new Set(
      rows
        .map((r) => r.tax_entities.public_classification_basis?.["competencia"])
        .filter((v): v is string => typeof v === "string" && /^\d{4}-\d{2}$/.test(v)),
    ),
  ].sort();

  // ------------------------------------------------------------------ Resumo
  const rs = wb.addWorksheet("Resumo", {
    views: [{ showGridLines: false }],
    properties: { tabColor: { argb: C.head } },
  });
  rs.columns = [{ width: 3 }, { width: 46 }, { width: 14 }, { width: 11 }, { width: 62 }];
  const title = rs.getCell("B2");
  title.value = "Diagnóstico tributário da base de CNPJs";
  title.font = { name: FONT, size: 18, bold: true, color: { argb: C.ink } };
  const info: [string, string | Date | number][] = [
    ["Empresa", meta.empresa ?? "—"],
    ["Gerado em", new Date()],
    ["Dados da Receita (competência)", competencias.length ? competencias.join(", ") : "—"],
    ["Recorte exportado", meta.filtro],
    ["CNPJs nesta planilha", total],
  ];
  info.forEach(([k, v], i) => {
    const r = rs.getRow(4 + i);
    r.getCell(2).value = k;
    r.getCell(2).font = { name: FONT, size: 10, color: { argb: C.muted } };
    r.getCell(3).value = v;
    r.getCell(3).font = { name: FONT, size: 10, bold: true, color: { argb: C.ink } };
    if (v instanceof Date) r.getCell(3).numFmt = "dd/mm/yyyy hh:mm";
  });

  let line = 11;
  const block = (titulo: string, header: string[], data: (string | number)[][], tones?: ([string, string] | null)[]) => {
    rs.getCell(line, 2).value = titulo;
    rs.getCell(line, 2).font = { name: FONT, size: 12, bold: true, color: { argb: C.ink } };
    line++;
    header.forEach((h, i) => (rs.getCell(line, 2 + i).value = h));
    for (let i = 0; i < header.length; i++) {
      const c = rs.getCell(line, 2 + i);
      c.fill = fill(C.head);
      c.font = { name: FONT, bold: true, size: 10, color: { argb: "FFFFFFFF" } };
      c.border = border;
      c.alignment = { vertical: "middle" };
    }
    line++;
    data.forEach((v, j) => {
      v.forEach((x, i) => {
        const c = rs.getCell(line, 2 + i);
        c.value = x;
        c.border = border;
        c.font = { name: FONT, size: 10, color: { argb: C.ink }, bold: i === 0 && Boolean(tones?.[j]) };
        c.alignment = { vertical: "top", wrapText: i === 3 };
        if (i === 2 && typeof x === "number") c.numFmt = "0.0%";
        if (i === 0 && tones?.[j]) {
          c.fill = fill(tones[j]![0]);
          c.font = { name: FONT, size: 10, bold: true, color: { argb: tones[j]![1] } };
        }
      });
      line++;
    });
    line++;
  };

  const porStatus = DIAGNOSIS_ORDER.map((s) => {
    const n = diag.filter((d) => d.status === s).length;
    const acao = diag.find((d) => d.status === s)?.acao ?? "";
    return { s, n, acao };
  }).filter((x) => x.n > 0);
  block(
    "Resultado do diagnóstico",
    ["Status", "CNPJs", "% da base", "O que fazer"],
    [
      ...porStatus.map((x) => [DIAGNOSIS_LABEL[x.s], x.n, pct(x.n, total), x.acao]),
      ["Total", total, 1, ""],
    ],
    [...porStatus.map((x) => TONE[x.s]), null],
  );

  const regimes = new Map<string, number>();
  for (const r of rows) {
    const k = CLASSIFICATION_LABEL[r.tax_entities.public_classification];
    regimes.set(k, (regimes.get(k) ?? 0) + 1);
  }
  block(
    "Por regime tributário (fonte pública)",
    ["Regime", "CNPJs", "% da base", "Observação"],
    [...regimes.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => [
        k,
        n,
        pct(n, total),
        k === "Lucro Real" || k === "Lucro Presumido"
          ? "Pelo ano-calendário da última ECF publicada (histórico, não o regime vigente)."
          : k === "Excluído do Simples"
            ? "Saiu do Simples; o regime atual depende de confirmação."
            : "",
      ]),
  );

  const alertas = new Map<string, number>();
  for (const d of diag) for (const a of d.alertas) {
    const k = a.startsWith("Situação na Receita") ? `Situação na Receita: ${(a.split(": ")[1] ?? "").split(" desde")[0]}` : a;
    alertas.set(k, (alertas.get(k) ?? 0) + 1);
  }
  if (alertas.size)
    block(
      "Alertas de cadastro (além do regime)",
      ["Alerta", "CNPJs", "% da base", ""],
      [...alertas.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, n, pct(n, total), ""]),
    );
  rs.getCell(line, 2).value =
    "Detalhe por CNPJ na aba \"Base diagnosticada\". As linhas que pedem ação estão na aba \"Saneamento\", com colunas para a sua resposta.";
  rs.getCell(line, 2).font = { name: FONT, size: 10, italic: true, color: { argb: C.muted } };

  // ---------------------------------------------------------- Base completa
  const ws = wb.addWorksheet("Base diagnosticada", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
  });
  table(
    ws,
    [...EXPORT_COLUMNS],
    items.map((x) => toExportRow(x.r, x.d)),
    WIDTHS,
    (i) => (items[i] ? TONE[items[i].d.status] : null),
    9,
  );
  ws.getColumn(17).numFmt = "dd/mm/yyyy hh:mm";

  // ------------------------------------------------------------- Saneamento
  const PRI = { Alta: 0, Média: 1, Baixa: 2, "—": 3 } as const;
  const fila = items
    .filter((x) => x.d.precisaAcao)
    .sort(
      (a, b) =>
        PRI[a.d.prioridade] - PRI[b.d.prioridade] ||
        DIAGNOSIS_ORDER.indexOf(a.d.status) - DIAGNOSIS_ORDER.indexOf(b.d.status) ||
        a.r.cnpj.localeCompare(b.r.cnpj),
    );
  const sn = wb.addWorksheet("Saneamento", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
    properties: { tabColor: { argb: "FFF59E0B" } },
  });
  const SN_HEAD = [
    "CNPJ",
    "Razão social (seu cadastro)",
    "Razão social (Receita)",
    "Prioridade",
    "Status do diagnóstico",
    "Causa",
    "Ação recomendada",
    "CNPJ correto (preencher)",
    "Regime atual informado (preencher)",
    "Observação (preencher)",
  ];
  table(
    sn,
    SN_HEAD,
    fila.map(({ r, d }) => [
      formatCnpj(r.cnpj),
      r.declared_razao_social,
      r.tax_entities.razao_social,
      d.prioridade,
      DIAGNOSIS_LABEL[d.status],
      d.causa,
      d.acao,
      null,
      null,
      null,
    ]),
    [20, 34, 34, 11, 32, 60, 44, 22, 26, 34],
    (i) => (fila[i] ? TONE[fila[i].d.status] : null),
    5,
  );
  // Colunas de resposta do cliente: destacadas e com lista no regime.
  styleHeader(sn, 1, SN_HEAD.length);
  for (const col of [8, 9, 10]) {
    sn.getRow(1).getCell(col).fill = fill("FFB45309");
    for (let r = 2; r <= fila.length + 1; r++) sn.getCell(r, col).fill = fill(C.input);
  }
  for (let r = 2; r <= fila.length + 1; r++)
    sn.getCell(r, 9).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"Simples Nacional,MEI (SIMEI),Lucro Presumido,Lucro Real,Imune ou isenta,Pessoa física,Cadastro inativo"'],
    };
  if (!fila.length) sn.addRow(["Nenhuma linha precisa de ação neste recorte."]);

  // ------------------------------------------------------------ Metodologia
  const mt = wb.addWorksheet("Metodologia", { views: [{ showGridLines: false }] });
  mt.columns = [{ width: 3 }, { width: 34 }, { width: 100 }];
  mt.getCell("B2").value = "Como cada linha foi diagnosticada";
  mt.getCell("B2").font = { name: FONT, size: 14, bold: true, color: { argb: C.ink } };
  const notas: [string, string][] = [
    ["Fontes", "Dados abertos oficiais da Receita Federal: Simples Nacional e SIMEI, cadastro de Empresas e Estabelecimentos, e regime declarado na ECF. Cruzamento em lote, com a competência indicada no Resumo."],
    [DIAGNOSIS_LABEL.identificado, "Optante pelo Simples ou SIMEI na Receita, ou Lucro Real/Presumido declarado na ECF. Real e Presumido vêm sempre com o ano-calendário da ECF: é histórico declarado, não o regime vigente."],
    [DIAGNOSIS_LABEL.ressalva, "Excluído do Simples sem ECF publicada depois da saída. O regime atual precisa ser confirmado."],
    [DIAGNOSIS_LABEL.sem_fonte_publica, "Nunca optou pelo Simples e não há ECF publicada para a empresa (matriz). Não optar pelo Simples nunca é tratado como Lucro Presumido ou Lucro Real."],
    [DIAGNOSIS_LABEL.cnpj_nao_encontrado, "O número não existe no cadastro de CNPJ da Receita."],
    [DIAGNOSIS_LABEL.provavel_cpf, "O número não existe no cadastro de CNPJ e, sem os três zeros iniciais, é um CPF válido (pessoa física)."],
    [DIAGNOSIS_LABEL.aguardando, "O CNPJ entrou na base depois do último processamento."],
    ["Filiais", "A ECF é declarada pela matriz: a filial recebe o regime da empresa (mesma raiz de 8 dígitos)."],
    ["Prioridade", "Alta: corrigir o número ou o cadastro inativo. Média: confirmar o regime com o parceiro. Baixa: conferência simples."],
    ["Como responder", "Na aba Saneamento, preencha as colunas destacadas em amarelo e devolva a planilha. O regime informado tem lista de opções."],
  ];
  notas.forEach(([k, v], i) => {
    const r = mt.getRow(4 + i);
    r.getCell(2).value = k;
    r.getCell(2).font = { name: FONT, size: 10, bold: true, color: { argb: C.ink } };
    r.getCell(3).value = v;
    r.getCell(3).font = { name: FONT, size: 10, color: { argb: C.ink } };
    r.getCell(3).alignment = { wrapText: true, vertical: "top" };
    r.getCell(2).alignment = { vertical: "top", wrapText: true };
  });

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
