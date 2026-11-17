/**
 * Leitura da base de clientes e fornecedores (XLSX e CSV).
 *
 * - XLSX: exceljs (MIT). Antes, o diretório do ZIP passa por inspectZip
 *   (limites de tamanho e zip-bomb).
 * - CSV: papaparse (MIT), com detecção de delimitador e de codificação
 *   (UTF-8; se não for UTF-8 válido, Windows-1252/Latin-1).
 * - CNPJ é sempre tratado como TEXTO. Célula numérica (Excel apaga os zeros à
 *   esquerda) vira o texto do inteiro, e a normalização da importação decide
 *   se completa zeros — e registra que completou.
 *
 * O resultado é só texto: a validação de verdade acontece de novo no banco.
 */
import { FileRejected, inspectZip, LIMITS } from "./zip-guard";

export type RawRow = {
  /** Posição na base, começando em 1 (linhas totalmente vazias são ignoradas). */
  r: number;
  /** Linha na planilha original, para o usuário achar o registro. */
  line: number;
  cnpj: string | null;
  razao: string | null;
  fantasia: string | null;
  rel: string | null;
};

export type ColumnKey = "cnpj" | "razao" | "fantasia" | "rel";

export type ReadResult = {
  kind: "xlsx" | "csv";
  sheetName: string | null;
  headerLine: number;
  columns: Partial<Record<ColumnKey, string>>;
  rows: RawRow[];
  encoding?: "utf-8" | "windows-1252";
  delimiter?: string;
};

function normalizeHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .trim();
}

/** Mapeia cabeçalhos para as 4 colunas. CNPJ é obrigatório. */
export function mapHeaders(header: string[]): Partial<Record<ColumnKey, number>> {
  const out: Partial<Record<ColumnKey, number>> = {};
  const norm = header.map((h) => normalizeHeader(h ?? ""));
  const take = (key: ColumnKey, test: (h: string) => boolean) => {
    if (out[key] !== undefined) return;
    const idx = norm.findIndex(
      (h, i) => h.length > 0 && test(h) && !Object.values(out).includes(i),
    );
    if (idx >= 0) out[key] = idx;
  };
  take(
    "cnpj",
    (h) => h === "cnpj" || h.startsWith("cnpj") || h.endsWith("cnpj") || h.includes(" cnpj "),
  );
  take("fantasia", (h) => h.includes("fantasia"));
  take(
    "razao",
    (h) => h.includes("razao") || h === "nome empresarial" || h === "nome" || h === "empresa",
  );
  take(
    "rel",
    (h) =>
      h.includes("relacionamento") ||
      h === "tipo" ||
      h === "cliente/fornecedor" ||
      h === "fornecedor/cliente" ||
      h === "categoria",
  );
  return out;
}

