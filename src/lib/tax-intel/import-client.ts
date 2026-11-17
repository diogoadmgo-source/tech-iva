/**
 * Cliente da importação (migration 0241): cria, envia o original ao Storage,
 * manda lotes de 1.000 linhas e finaliza em trechos. Retomável: se a aba
 * fechar, a importação fica "recebendo" ou "finalizando" e `resumeImport`
 * continua de onde parou.
 *
 * As RPCs e tabelas do módulo ainda não estão no types.ts gerado (a migration
 * não foi aplicada); o cast fica isolado neste arquivo.
 */
import { supabase } from "@/integrations/supabase/client";

import { readTabular, sha256Hex, type RawRow } from "./read-file";
import type { RelationshipKind } from "./relationship";

export const BATCH_SIZE = 1000;
export const IMPORT_BUCKET = "tax-imports";

type RpcError = { message: string; code?: string } | null;
type Rpc = (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: RpcError }>;

export const taxRpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const taxFrom = (table: string) => (supabase.from as unknown as (t: string) => any)(table);

export type ImportSummary = {
  import_id: string;
  status: "recebendo" | "finalizando" | "concluida" | "falhou" | "cancelada";
  expected_rows: number;
  received_rows: number;
  valid: number;
  duplicate_in_file: number;
  already_existing: number;
  invalid_cnpj: number;
  missing_cnpj: number;
  invalid_relationship: number;
  padded: number;
  new_relationships: number;
  unique_cnpjs: number;
  unique_roots: number;
  finalized_at: string | null;
};

export type ImportProgress = {
  phase: "criando" | "enviando_arquivo" | "enviando_linhas" | "finalizando" | "concluida";
  sent: number;
  total: number;
};

