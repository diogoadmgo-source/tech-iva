import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type JobStatus = Database["public"]["Enums"]["job_status"];
export type Job = Database["public"]["Tables"]["jobs"]["Row"];

/** Tipos de job aceitos por enqueue_job() — espelha job_kind_allowed(). */
export const JOB_KINDS = [
  "ingest_dfe",
  "classify_chain",
  "compute_taxes",
  "project_cash",
  "price_scenario",
  "regime_sim",
  "bank_sync",
  "ingest_erp",
  "reprocess_rules",
] as const;

export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_KIND_LABELS: Record<JobKind, string> = {
  ingest_dfe: "Importação de documentos fiscais",
  classify_chain: "Classificação da cadeia",
  compute_taxes: "Cálculo de IBS/CBS/IS",
  project_cash: "Projeção de caixa",
  price_scenario: "Cenário de preço",
  regime_sim: "Simulação de regime",
  bank_sync: "Sincronização bancária",
  ingest_erp: "Importação via ERP",
  reprocess_rules: "Reprocessamento de regras",
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  queued: "Na fila",
  running: "Executando",
  done: "Concluído",
  failed: "Falhou",
  canceled: "Cancelado",
};

export function jobKindLabel(kind: string): string {
  return JOB_KIND_LABELS[kind as JobKind] ?? kind;
}

const jobsKey = (tenantId: string) => ["jobs", tenantId] as const;

/** Lista os jobs do tenant e assina alterações em tempo real (postgres_changes). */
export function useJobs(tenantId: string, limit = 20) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: jobsKey(tenantId),
    queryFn: async (): Promise<Job[]> => {
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("queued_at", { ascending: false })
        .order("id", { ascending: true }) // ordenação estável
        .range(0, Math.max(0, limit - 1));
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!tenantId) return;
    // Nome único por instância: dois componentes usando useJobs no mesmo tenant
    // reaproveitariam o mesmo tópico e o .on() cairia depois do subscribe().
    const channel = supabase.channel(
      `jobs:${tenantId}:${Math.random().toString(36).slice(2)}`,
    );
    channel
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "jobs", filter: `tenant_id=eq.${tenantId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: jobsKey(tenantId) });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tenantId, queryClient]);


  return query;
}

export function useActiveJobs(tenantId: string) {
  const { data, ...rest } = useJobs(tenantId);
  const active = (data ?? []).filter((j) => j.status === "queued" || j.status === "running");
  return { jobs: data ?? [], active, ...rest };
}

export function useEnqueueJob(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { kind: JobKind; params?: Record<string, unknown> }) => {
      const { data, error } = await supabase.rpc("enqueue_job", {
        p_tenant: tenantId,
        p_kind: input.kind,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        p_params: (input.params ?? {}) as any,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobsKey(tenantId) });
    },
  });
}

export function useCancelJob(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase.rpc("cancel_job", { p_job: jobId });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobsKey(tenantId) });
    },
  });
}

/** Reenfileira um job que falhou, marcando params.retry_of. */
export function useRetryJob(tenantId: string) {
  const enqueue = useEnqueueJob(tenantId);
  return useMutation({
    mutationFn: async (job: Job) =>
      enqueue.mutateAsync({
        kind: job.kind as JobKind,
        params: { ...((job.params as Record<string, unknown>) ?? {}), retry_of: job.id },
      }),
  });
}