function clip(v: string | null, max: number): string | null {
  if (v === null) return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function buildRows(
  matrix: string[][],
  kind: "xlsx" | "csv",
): Omit<ReadResult, "kind" | "sheetName"> {
  // Cabeçalho: a primeira das 10 primeiras linhas que tenha uma coluna de CNPJ.
  let headerIdx = -1;
  let map: Partial<Record<ColumnKey, number>> = {};
  for (let i = 0; i < Math.min(10, matrix.length); i += 1) {
    const m = mapHeaders(matrix[i] ?? []);
    if (m.cnpj !== undefined) {
      headerIdx = i;
      map = m;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new FileRejected(
      `Não encontramos a coluna de CNPJ nas 10 primeiras linhas do ${kind === "xlsx" ? "XLSX" : "CSV"}.`,
    );
  }
  const header = matrix[headerIdx] ?? [];
  const columns: Partial<Record<ColumnKey, string>> = {};
  (Object.keys(map) as ColumnKey[]).forEach((k) => {
    const idx = map[k];
    if (idx !== undefined) columns[k] = header[idx] ?? "";
  });

  const rows: RawRow[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i += 1) {
    const cells = matrix[i] ?? [];
    if (cells.every((c) => !c || !c.trim())) continue;
    if (rows.length >= LIMITS.maxRows) {
      throw new FileRejected(
        "O arquivo passa de 100.000 linhas. Divida a base em mais de um arquivo.",
      );
    }
    const get = (k: ColumnKey) => {
      const idx = map[k];
      return idx === undefined ? null : (cells[idx] ?? null);
    };
    rows.push({
      r: rows.length + 1,
      line: i + 1,
      cnpj: clip(get("cnpj"), 64),
      razao: clip(get("razao"), 300),
      fantasia: clip(get("fantasia"), 300),
      rel: clip(get("rel"), 60),
    });
  }
  if (rows.length === 0)
    throw new FileRejected("O arquivo não tem linhas de dados depois do cabeçalho.");
  return { headerLine: headerIdx + 1, columns, rows };
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------
type CellValue = unknown;

/** Texto da célula, sem notação científica nem perda de dígitos em inteiros. */
export function cellText(v: CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    return Number.isInteger(v) ? v.toFixed(0) : String(v);
  }
  if (typeof v === "boolean") return v ? "VERDADEIRO" : "FALSO";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o["richText"])) {
      return (o["richText"] as Array<{ text?: string }>).map((p) => p.text ?? "").join("");
    }
    if ("result" in o) return cellText(o["result"]);
    if (typeof o["text"] === "string") return o["text"] as string;
    if ("error" in o) return "";
  }
  return String(v);
}

export async function readXlsx(bytes: Uint8Array): Promise<ReadResult> {
  inspectZip(bytes);
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
  } catch {
    throw new FileRejected(
      "Não foi possível ler o XLSX. Salve de novo no Excel e tente outra vez.",
    );
  }
  const sheet = wb.worksheets.find((ws) => ws.actualRowCount > 0);
  if (!sheet) throw new FileRejected("O XLSX não tem nenhuma aba com dados.");
  if (sheet.rowCount > LIMITS.maxRows + 11) {
    throw new FileRejected(
      "O arquivo passa de 100.000 linhas. Divida a base em mais de um arquivo.",
    );
  }

  const matrix: string[][] = [];
  for (let r = 1; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    const count = Math.min(row.cellCount, 50);
    for (let c = 1; c <= count; c += 1) cells.push(cellText(row.getCell(c).value));
    matrix.push(cells);
  }
  return { kind: "xlsx", sheetName: sheet.name, ...buildRows(matrix, "xlsx") };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
export function decodeText(bytes: Uint8Array): {
  text: string;
  encoding: "utf-8" | "windows-1252";
} {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text: text.replace(/^\uFEFF/, ""), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

export async function readCsv(bytes: Uint8Array): Promise<ReadResult> {
  if (bytes.length > LIMITS.maxFileBytes) throw new FileRejected("Arquivo acima de 30 MB.");
  const { text, encoding } = decodeText(bytes);
  const { default: Papa } = await import("papaparse");
  const parsed = Papa.parse<string[]>(text, {
    delimiter: "",
    delimitersToGuess: [";", ",", "\t", "|"],
    skipEmptyLines: "greedy",
    dynamicTyping: false,
  });
  const fatal = parsed.errors.find((e) => e.type === "Quotes");
  if (fatal)
    throw new FileRejected(`CSV com aspas desbalanceadas perto da linha ${(fatal.row ?? 0) + 1}.`);
  return {
    kind: "csv",
    sheetName: null,
    encoding,
    delimiter: parsed.meta.delimiter,
    ...buildRows(parsed.data, "csv"),
  };
}

export function detectKind(fileName: string, bytes: Uint8Array): "xlsx" | "csv" {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return "csv";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "xlsx";
  throw new FileRejected("Formato não aceito: envie XLSX ou CSV.");
}

export async function readTabular(fileName: string, bytes: Uint8Array): Promise<ReadResult> {
  if (bytes.length === 0) throw new FileRejected("Arquivo vazio.");
  if (bytes.length > LIMITS.maxFileBytes) throw new FileRejected("Arquivo acima de 30 MB.");
  return detectKind(fileName, bytes) === "xlsx" ? readXlsx(bytes) : readCsv(bytes);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