/** Erros que não adianta repetir (validação, permissão). */
function isFatal(error: RpcError): boolean {
  if (!error) return false;
  return (
    error.code === "22023" ||
    error.code === "42501" ||
    /forbidden|inválid|incomplet/i.test(error.message)
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call<T>(fn: string, args: Record<string, unknown>, attempts = 4): Promise<T> {
  let last: RpcError = null;
  for (let i = 0; i < attempts; i += 1) {
    const { data, error } = await taxRpc(fn, args);
    if (!error) return data as T;
    last = error;
    if (isFatal(error)) break;
    await sleep(500 * 2 ** i + Math.random() * 250);
  }
  throw new Error(last?.message ?? `Falha em ${fn}`);
}

type FinalizeStep = {
  done: false;
  status: "finalizando";
  remaining_rows: number;
  expected_rows: number;
};

/**
 * A finalização processa até 10 mil linhas por chamada (para caber no limite
 * de tempo por comando do banco); repete até o banco responder `done`.
 */
async function finalize(importId: string, total: number, onProgress: (p: ImportProgress) => void) {
  for (let i = 0; i < 100; i += 1) {
    const res = await call<(ImportSummary & { done: true }) | FinalizeStep>("tax_import_finalize", {
      p_import: importId,
    });
    if (res.done) return res as ImportSummary;
    onProgress({ phase: "finalizando", sent: total - res.remaining_rows, total });
  }
  throw new Error("A finalização não terminou. Tente retomar a importação.");
}

function toPayload(rows: RawRow[]) {
  return rows.map((r) => ({
    r: r.r,
    cnpj: r.cnpj,
    razao: r.razao,
    fantasia: r.fantasia,
    rel: r.rel,
  }));
}

async function sendBatches(
  importId: string,
  rows: RawRow[],
  alreadyReceived: number,
  onProgress: (p: ImportProgress) => void,
  signal?: AbortSignal,
) {
  // Cada lote é uma transação no banco; recomeçar no lote do "recebidas" é
  // seguro, e reenviar linhas já recebidas é ignorado (idempotente).
  const start = Math.floor(alreadyReceived / BATCH_SIZE) * BATCH_SIZE;
  let received = alreadyReceived;
  for (let i = start; i < rows.length; i += BATCH_SIZE) {
    if (signal?.aborted) throw new DOMException("Importação pausada", "AbortError");
    const res = await call<{ received_rows: number }>("tax_import_add_items", {
      p_import: importId,
      p_rows: toPayload(rows.slice(i, i + BATCH_SIZE)),
    });
    received = res.received_rows;
    onProgress({ phase: "enviando_linhas", sent: received, total: rows.length });
  }
  return received;
}

async function uploadOriginal(path: string, file: Blob, kind: "xlsx" | "csv") {
  const { error } = await supabase.storage.from(IMPORT_BUCKET).upload(path, file, {
    upsert: false,
    contentType:
      kind === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/csv",
  });
  // Retomada: o original já pode ter subido numa tentativa anterior.
  if (error && !/exists|duplicate/i.test(error.message))
    throw new Error(`Falha ao guardar o arquivo: ${error.message}`);
}

export async function runImport(input: {
  tenantId: string;
  file: File;
  bytes: Uint8Array;
  sha256: string;
  kind: "xlsx" | "csv";
  sheetName: string | null;
  headerLine: number;
  rows: RawRow[];
  defaultRelationship: RelationshipKind | null;
  onProgress: (p: ImportProgress) => void;
  signal?: AbortSignal;
}): Promise<ImportSummary> {
  const { onProgress } = input;
  onProgress({ phase: "criando", sent: 0, total: input.rows.length });
  const created = await call<{ import_id: string; storage_path: string }>(
    "tax_import_create",
    {
      p_tenant: input.tenantId,
      p_file_name: input.file.name,
      p_file_size: input.bytes.length,
      p_file_sha256: input.sha256,
      p_file_kind: input.kind,
      p_sheet_name: input.sheetName,
      p_expected_rows: input.rows.length,
      p_default_relationship: input.defaultRelationship,
      p_first_data_line: input.headerLine + 1,
    },
    1,
  );

  onProgress({ phase: "enviando_arquivo", sent: 0, total: input.rows.length });
  await uploadOriginal(created.storage_path, input.file, input.kind);

  await sendBatches(created.import_id, input.rows, 0, onProgress, input.signal);
  onProgress({ phase: "finalizando", sent: 0, total: input.rows.length });
  const summary = await finalize(created.import_id, input.rows.length, onProgress);
  onProgress({ phase: "concluida", sent: input.rows.length, total: input.rows.length });
  return summary;
}

export type ImportRow = {
  id: string;
  tenant_id: string;
  file_name: string;
  storage_path: string;
  file_sha256: string;
  file_kind: "xlsx" | "csv";
  expected_rows: number;
  received_rows: number;
  first_data_line: number;
  status: ImportSummary["status"];
  valid_count: number;
  duplicate_count: number;
  existing_count: number;
  invalid_cnpj_count: number;
  missing_cnpj_count: number;
  invalid_relationship_count: number;
  padded_count: number;
  new_relationships_count: number;
  unique_cnpjs: number;
  unique_roots: number;
  created_at: string;
  finalized_at: string | null;
};

/**
 * Retoma uma importação "recebendo": baixa o original do Storage, confere o
 * hash (tem de ser o MESMO arquivo), relê e envia só o que falta. Se ela já
 * estava "finalizando", só continua a finalização.
 */
export async function resumeImport(
  imp: ImportRow,
  onProgress: (p: ImportProgress) => void,
  signal?: AbortSignal,
): Promise<ImportSummary> {
  if (imp.status === "finalizando") {
    onProgress({ phase: "finalizando", sent: 0, total: imp.expected_rows });
    const done = await finalize(imp.id, imp.expected_rows, onProgress);
    onProgress({ phase: "concluida", sent: imp.expected_rows, total: imp.expected_rows });
    return done;
  }
  const { data: blob, error } = await supabase.storage
    .from(IMPORT_BUCKET)
    .download(imp.storage_path);
  if (error || !blob) {
    throw new Error(
      "O arquivo original desta importação não foi encontrado. Cancele e importe de novo.",
    );
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if ((await sha256Hex(bytes)) !== imp.file_sha256) {
    throw new Error(
      "O arquivo guardado não confere com o hash registrado. Cancele e importe de novo.",
    );
  }
  const read = await readTabular(imp.file_name, bytes);
  if (read.rows.length !== imp.expected_rows) {
    throw new Error("A releitura do arquivo não bate com o número de linhas registrado.");
  }
  await sendBatches(imp.id, read.rows, imp.received_rows, onProgress, signal);
  onProgress({ phase: "finalizando", sent: 0, total: imp.expected_rows });
  const summary = await finalize(imp.id, imp.expected_rows, onProgress);
  onProgress({ phase: "concluida", sent: imp.expected_rows, total: imp.expected_rows });
  return summary;
}

export async function cancelImport(importId: string) {
  return call<{ status: string }>("tax_import_cancel", { p_import: importId }, 1);
}
