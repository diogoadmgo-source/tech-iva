/**
 * Excel de diagnóstico para o cliente sanear a base. Usa o exceljs que o
 * projeto já tem (import dinâmico, fora do bundle inicial). Só escreve o que
 * veio do banco; o diagnóstico de cada linha vem de diagnose().
 *
 * Abas: Resumo executivo (relatório para a diretoria) · Saneamento (uma linha
 * por documento, com todos os dados, o diagnóstico e as colunas para o cliente
 * responder; as linhas que pedem ação vêm primeiro).
 */
import type { Worksheet } from "exceljs";
import {
  cnaeText,
  DIAGNOSIS_LABEL,
  DIAGNOSIS_ORDER,
  diagnose,
  documento,
  naturezaText,
  PORTE_LABEL,
  type Diagnosis,
  type DiagnosisStatus,
} from "./diagnosis";
import {
  consultaEfetiva,
  ibsCbsDesde,
  ibsCbsOpcao,
  raizOf,
  type ConsultaRegistrada,
} from "./consulta-optantes";
import { CLASSIFICATION_LABEL, RELATIONSHIP_LABEL } from "./labels";
import type { PortfolioRow } from "./portfolio";

/** Colunas da aba Saneamento: [título, largura, grupo]. */
export const SANEAMENTO_COLUMNS = [
  ["Documento", 21, "Documento"],
  ["Tipo", 7, "Documento"],
  ["Razão social", 40, "Documento"],
  ["Relacionamento", 18, "Documento"],
  ["Natureza jurídica", 30, "Cadastro na Receita"],
  ["Porte", 16, "Cadastro na Receita"],
  ["Matriz/Filial", 11, "Cadastro na Receita"],
  ["Data de abertura", 12, "Cadastro na Receita"],
  ["CNAE principal", 40, "Cadastro na Receita"],
  ["Município/UF", 22, "Cadastro na Receita"],
  ["Situação cadastral", 13, "Cadastro na Receita"],
  ["Regime identificado", 20, "Regime tributário"],
  ["Referência", 13, "Regime tributário"],
  ["Regime regular IBS/CBS", 18, "Regime tributário"],
  ["Data da opção IBS/CBS", 13, "Regime tributário"],
  ["Prioridade", 10, "Diagnóstico"],
  ["Status", 28, "Diagnóstico"],
  ["Motivo", 60, "Diagnóstico"],
  ["Ação recomendada", 44, "Diagnóstico"],
  ["Documento correto", 22, "Sua resposta (preencher)"],
  ["Regime atual informado", 24, "Sua resposta (preencher)"],
  ["Observação", 34, "Sua resposta (preencher)"],
] as const;
const COL = (t: (typeof SANEAMENTO_COLUMNS)[number][0]) =>
  SANEAMENTO_COLUMNS.findIndex((c) => c[0] === t) + 1;
const DATE_COLS = ["Data de abertura", "Data da opção IBS/CBS"] as const;
const INPUT_FROM = COL("Documento correto");

type Consultas = Map<string, ConsultaRegistrada>;
type Item = { r: PortfolioRow; d: Diagnosis; rel: string; ibs: ConsultaRegistrada | null };

