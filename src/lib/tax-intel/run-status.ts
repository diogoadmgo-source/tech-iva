import { taxFrom } from "./import-client";

/**
 * Última execução do motor em massa (tax_source_runs + arquivos), lida pelo
 * painel para mostrar o andamento enquanto a carteira é atualizada. As
 * políticas da 0240 só liberam essas tabelas para gestores da plataforma; para
 * os demais a consulta volta vazia e nada é mostrado.
 */
export type RunStatus = "iniciada" | "concluida" | "falhou" | "abortada_layout";

export type LatestRun = {
  id: string;
  competencia: string;
  datasets: string[];
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  targets_count: number | null;
  rows_matched: number | null;
  error: string | null;
  files_total: number;
  files_done: number;
  rows_scanned: number;
};

export async function loadLatestRun(): Promise<LatestRun | null> {
  const { data, error } = await taxFrom("tax_source_runs")
    .select(
      "id, competencia, datasets, status, started_at, finished_at, targets_count, rows_matched, error",
    )
    .eq("dry_run", false)
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const run = (
    data as Omit<LatestRun, "files_total" | "files_done" | "rows_scanned">[] | null
  )?.[0];
  if (!run) return null;
  const files = await taxFrom("tax_source_run_files")
    .select("status, rows_scanned")
    .eq("run_id", run.id);
  if (files.error) throw files.error;
  const list = (files.data ?? []) as { status: string; rows_scanned: number }[];
  return {
    ...run,
    files_total: list.length,
    files_done: list.filter((f) => f.status === "concluido").length,
    rows_scanned: list.reduce((s, f) => s + Number(f.rows_scanned ?? 0), 0),
  };
}

/** Em andamento: o painel atualiza a carteira a cada poucos segundos. */
export const isRunning = (r: LatestRun | null | undefined) => r?.status === "iniciada";
