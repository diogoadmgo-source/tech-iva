/**
 * Processamento da Base de CNPJs pelo app (migration 0251 + Edge Function
 * tax-intel-processar). O botão pede o processamento; o andamento vem de
 * tax_processing_status, que resume a última execução do motor (os arquivos da
 * Receita lidos) e a última solicitação desta empresa.
 */
import { supabase } from "@/integrations/supabase/client";

import { taxRpc } from "./import-client";

export type RunStatus = "iniciada" | "concluida" | "falhou" | "abortada_layout";

export type ProcessingStatus = {
  execucao: {
    id: string;
    status: RunStatus;
    competencia: string;
    datasets: string[];
    iniciada_em: string;
    concluida_em: string | null;
    cnpjs_alvo: number | null;
    erro: string | null;
    arquivos: { total: number; concluidos: number; linhas: number; atual: string | null } | null;
  } | null;
  solicitacao: {
    id: string;
    status: "solicitado" | "enviado" | "falhou";
    solicitada_em: string;
    enviada_em: string | null;
    erro: string | null;
  } | null;
  pode_processar: boolean;
};

export async function loadProcessingStatus(tenantId: string): Promise<ProcessingStatus> {
  const { data, error } = await taxRpc("tax_processing_status", { p_tenant: tenantId });
  if (error) throw new Error(error.message);
  return data as ProcessingStatus;
}

/** Fase que a tela mostra, derivada do banco (não de estado local). */
export type Phase =
  | { kind: "nunca" }
  | { kind: "na_fila"; desde: string }
  | { kind: "rodando"; pct: number; arquivo: string | null; desde: string }
  | { kind: "concluido"; em: string; competencia: string }
  | { kind: "falhou"; em: string; motivo: string };

const FILA_MAX_MS = 15 * 60_000;

export function phaseOf(s: ProcessingStatus | undefined, now = Date.now()): Phase {
  const run = s?.execucao ?? null;
  const req = s?.solicitacao ?? null;
  const runStart = run ? new Date(run.iniciada_em).getTime() : 0;

  if (run?.status === "iniciada") {
    const a = run.arquivos;
    const pct = a && a.total > 0 ? Math.min(99, Math.round((a.concluidos / a.total) * 100)) : 0;
    return { kind: "rodando", pct, arquivo: a?.atual ?? null, desde: run.iniciada_em };
  }
  // Pedido enviado depois da última execução: o GitHub ainda vai começar.
  if (req && req.status !== "falhou") {
    const t = new Date(req.solicitada_em).getTime();
    if (t > runStart && now - t < FILA_MAX_MS) return { kind: "na_fila", desde: req.solicitada_em };
  }
  if (req?.status === "falhou" && new Date(req.solicitada_em).getTime() > runStart) {
    return {
      kind: "falhou",
      em: req.solicitada_em,
      motivo: req.erro ?? "falha ao acionar o motor",
    };
  }
  if (!run) return { kind: "nunca" };
  if (run.status === "concluida") {
    return {
      kind: "concluido",
      em: run.concluida_em ?? run.iniciada_em,
      competencia: run.competencia,
    };
  }
  return {
    kind: "falhou",
    em: run.concluida_em ?? run.iniciada_em,
    motivo:
      run.status === "abortada_layout"
        ? "um arquivo da Receita veio fora do layout esperado"
        : (run.erro ?? "a execução terminou com erro"),
  };
}

export const isActive = (p: Phase) => p.kind === "na_fila" || p.kind === "rodando";

const MOTIVO: Record<string, string> = {
  em_andamento: "Já existe um processamento em andamento. Acompanhe o progresso aqui.",
  ja_solicitado: "Um processamento acabou de ser pedido e vai começar em instantes.",
  base_vazia: "Importe uma base antes de processar.",
  sem_permissao: "Seu perfil não pode iniciar o processamento desta empresa.",
  nao_configurado: "O processamento pelo app ainda não foi ativado. Avise o administrador.",
  github_recusou: "O motor recusou o pedido. Tente de novo em alguns minutos.",
  github_inacessivel: "Não foi possível falar com o motor. Tente de novo em alguns minutos.",
};

export class ProcessingRefused extends Error {
  constructor(
    readonly motivo: string,
    readonly soft: boolean,
  ) {
    super(MOTIVO[motivo] ?? "Não foi possível iniciar o processamento.");
  }
}

/** Pede o processamento. Recusas "normais" (já rodando, já pedido) são `soft`. */
export async function requestProcessing(tenantId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("tax-intel-processar", {
    body: { tenantId },
  });
  if (!error && (data as { ok?: boolean } | null)?.ok) return;
  let body = data as { motivo?: string } | null;
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    body = (await ctx.json().catch(() => null)) as { motivo?: string } | null;
  }
  const motivo = body?.motivo ?? "desconhecido";
  throw new ProcessingRefused(motivo, motivo === "em_andamento" || motivo === "ja_solicitado");
}