const isoToDate = (v?: string | null) =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00Z`) : null;
const foraDaReceita = (d: Diagnosis) =>
  d.status === "provavel_cpf" || d.status === "cnpj_nao_encontrado";

function referencia(r: PortfolioRow, d: Diagnosis): string | null {
  const b = r.tax_entities.public_classification_basis;
  if (foraDaReceita(d) || d.status === "aguardando") return null;
  if (b?.["ano_calendario"]) return `ECF ${String(b["ano_calendario"])}`;
  if (b?.["competencia"]) return `Receita ${String(b["competencia"])}`;
  return null;
}

/** Opção IBS/CBS e a data, em colunas separadas. */
function ibsCbsColunas(
  r: PortfolioRow,
  d: Diagnosis,
  c: ConsultaRegistrada | null,
): [string | null, Date | null] {
  if (foraDaReceita(d)) return ["—", null];
  if (d.status === "aguardando") return [null, null];
  const k = r.tax_entities.public_classification;
  const sit = r.tax_entities.situacao_cadastral;
  // Cadastro inativo não é consultado (0256): a opção não interessa.
  if (k === "simples_nacional" && !c && sit && sit !== "ATIVA")
    return ["Não consultado (inativo)", null];
  if (k === "simples_nacional") return [ibsCbsOpcao(c), isoToDate(ibsCbsDesde(c))];
  if (k === "mei_simei") return ["Não se aplica (MEI)", null];
  return ["Não se aplica", null];
}

export function toSaneamentoRow(
  r: PortfolioRow,
  d: Diagnosis = diagnose(r),
  ibs: ConsultaRegistrada | null = null,
  rel: string | null = null,
): (string | Date | null)[] {
  const e = r.tax_entities;
  const doc = documento(r, d);
  const fora = foraDaReceita(d);
  const local = [e.municipio, e.uf].filter(Boolean).join("/");
  return [
    doc.numero,
    doc.tipo,
    // Fora da Receita, a raiz pode coincidir com outra empresa: não mostra dados dela.
    (fora ? null : e.razao_social) ??
      (r.declared_razao_social ? `${r.declared_razao_social} (seu cadastro)` : null),
    rel,
    fora ? null : naturezaText(e.natureza_juridica, e.natureza_descricao),
    fora || !e.porte ? null : (PORTE_LABEL[e.porte] ?? e.porte),
    fora ? "—" : e.is_matriz ? "Matriz" : "Filial",
    isoToDate(e.data_abertura),
    cnaeText(e.cnae_principal, e.cnae_descricao),
    local || null,
    e.situacao_cadastral ?? (fora ? "Não consta" : null),
    fora ? "—" : CLASSIFICATION_LABEL[e.public_classification],
    referencia(r, d),
    ...ibsCbsColunas(r, d, ibs),
    d.prioridade,
    DIAGNOSIS_LABEL[d.status],
    d.causa,
    d.acao,
    null,
    null,
    null,
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
  card: "FFF1F5F9",
  accent: "FF2563EB",
};
const TONE: Record<DiagnosisStatus, [string, string]> = {
  identificado: [C.ok, C.okInk],
  ressalva: [C.warn, C.warnInk],
  sem_fonte_publica: [C.warn, C.warnInk],
  cnpj_nao_encontrado: [C.bad, C.badInk],
  provavel_cpf: [C.bad, C.badInk],
  aguardando: [C.idle, C.muted],
};
const fill = (argb: string) => ({
  type: "pattern" as const,
  pattern: "solid" as const,
  fgColor: { argb },
});
const thin = { style: "thin" as const, color: { argb: C.line } };
const border = { top: thin, left: thin, bottom: thin, right: thin };
const FONT = "Calibri";

const pct = (a: number, t: number) => (t ? a / t : 0);
const nf = (v: number) => v.toLocaleString("pt-BR");
const br = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const mesAno = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;
const pf = (a: number, t: number) =>
  `${(pct(a, t) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/** Uma linha por documento: o mesmo CNPJ como cliente e fornecedor vira uma só. */
function porDocumento(rows: PortfolioRow[], consultas: Consultas): Item[] {
  const map = new Map<string, { r: PortfolioRow; rels: Set<string> }>();
  for (const r of rows) {
    const cur = map.get(r.cnpj);
    if (cur) cur.rels.add(RELATIONSHIP_LABEL[r.relationship]);
    else map.set(r.cnpj, { r, rels: new Set([RELATIONSHIP_LABEL[r.relationship]]) });
  }
  return [...map.values()].map(({ r, rels }) => {
    const ibs = consultaEfetiva(r, consultas.get(raizOf(r.cnpj)));
    return { r, ibs, d: diagnose(r, new Date(), ibs), rel: [...rels].join(" e ") };
  });
}

export async function buildWorkbook(
  rows: PortfolioRow[],
  meta: { filtro: string; empresa?: string | null; consultas?: Consultas },
) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "TECH-IVA";
  wb.created = new Date();
  const items = porDocumento(rows, meta.consultas ?? new Map());
  const total = items.length;
  const count = (f: (x: Item) => boolean) => items.filter(f).length;
  const competencias = [
    ...new Set(
      items
        .map((x) => x.r.tax_entities.public_classification_basis?.["competencia"])
        .filter((v): v is string => typeof v === "string" && /^\d{4}-\d{2}$/.test(v)),
    ),
  ].sort();

  resumo(
    wb.addWorksheet("Resumo executivo", {
      views: [{ showGridLines: false, zoomScale: 100 }],
      properties: { tabColor: { argb: C.head } },
      pageSetup: {
        paperSize: 9,
        orientation: "portrait",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 1,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      },
    }),
    items,
    total,
    count,
    competencias,
    meta,
  );

  saneamento(
    wb.addWorksheet("Saneamento", {
      views: [{ state: "frozen", xSplit: 1, ySplit: 2 }],
      properties: { tabColor: { argb: "FFF59E0B" } },
    }),
    items,
  );

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// ------------------------------------------------------------ Resumo executivo
/** Colunas B..I do relatório (A é margem). */
const R0 = 2;
const R1 = 9;
const RW = 15.5;
/** Caracteres por linha num bloco mesclado de B a I (fonte 10–11). */
const CPL = 118;

function resumo(
  rs: Worksheet,
  items: Item[],
  total: number,
  count: (f: (x: Item) => boolean) => number,
  competencias: string[],
  meta: { filtro: string; empresa?: string | null },
) {
  rs.getColumn(1).width = 2.5;
  for (let c = R0; c <= R1; c++) rs.getColumn(c).width = RW;
  rs.getColumn(R1 + 1).width = 2.5;

  const span = (row: number, c0: number, c1: number) => {
    if (c1 > c0) rs.mergeCells(row, c0, row, c1);
    return rs.getCell(row, c0);
  };
  const paint = (row: number, c0: number, c1: number, argb: string) => {
    for (let c = c0; c <= c1; c++) rs.getCell(row, c).fill = fill(argb);
  };
  const altura = (t: string, cpl: number, base = 15) =>
    Math.max(base, Math.ceil(t.length / cpl) * 14.5 + 4);

  // Faixa de título.
  for (let r = 1; r <= 5; r++) paint(r, 1, R1 + 1, C.head);
  rs.getRow(1).height = 10;
  rs.getRow(2).height = 30;
  rs.getRow(3).height = 18;
  rs.getRow(4).height = 18;
  rs.getRow(5).height = 10;
  const t = span(2, R0, R1);
  t.value = "Diagnóstico tributário da base de CNPJs";
  t.font = { name: FONT, size: 20, bold: true, color: { argb: "FFFFFFFF" } };
  t.alignment = { vertical: "middle" };
  const emp = span(3, R0, R1);
  emp.value = meta.empresa ?? "Base de CNPJs";
  emp.font = { name: FONT, size: 12, bold: true, color: { argb: "FFE2E8F0" } };
  const sub = span(4, R0, R1);
  sub.value = [
    `Gerado em ${new Date().toLocaleDateString("pt-BR")}`,
    competencias.length ? `dados da Receita de ${competencias.map(mesAno).join(", ")}` : null,
    meta.filtro !== "Toda a base" ? `recorte: ${meta.filtro}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
  sub.font = { name: FONT, size: 10, color: { argb: "FF94A3B8" } };

  const identificados = count((x) => x.d.status === "identificado");
  const acao = count((x) => x.d.precisaAcao);
  const cpf = count((x) => x.d.status === "provavel_cpf");
  const inexistente = count((x) => x.d.status === "cnpj_nao_encontrado");
  const ressalva = count(
    (x) =>
      x.d.status === "ressalva" && x.r.tax_entities.public_classification === "excluido_simples",
  );
  const ecfAntiga = count(
    (x) =>
      x.d.status === "ressalva" && x.r.tax_entities.public_classification !== "excluido_simples",
  );
  const semFonte = count((x) => x.d.status === "sem_fonte_publica");
  const inativos = count(
    (x) => !!x.r.tax_entities.situacao_cadastral && x.r.tax_entities.situacao_cadastral !== "ATIVA",
  );
  const simplesItems = items.filter(
    (x) => x.r.tax_entities.public_classification === "simples_nacional",
  );
  const simples = simplesItems.length;
  const sOpcao = simplesItems.map((x) => ibsCbsOpcao(x.ibs));
  const sSim = sOpcao.filter((o) => o === "Sim (IBS e CBS)").length;
  const sParcial = sOpcao.filter((o) => o === "Só IBS" || o === "Só CBS").length;
  const sNao = sOpcao.filter((o) => o === "Não").length;
  const sPend = sOpcao.filter((o) => o === "A confirmar").length;
  const sDatas = [
    ...new Set(simplesItems.map((x) => ibsCbsDesde(x.ibs)).filter((v): v is string => !!v)),
  ].sort();

  // Cartões de indicador.
  let line = 7;
  const cards: [string, string, string, string][] = [
    [
      "Documentos analisados",
      nf(total),
      meta.filtro === "Toda a base" ? "base inteira" : meta.filtro,
      C.head,
    ],
    ["Regime identificado", pf(identificados, total), `${nf(identificados)} documentos`, C.okInk],
    ["Pedem ação", nf(acao), "confirmar ou corrigir", C.warnInk],
    ["Cadastro a corrigir", nf(cpf + inexistente), "CPF ou CNPJ inexistente", C.badInk],
  ];
  cards.forEach(([label, valor, hint, ink], i) => {
    const c0 = R0 + i * 2;
    const c1 = c0 + 1;
    for (let r = line; r <= line + 2; r++) paint(r, c0, c1, C.card);
    const l = span(line, c0, c1);
    l.value = label.toUpperCase();
    l.font = { name: FONT, size: 8, bold: true, color: { argb: C.muted } };
    l.alignment = { vertical: "bottom", indent: 1 };
    const v = span(line + 1, c0, c1);
    v.value = valor;
    v.font = { name: FONT, size: 24, bold: true, color: { argb: ink } };
    v.alignment = { vertical: "middle", indent: 1 };
    const h = span(line + 2, c0, c1);
    h.value = hint;
    h.font = { name: FONT, size: 9, color: { argb: C.muted } };
    h.alignment = { vertical: "top", indent: 1 };
    rs.getCell(line, c0).border = { top: { style: "thick", color: { argb: ink } } };
  });
  rs.getRow(line).height = 22;
  rs.getRow(line + 1).height = 36;
  rs.getRow(line + 2).height = 20;
  line += 4;

  const titulo = (txt: string) => {
    line++;
    const c = span(line, R0, R1);
    c.value = txt;
    c.font = { name: FONT, size: 13, bold: true, color: { argb: C.ink } };
    c.border = { bottom: { style: "medium", color: { argb: C.head } } };
    rs.getRow(line).height = 22;
    line += 2;
  };

  // Conclusões.
  titulo("Principais conclusões");
  const regimeAno = [
    ...new Set(
      items
        .map((x) => x.r.tax_entities.public_classification_basis?.["ano_calendario"])
        .filter((v) => v !== undefined && v !== null)
        .map(String),
    ),
  ].sort();
  const conclusoes = [
    `${pf(identificados, total)} da base tem regime identificado em fonte oficial da Receita: Simples e MEI pela opção vigente; Lucro Real e Presumido pela última ECF publicada${regimeAno.length ? ` (ano-calendário ${regimeAno.join(", ")})` : ""}.`,
    simples
      ? `Simples híbrido: dos ${nf(simples)} optantes do Simples, ${nf(sSim + sParcial)} optaram pelo regime regular de IBS/CBS${sDatas.length ? ` (a partir de ${sDatas.map(br).join(", ")})` : ""} e ${nf(sNao)} continuam no Simples puro${sPend ? `; ${nf(sPend)} a confirmar` : ""}.`
      : null,
    ressalva
      ? `${nf(ressalva)} empresas saíram do Simples e ainda não têm ECF posterior à saída: o regime atual precisa ser confirmado com o parceiro.`
      : null,
    ecfAntiga
      ? `${nf(ecfAntiga)} empresas têm só ECF antiga (sem as declarações dos anos mais recentes já publicados): confirmar o regime atual.`
      : null,
    semFonte
      ? `${nf(semFonte)} empresas não têm fonte pública que indique o regime (sem Simples e sem ECF publicada): solicitar ao parceiro.`
      : null,
    cpf
      ? `${nf(cpf)} números são CPF cadastrados como CNPJ (com "000" na frente). Pessoa física não tem regime de empresa: corrigir o cadastro.`
      : null,
    inexistente ? `${nf(inexistente)} CNPJs não existem na Receita: conferir a digitação.` : null,
    inativos
      ? `${nf(inativos)} cadastros estão baixados, inaptos ou suspensos na Receita: avaliar se ainda devem ficar na base.`
      : null,
  ].filter((v): v is string => !!v);
  conclusoes.forEach((txt, i) => {
    const c = span(line, R0, R1);
    c.value = {
      richText: [
        {
          text: `${String(i + 1).padStart(2, "0")}   `,
          font: { name: FONT, size: 10.5, bold: true, color: { argb: C.accent } },
        },
        { text: txt, font: { name: FONT, size: 10.5, color: { argb: C.ink } } },
      ],
    };
    c.alignment = { wrapText: true, vertical: "top", indent: 1 };
    rs.getRow(line).height = altura(txt, CPL - 6, 18) + 4;
    line++;
  });

  /** Tabela leve: cabeçalho claro, linhas só com divisória inferior. */
  type Coluna = { titulo: string; de: number; ate: number; alinhar?: "left" | "right" };
  const tabela = (
    colunas: Coluna[],
    linhas: {
      valores: (string | number)[];
      tom?: [string, string] | null;
      total?: boolean;
      fmt?: (string | undefined)[];
    }[],
  ) => {
    for (const col of colunas) {
      const c = span(line, col.de, col.ate);
      c.value = col.titulo.toUpperCase();
      c.font = { name: FONT, size: 8, bold: true, color: { argb: C.muted } };
      c.alignment = {
        vertical: "middle",
        horizontal: col.alinhar ?? "left",
        indent: col.alinhar === "right" ? 0 : 1,
      };
    }
    for (let c = R0; c <= R1; c++) {
      rs.getCell(line, c).fill = fill(C.card);
      rs.getCell(line, c).border = { bottom: { style: "thin", color: { argb: C.muted } } };
    }
    rs.getRow(line).height = 20;
    line++;
    for (const l of linhas) {
      let maxH = 18;
      colunas.forEach((col, i) => {
        const c = span(line, col.de, col.ate);
        const v = l.valores[i] ?? "";
        c.value = v;
        if (l.fmt?.[i]) c.numFmt = l.fmt[i]!;
        c.font = { name: FONT, size: 10, bold: !!l.total, color: { argb: C.ink } };
        c.alignment = {
          vertical: "middle",
          wrapText: true,
          horizontal: col.alinhar ?? "left",
          indent: col.alinhar === "right" ? 0 : 1,
        };
        if (i === 0 && l.tom) {
          c.font = { name: FONT, size: 10, bold: true, color: { argb: l.tom[1] } };
        }
        if (typeof v === "string")
          maxH = Math.max(maxH, altura(v, Math.round((col.ate - col.de + 1) * RW * 0.95)));
      });
      for (let c = R0; c <= R1; c++) {
        rs.getCell(line, c).border = {
          bottom: { style: l.total ? "medium" : "hair", color: { argb: l.total ? C.ink : C.line } },
        };
        if (l.total)
          rs.getCell(line, c).border = { top: { style: "thin", color: { argb: C.ink } } };
      }
      if (l.tom) rs.getCell(line, R0).fill = fill(l.tom[0]);
      rs.getRow(line).height = maxH;
      line++;
    }
  };
  const barra = (p: number) => "█".repeat(Math.max(p > 0 ? 1 : 0, Math.round(p * 28)));

  // Regime tributário.
  titulo("Regime tributário da base");
  const regimes = new Map<string, number>();
  for (const x of items) {
    const k = foraDaReceita(x.d)
      ? "Não é CNPJ válido na Receita"
      : CLASSIFICATION_LABEL[x.r.tax_entities.public_classification];
    regimes.set(k, (regimes.get(k) ?? 0) + 1);
  }
  const regCols: Coluna[] = [
    { titulo: "Regime", de: R0, ate: R0 + 2 },
    { titulo: "Documentos", de: R0 + 3, ate: R0 + 3, alinhar: "right" },
    { titulo: "% da base", de: R0 + 4, ate: R0 + 4, alinhar: "right" },
    { titulo: "Distribuição", de: R0 + 5, ate: R1 },
  ];
  const regLinhas = [...regimes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({
      valores: [k, n, pct(n, total), barra(pct(n, total))],
      fmt: [undefined, "#,##0", "0.0%"],
    }));
  tabela(regCols, [
    ...regLinhas,
    { valores: ["Total", total, 1, ""], total: true, fmt: [undefined, "#,##0", "0%"] },
  ]);
  // Barras na cor de destaque.
  for (let r = line - regLinhas.length - 1; r < line - 1; r++) {
    rs.getCell(r, R0 + 5).font = { name: FONT, size: 9, color: { argb: C.accent } };
    rs.getCell(r, R0 + 5).alignment = { vertical: "middle", indent: 1 };
  }
  const nota = (txt: string) => {
    const c = span(line, R0, R1);
    c.value = txt;
    c.font = { name: FONT, size: 9, italic: true, color: { argb: C.muted } };
    c.alignment = { wrapText: true, vertical: "top" };
    rs.getRow(line).height = altura(txt, CPL + 10);
    line++;
  };
  line++;
  nota(
    "Lucro Real e Lucro Presumido vêm da última ECF publicada pela Receita (histórico declarado, não o regime vigente). Não optar pelo Simples nunca é tratado como Lucro Real ou Presumido.",
  );

  // Simples híbrido.
  if (simples) {
    titulo("Simples híbrido · opção pelo regime regular de IBS/CBS");
    const sCols: Coluna[] = [
      { titulo: "Situação", de: R0, ate: R0 + 4 },
      { titulo: "Documentos", de: R0 + 5, ate: R0 + 5, alinhar: "right" },
      { titulo: "% do Simples", de: R0 + 6, ate: R0 + 6, alinhar: "right" },
      { titulo: "", de: R0 + 7, ate: R1 },
    ];
    const lin = (label: string, n: number, tom: [string, string] | null) => ({
      valores: [label, n, pct(n, simples), ""],
      tom,
      fmt: [undefined, "#,##0", "0.0%"],
    });
    tabela(sCols, [
      lin(
        `Optaram pelo regime regular de IBS e CBS${sDatas.length ? ` (desde ${sDatas.map(br).join(", ")})` : ""}`,
        sSim,
        [C.ok, C.okInk],
      ),
      ...(sParcial ? [lin("Optaram só por IBS ou só por CBS", sParcial, [C.ok, C.okInk])] : []),
      lin("Não optaram (Simples puro)", sNao, [C.idle, C.ink]),
      ...(sPend ? [lin("A confirmar", sPend, [C.warn, C.warnInk])] : []),
      {
        valores: ["Optantes do Simples", simples, 1, ""],
        total: true,
        fmt: [undefined, "#,##0", "0%"],
      },
    ]);
    line++;
    nota(
      "A opção vale para todos os estabelecimentos da empresa e é renovada a cada janela de opção da Receita.",
    );
  }

  // Status e o que fazer.
  titulo("Status do diagnóstico e o que fazer");
  const porStatus = DIAGNOSIS_ORDER.map((s) => ({
    s,
    n: count((x) => x.d.status === s),
    acao:
      items.find(
        (x) =>
          x.d.status === s &&
          !x.r.tax_entities.situacao_cadastral?.match(/BAIXADA|INAPTA|SUSPENSA|NULA/),
      )?.d.acao ??
      items.find((x) => x.d.status === s)?.d.acao ??
      "",
  })).filter((x) => x.n > 0);
  tabela(
    [
      { titulo: "Status", de: R0, ate: R0 + 1 },
      { titulo: "Documentos", de: R0 + 2, ate: R0 + 2, alinhar: "right" },
      { titulo: "% da base", de: R0 + 3, ate: R0 + 3, alinhar: "right" },
      { titulo: "O que fazer", de: R0 + 4, ate: R1 },
    ],
    [
      ...porStatus.map((x) => ({
        valores: [DIAGNOSIS_LABEL[x.s], x.n, pct(x.n, total), x.acao || "Nenhuma ação."],
        tom: TONE[x.s],
        fmt: [undefined, "#,##0", "0.0%"],
      })),
      { valores: ["Total", total, 1, ""], total: true, fmt: [undefined, "#,##0", "0%"] },
    ],
  );
  line += 2;
  const fim = span(line, R0, R1);
  fim.value =
    'Todos os documentos, com o cadastro, o regime, o diagnóstico e as colunas para a sua resposta, estão na aba "Saneamento". As linhas que pedem ação vêm primeiro, por prioridade.';
  fim.font = { name: FONT, size: 10, color: { argb: C.ink } };
  fim.alignment = { wrapText: true, vertical: "middle", indent: 1 };
  paint(line, R0, R1, C.warn);
  rs.getRow(line).height = 34;
  line += 2;
  nota(
    "Fontes: dados abertos oficiais da Receita Federal (cadastro de CNPJ, Simples Nacional e SIMEI, ECF) e a Consulta Optantes do Portal do Simples para a opção de IBS/CBS.",
  );
  rs.pageSetup.printArea = `A1:${String.fromCharCode(64 + R1 + 1)}${line}`;
}

// ------------------------------------------------------------------ Saneamento
function saneamento(sn: Worksheet, items: Item[]) {
  const PRI = { Alta: 0, Média: 1, Baixa: 2, "—": 3 } as const;
  const fila = [...items].sort(
    (a, b) =>
      Number(b.d.precisaAcao) - Number(a.d.precisaAcao) ||
      PRI[a.d.prioridade] - PRI[b.d.prioridade] ||
      DIAGNOSIS_ORDER.indexOf(a.d.status) - DIAGNOSIS_ORDER.indexOf(b.d.status) ||
      a.r.cnpj.localeCompare(b.r.cnpj),
  );
  const n = SANEAMENTO_COLUMNS.length;
  const INPUT_HEAD = "FFB45309";

  // Linha 1: grupos de colunas.
  const grupos: { nome: string; de: number; ate: number }[] = [];
  SANEAMENTO_COLUMNS.forEach(([, , g], i) => {
    const last = grupos.at(-1);
    if (last && last.nome === g) last.ate = i + 1;
    else grupos.push({ nome: g, de: i + 1, ate: i + 1 });
  });
  for (const g of grupos) {
    if (g.ate > g.de) sn.mergeCells(1, g.de, 1, g.ate);
    const c = sn.getCell(1, g.de);
    c.value = g.nome.toUpperCase();
    const input = g.de >= INPUT_FROM;
    for (let col = g.de; col <= g.ate; col++) {
      const x = sn.getCell(1, col);
      x.fill = fill(input ? "FF92400E" : C.ink);
      x.border = { left: { style: "thin", color: { argb: "FFFFFFFF" } } };
    }
    c.font = { name: FONT, size: 8, bold: true, color: { argb: "FFFFFFFF" } };
    c.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  }
  sn.getRow(1).height = 18;

  // Linha 2: títulos.
  const h = sn.getRow(2);
  h.values = SANEAMENTO_COLUMNS.map((c) => c[0]);
  h.height = 32;
  for (let i = 1; i <= n; i++) {
    const c = h.getCell(i);
    c.fill = fill(i >= INPUT_FROM ? INPUT_HEAD : C.head);
    c.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    c.alignment = { vertical: "middle", wrapText: true, indent: 1 };
    c.border = border;
  }
  SANEAMENTO_COLUMNS.forEach(([, w], i) => (sn.getColumn(i + 1).width = w));

  const cStatus = COL("Status");
  const cPri = COL("Prioridade");
  const cIbs = COL("Regime regular IBS/CBS");
  const cRegime = COL("Regime atual informado");
  fila.forEach((x, i) => {
    const row = sn.addRow(toSaneamentoRow(x.r, x.d, x.ibs, x.rel));
    row.eachCell({ includeEmpty: true }, (c, col) => {
      if (col > n) return;
      c.font = { name: FONT, size: 10, color: { argb: C.ink } };
      c.alignment = { vertical: "top", wrapText: col > 2 };
      c.border = border;
      if (col >= INPUT_FROM) c.fill = fill(C.input);
      else if (i % 2 === 1) c.fill = fill(C.zebra);
    });
    const [bg, ink] = TONE[x.d.status];
    const st = row.getCell(cStatus);
    st.fill = fill(bg);
    st.font = { name: FONT, size: 10, bold: true, color: { argb: ink } };
    const pr = row.getCell(cPri);
    if (x.d.prioridade === "Alta")
      pr.font = { name: FONT, size: 10, bold: true, color: { argb: C.badInk } };
    if (x.d.prioridade === "Média")
      pr.font = { name: FONT, size: 10, bold: true, color: { argb: C.warnInk } };
    const ib = row.getCell(cIbs);
    if (ib.value === "Sim (IBS e CBS)" || ib.value === "Só IBS" || ib.value === "Só CBS")
      ib.font = { name: FONT, size: 10, bold: true, color: { argb: C.okInk } };
    if (ib.value === "A confirmar")
      ib.font = { name: FONT, size: 10, bold: true, color: { argb: C.warnInk } };
    row.getCell(cRegime).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [
        '"Simples Nacional,Simples com IBS/CBS no regime regular,MEI (SIMEI),Lucro Presumido,Lucro Real,Imune ou isenta,Pessoa física,Cadastro inativo"',
      ],
    };
  });
  for (const t of DATE_COLS) sn.getColumn(COL(t)).numFmt = "dd/mm/yyyy";
  sn.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: n } };
  if (!fila.length) sn.addRow(["Nenhum documento neste recorte."]);
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
