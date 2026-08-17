import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/** Bloco 3.9 — painel da plataforma (versões de regra + operações). */

export type RuleVersion = {
  id: string;
  calc_version: string;
  cclasstrib_version: string;
  valid_from: string;
  notes: string | null;
  is_current: boolean;
  published_at: string | null;
  published_by: string | null;
  published_by_name: string | null;
};

export type ImpactSample = {
  tenant_id: string;
  name: string;
  kind: string;
  tax_out_cents: number;
  projected_cents: number;
  credit_in_cents: number;
  delta_cents: number;
  delta_pct: number;
};

export type ImpactPreview = {
  rule: { id: string; calc_version: string; cclasstrib_version: string; valid_from: string };
  current_rule: { id: string; calc_version: string; valid_from: string } | null;
  iva_rate_current: number;
  iva_rate_new: number;
  tenants_affected: number;
  tax_out_before_cents: number;
  tax_out_after_cents: number;
  delta_cents: number;
  delta_pct: number;
  sample: ImpactSample[];
};

export type DryRunResult = { dry_run: true; impact_preview: ImpactPreview; generated_at: string };
export type PublishResult = {
  dry_run: false;
  rule_version_id: string;
  batch_id: string;
  jobs_enqueued: number;
};

export type ReprocessProgress = {
  total: number;
  queued: number;
  running: number;
  done: number;
  failed: number;
  canceled: number;
  progress_pct: number;
};

export type OpsQueue = {
  kind: string;
  queued: number;
  running: number;
  failed: number;
  done_24h: number;
  oldest_queued_at: string | null;
};

export type OpsFailedJob = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  kind: string;
  error: string | null;
  message: string | null;
  params: Record<string, unknown> | null;
  retry_of: string | null;
  queued_at: string | null;
  finished_at: string | null;
};

export type OpsIntegration = {
  kind: string;
  total: number;
  connected: number;
  pending: number;
  error: number;
  last_sync: string | null;
  last_error: string | null;
};

export type OpsStaleIngest = {
  tenant_id: string;
  name: string;
  cnpj: string | null;
  last_ingest: string | null;
  days_since: number | null;
};

export type OpsOverview = {
  queues: OpsQueue[];
  failed_jobs: OpsFailedJob[];
  integrations_health: OpsIntegration[];
  stale_ingest: OpsStaleIngest[];
  rule_current:
    | {
        id: string;
        calc_version: string;
        cclasstrib_version: string;
        valid_from: string;
        published_at: string | null;
      }
    | null;
  generated_at: string;
};

export function useIsPlatform() {
  return useQuery({
    queryKey: ["is-platform"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_platform");
      if (error) throw error;
      return Boolean(data);
    },
    staleTime: 300_000,
  });
}

export function useRuleVersions() {
  return useQuery({
    queryKey: ["rule-versions"],
    queryFn: async (): Promise<RuleVersion[]> => {
      const { data, error } = await supabase.rpc("rule_versions_list");
      if (error) throw error;
      return (data ?? []) as unknown as RuleVersion[];
    },
  });
}

export function useCreateRuleVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      calcVersion: string;
      cclasstribVersion: string;
      validFrom: string;
      notes?: string;
    }) => {
      const { data, error } = await supabase.rpc("create_rule_version", {
        p_calc_version: input.calcVersion,
        p_cclasstrib_version: input.cclasstribVersion,
        p_valid_from: input.validFrom,
        ...(input.notes ? { p_notes: input.notes } : {}),
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rule-versions"] }),
  });
}

/** Dry-run obrigatório antes de publicar: devolve o impacto simulado. */
export function useRuleDryRun() {
  return useMutation({
    mutationFn: async (id: string): Promise<DryRunResult> => {
      const { data, error } = await supabase.rpc("publish_rule_version", {
        p_id: id,
        p_dry_run: true,
      });
      if (error) throw error;
      return data as unknown as DryRunResult;
    },
  });
}

export function usePublishRuleVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<PublishResult> => {
      const { data, error } = await supabase.rpc("publish_rule_version", {
        p_id: id,
        p_dry_run: false,
      });
      if (error) throw error;
      return data as unknown as PublishResult;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rule-versions"] });
      void queryClient.invalidateQueries({ queryKey: ["ops-overview"] });
    },
  });
}

export function useReprocessProgress(ruleVersionId: string | null) {
  return useQuery({
    queryKey: ["rule-reprocess", ruleVersionId],
    enabled: Boolean(ruleVersionId),
    refetchInterval: 10_000,
    queryFn: async (): Promise<ReprocessProgress> => {
      const { data, error } = await supabase.rpc("rule_reprocess_progress", {
        p_id: ruleVersionId!,
      });
      if (error) throw error;
      return data as unknown as ReprocessProgress;
    },
  });
}

export function useOpsOverview() {
  return useQuery({
    queryKey: ["ops-overview"],
    refetchInterval: 30_000,
    queryFn: async (): Promise<OpsOverview> => {
      const { data, error } = await supabase.rpc("platform_ops_overview");
      if (error) throw error;
      return data as unknown as OpsOverview;
    },
  });
}

export function useRetryJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const { data, error } = await supabase.rpc("retry_job", { p_job: jobId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ops-overview"] }),
  });
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("pt-BR");
}
