/**
 * Excel de diagnóstico para o cliente sanear a base. Usa o exceljs que o
 * projeto já tem (import dinâmico, fora do bundle inicial). Só escreve o que
 * veio do banco; o diagnóstico de cada linha vem de diagnose().
 *
 * Abas: Resumo executivo · Base (uma linha por documento, colunas objetivas) ·
 * Saneamento (com colunas para o cliente responder) · Detalhe e evidências ·
 * Metodologia.
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
import { ibsCbsText, raizOf, type ConsultaRegistrada } from "./consulta-optantes";
import { basisText, CLASSIFICATION_LABEL, RELATIONSHIP_LABEL, sourceName } from "./labels";
import type { PortfolioRow } from "./portfolio";

export const EXPORT_COLUMNS = [
  "Documento",
  "Tipo",
  "Razão social",
  "Natureza jurídica",
  "Porte",
  "Matriz/Filial",
  "Data de abertura",
  "CNAE principal",
  "Município/UF",
  "Situação cadastral",
  "Regime identificado",
  "Referência",
  "IBS/CBS regime regular (Simples)",
  "Status",
  "Ação recomendada",
] as const;
const WIDTHS = [21, 7, 40, 30, 16, 12, 12, 44, 24, 14, 22, 16, 30, 30, 46];
/** Coluna do Status na aba Base (1 = A). */
const COL_STATUS = 14;

type Consultas = Map<string, ConsultaRegistrada>;
type Item = { r: PortfolioRow; d: Diagnosis; rel: string; ibs: ConsultaRegistrada | null };

const isoToDate = (v?: string | null) =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00Z`) : null;
const foraDaReceita = (d: Diagnosis) => d.status === "provavel_cpf" || d.status === "cnpj_nao_encontrado";

function referencia(r: PortfolioRow, d: Diagnosis): string | null {
  const b = r.tax_entities.public_classification_basis;
  if (foraDaReceita(d) || d.status === "aguardando") return null;
  if (b?.["ano_calendario"]) return `ECF ${String(b["ano_calendario"])}`;
  if (b?.["competencia"]) return `Receita ${String(b["competencia"])}`;
  return null;
}

function ibsCbsColuna(r: PortfolioRow, d: Diagnosis, c: ConsultaRegistrada | null): string | null {
  if (foraDaReceita(d)) return "—";
  if (d.status === "aguardando") return null;
  const k = r.tax_entities.public_classification;
  if (k === "simples_nacional") return ibsCbsText(c);
  if (k === "mei_simei") return "Não se aplica (MEI)";
  return "Não se aplica (fora do Simples)";
}

export function toExportRow(
  r: PortfolioRow,
  d: Diagnosis = diagnose(r),
  ibs: ConsultaRegistrada | null = null,
): (string | Date | null)[] {
  const e = r.tax_entities;
  const doc = documento(r, d);
  const fora = foraDaReceita(d);
  const local = [e.municipio, e.uf].filter(Boolean).join("/");
  return [
    doc.numero,
    doc.tipo,
    // Fora da Receita, a raiz pode coincidir com outra empresa: não mostra dados dela.
    (fora ? null : e.razao_social) ?? (r.declared_razao_social ? `${r.declared_razao_social} (seu cadastro)` : null),
    fora ? null : naturezaText(e.natureza_juridica, e.natureza_descricao),
    fora || !e.porte ? null : (PORTE_LABEL[e.porte] ?? e.porte),
    fora ? "—" : e.is_matriz ? "Matriz" : "Filial",
    isoToDate(e.data_abertura),
    cnaeText(e.cnae_principal, e.cnae_descricao),
    local || null,
    e.situacao_cadastral ?? (fora ? "Não consta" : null),
    fora ? "—" : CLASSIFICATION_LABEL[e.public_classification],
    referencia(r, d),
    ibsCbsColuna(r, d, ibs),
    DIAGNOSIS_LABEL[d.status],
    d.acao,
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
      c.alignment = { vertical: "top", wrapText: col > 2 };
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
const nf = (v: number) => v.toLocaleString("pt-BR");
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
    const ibs = consultas.get(raizOf(r.cnpj)) ?? null;
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

  // -------------------------------------------------------- Resumo executivo
  const rs = wb.addWorksheet("Resumo executivo", {
    views: [{ showGridLines: false }],
    properties: { tabColor: { argb: C.head } },
  });
  rs.columns = [{ width: 3 }, { width: 30 }, { width: 14 }, { width: 11 }, { width: 70 }];
  rs.getCell("B2").value = "Diagnóstico tributário da base de CNPJs";
  rs.getCell("B2").font = { name: FONT, size: 18, bold: true, color: { argb: C.ink } };
  rs.getCell("B3").value = [
    meta.empresa ?? null,
    `gerado em ${new Date().toLocaleDateString("pt-BR")}`,
    competencias.length ? `dados da Receita de ${competencias.join(", ")}` : null,
    meta.filtro !== "Toda a base" ? `recorte: ${meta.filtro}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  rs.getCell("B3").font = { name: FONT, size: 10, color: { argb: C.muted } };

  const identificados = count((x) => x.d.status === "identificado");
  const acao = count((x) => x.d.precisaAcao);
  const cpf = count((x) => x.d.status === "provavel_cpf");
  const inexistente = count((x) => x.d.status === "cnpj_nao_encontrado");
  const ressalva = count((x) => x.d.status === "ressalva" && x.r.tax_entities.public_classification === "excluido_simples");
  const ecfAntiga = count((x) => x.d.status === "ressalva" && x.r.tax_entities.public_classification !== "excluido_simples");
  const semFonte = count((x) => x.d.status === "sem_fonte_publica");
  const simples = count((x) => x.r.tax_entities.public_classification === "simples_nacional");
  const simplesConsultados = count(
    (x) => x.r.tax_entities.public_classification === "simples_nacional" && !!x.ibs,
  );
  const regular = count(
    (x) => x.r.tax_entities.public_classification === "simples_nacional" && (x.ibs?.ibs === "sim" || x.ibs?.cbs === "sim"),
  );
  const inativos = count(
    (x) => !!x.r.tax_entities.situacao_cadastral && x.r.tax_entities.situacao_cadastral !== "ATIVA",
  );

  // Cartões: número grande + legenda.
  const cards: [string, string, string][] = [
    [nf(total), "documentos analisados", C.ink],
    [pf(identificados, total), `com regime identificado (${nf(identificados)})`, C.okInk],
    [nf(acao), "pedem ação do cliente", C.warnInk],
    [nf(cpf + inexistente), "números a corrigir no cadastro", C.badInk],
  ];
  cards.forEach(([v, l, ink], i) => {
    const row = 5 + i * 2;
    const a = rs.getCell(row, 2);
    a.value = v;
    a.font = { name: FONT, size: 20, bold: true, color: { argb: ink } };
    const b = rs.getCell(row, 3);
    rs.mergeCells(row, 3, row, 5);
    b.value = l;
    b.font = { name: FONT, size: 11, color: { argb: C.muted } };
    b.alignment = { vertical: "middle" };
  });

  let line = 14;
  const titulo = (t: string) => {
    rs.getCell(line, 2).value = t;
    rs.getCell(line, 2).font = { name: FONT, size: 12, bold: true, color: { argb: C.ink } };
    line++;
  };
  titulo("Conclusões");
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
    simples
      ? `Simples híbrido: ${nf(simplesConsultados)} de ${nf(simples)} optantes do Simples consultados na Consulta Optantes${simplesConsultados ? ` (${nf(regular)} no regime regular de IBS ou CBS)` : ""}${simples > simplesConsultados ? `; ${nf(simples - simplesConsultados)} a confirmar no Saneamento` : ""}.`
      : null,
    inativos
      ? `${nf(inativos)} cadastros estão baixados, inaptos ou suspensos na Receita: avaliar se ainda devem ficar na base.`
      : null,
  ].filter((t): t is string => !!t);
  for (const t of conclusoes) {
    rs.mergeCells(line, 2, line, 5);
    const c = rs.getCell(line, 2);
    c.value = `•  ${t}`;
    c.font = { name: FONT, size: 11, color: { argb: C.ink } };
    c.alignment = { wrapText: true, vertical: "top" };
    rs.getRow(line).height = 32;
    line++;
  }
  line++;

  const block = (
    t: string,
    header: string[],
    data: (string | number)[][],
    tones?: ([string, string] | null)[],
  ) => {
    titulo(t);
    header.forEach((h, i) => {
      const c = rs.getCell(line, 2 + i);
      c.value = h;
      c.fill = fill(C.head);
      c.font = { name: FONT, bold: true, size: 10, color: { argb: "FFFFFFFF" } };
      c.border = border;
    });
    line++;
    data.forEach((v, j) => {
      v.forEach((x, i) => {
        const c = rs.getCell(line, 2 + i);
        c.value = x;
        c.border = border;
        c.font = { name: FONT, size: 10, color: { argb: C.ink } };
        c.alignment = { vertical: "top", wrapText: i === 3 };
        if (i === 2 && typeof x === "number") c.numFmt = "0.0%";
        const tone = tones?.[j];
        if (i === 0 && tone) {
          c.fill = fill(tone[0]);
          c.font = { name: FONT, size: 10, bold: true, color: { argb: tone[1] } };
        }
      });
      line++;
    });
    line++;
  };

  const regimes = new Map<string, number>();
  for (const x of items) {
    const k = foraDaReceita(x.d)
      ? "Não é CNPJ válido na Receita"
      : CLASSIFICATION_LABEL[x.r.tax_entities.public_classification];
    regimes.set(k, (regimes.get(k) ?? 0) + 1);
  }
  block(
    "Regime tributário",
    ["Regime", "Documentos", "% da base", "Observação"],
    [...regimes.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => [
        k,
        n,
        pct(n, total),
        k === "Lucro Real" || k === "Lucro Presumido"
          ? "Pela última ECF publicada (histórico declarado, não o regime vigente)."
          : k === "Excluído do Simples"
            ? "Saiu do Simples; regime atual a confirmar."
            : k === "Não é CNPJ válido na Receita"
              ? "Provável CPF ou CNPJ digitado errado."
              : "",
      ]),
  );

  const porStatus = DIAGNOSIS_ORDER.map((s) => ({
    s,
    n: count((x) => x.d.status === s),
    acao: items.find((x) => x.d.status === s && !x.r.tax_entities.situacao_cadastral?.match(/BAIXADA|INAPTA|SUSPENSA|NULA/))?.d.acao ??
      items.find((x) => x.d.status === s)?.d.acao ??
      "",
  })).filter((x) => x.n > 0);
  block(
    "Status do diagnóstico e o que fazer",
    ["Status", "Documentos", "% da base", "O que fazer"],
    [...porStatus.map((x) => [DIAGNOSIS_LABEL[x.s], x.n, pct(x.n, total), x.acao]), ["Total", total, 1, ""]],
    [...porStatus.map((x) => TONE[x.s]), null],
  );
  rs.getCell(line, 2).value =
    'Detalhe por documento na aba "Base". As linhas que pedem ação estão em "Saneamento", com colunas para a sua resposta.';
  rs.getCell(line, 2).font = { name: FONT, size: 10, italic: true, color: { argb: C.muted } };

  // ------------------------------------------------------------------- Base
  const ws = wb.addWorksheet("Base", { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
  table(
    ws,
    [...EXPORT_COLUMNS],
    items.map((x) => toExportRow(x.r, x.d, x.ibs)),
    WIDTHS,
    (i) => (items[i] ? TONE[items[i].d.status] : null),
    COL_STATUS,
  );
  ws.getColumn(7).numFmt = "dd/mm/yyyy";

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
    "Documento",
    "Tipo",
    "Nome no seu cadastro",
    "Prioridade",
    "Status",
    "Motivo",
    "Ação recomendada",
    "Documento correto (preencher)",
    "Regime atual informado (preencher)",
    "Optou pelo regime regular de IBS/CBS? (preencher)",
    "Observação (preencher)",
  ];
  table(
    sn,
    SN_HEAD,
    fila.map(({ r, d }) => {
      const doc = documento(r, d);
      return [
        doc.numero,
        doc.tipo,
        r.declared_razao_social ?? r.tax_entities.razao_social,
        d.prioridade,
        DIAGNOSIS_LABEL[d.status],
        d.causa,
        d.acao,
        null,
        null,
        null,
        null,
      ];
    }),
    [21, 7, 34, 11, 30, 60, 44, 24, 26, 22, 34],
    (i) => (fila[i] ? TONE[fila[i].d.status] : null),
    5,
  );
  styleHeader(sn, 1, SN_HEAD.length);
  for (const col of [8, 9, 10, 11]) {
    sn.getRow(1).getCell(col).fill = fill("FFB45309");
    for (let r = 2; r <= fila.length + 1; r++) sn.getCell(r, col).fill = fill(C.input);
  }
  for (let r = 2; r <= fila.length + 1; r++) {
    sn.getCell(r, 9).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"Simples Nacional,MEI (SIMEI),Lucro Presumido,Lucro Real,Imune ou isenta,Pessoa física,Cadastro inativo"'],
    };
    if (fila[r - 2]?.r.tax_entities.public_classification === "simples_nacional")
      sn.getCell(r, 10).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: ['"Sim (IBS e CBS),Só IBS,Só CBS,Não"'],
      };
  }
  if (!fila.length) sn.addRow(["Nenhuma linha precisa de ação neste recorte."]);

  // ---------------------------------------------------- Detalhe e evidências
  const dt = wb.addWorksheet("Detalhe e evidências", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
  });
  table(
    dt,
    ["Documento", "Nome no seu cadastro", "Relacionamento", "Motivo do diagnóstico", "Alertas do cadastro", "Fonte", "Evidência", "Última consulta"],
    items.map(({ r, d, rel }) => [
      documento(r, d).numero,
      r.declared_razao_social,
      rel,
      d.causa,
      d.alertas.join(" · ") || null,
      r.tax_entities.public_classification_basis?.["fonte"]
        ? sourceName(String(r.tax_entities.public_classification_basis["fonte"]))
        : null,
      basisText(r.tax_entities.public_classification_basis) || null,
      r.tax_entities.last_consulted_at ? new Date(r.tax_entities.last_consulted_at) : null,
    ]),
    [21, 34, 20, 60, 40, 26, 80, 17],
  );
  dt.getColumn(8).numFmt = "dd/mm/yyyy hh:mm";

  // ------------------------------------------------------------ Metodologia
  const mt = wb.addWorksheet("Metodologia", { views: [{ showGridLines: false }] });
  mt.columns = [{ width: 3 }, { width: 34 }, { width: 100 }];
  mt.getCell("B2").value = "Como cada linha foi diagnosticada";
  mt.getCell("B2").font = { name: FONT, size: 14, bold: true, color: { argb: C.ink } };
  const notas: [string, string][] = [
    ["Fontes", "Dados abertos oficiais da Receita Federal: Simples Nacional e SIMEI, cadastro de Empresas e Estabelecimentos (razão social, natureza jurídica, porte, abertura, CNAE, endereço e situação) e regime declarado na ECF. Cruzamento em lote, na competência indicada no Resumo."],
    [DIAGNOSIS_LABEL.identificado, "Optante pelo Simples ou SIMEI na Receita, ou Lucro Real/Presumido declarado na ECF. Real e Presumido vêm sempre com o ano-calendário da ECF: é histórico declarado, não o regime vigente."],
    [DIAGNOSIS_LABEL.ressalva, "Excluído do Simples sem ECF publicada depois da saída. O regime atual precisa ser confirmado."],
    [DIAGNOSIS_LABEL.sem_fonte_publica, "Nunca optou pelo Simples e não há ECF publicada para a empresa (matriz). Não optar pelo Simples nunca é tratado como Lucro Presumido ou Lucro Real."],
    [DIAGNOSIS_LABEL.cnpj_nao_encontrado, "O número não existe no cadastro de CNPJ da Receita."],
    [DIAGNOSIS_LABEL.provavel_cpf, "O número não existe no cadastro de CNPJ e, sem os três zeros iniciais, é um CPF válido (pessoa física). A planilha mostra o número no formato de CPF."],
    [DIAGNOSIS_LABEL.aguardando, "O CNPJ entrou na base depois do último processamento."],
    ["Simples híbrido (IBS/CBS)", "A opção do Simples pelo regime regular de IBS e de CBS não está nos dados abertos da Receita. Só aparece na Consulta Optantes do Portal do Simples, um CNPJ por vez e protegida por captcha. Cada consulta foi feita por uma pessoa da equipe e gravada com a data; a opção vale para todos os estabelecimentos da empresa. Optante do Simples sem consulta registrada fica \"A confirmar\" e vai para o Saneamento."],
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
