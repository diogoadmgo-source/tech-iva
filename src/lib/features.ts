import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/** RPCs da migration 0050 (ainda não presentes nos tipos gerados). */
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export type FeatureKey = "credit";

/**
 * Estado de um módulo para o tenant ativo. Uma chamada por (tenant, feature),
 * cacheada pelo TanStack Query — a herança pelo ancestral é resolvida no banco.
 */
export function useFeature(tenantId: string, feature: FeatureKey) {
  const query = useQuery({
    queryKey: ["feature", feature, tenantId],
    enabled: Boolean(tenantId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await rpc("feature_enabled", {
        p_tenant: tenantId,
        p_feature: feature,
      });
      if (error) throw new Error(error.message);
      return Boolean(data);
    },
  });

  return {
    ...query,
    /** true só quando o banco confirmou que está habilitado. */
    enabled: query.data === true,
    /** true enquanto não sabemos — trate como desligado na navegação. */
    unknown: query.data === undefined,
  };
}

export type PlatformFeatureRow = {
  tenant_id: string;
  tenant_name: string;
  cnpj: string | null;
  kind: "platform" | "channel" | "company" | "unit";
  enabled: boolean;
  enabled_at: string | null;
  note: string | null;
  enabled_by_label?: string | null;
};

/** Painel da plataforma: estado do módulo por tenant + quem habilitou. */
export function usePlatformFeatures(feature: FeatureKey = "credit", enabled = true) {
  return useQuery({
    queryKey: ["platform-features", feature],
    enabled,
    queryFn: async (): Promise<PlatformFeatureRow[]> => {
      const { data, error } = await rpc("platform_features", { p_feature: feature });
      if (error) throw new Error(error.message);
      const rows = (data as PlatformFeatureRow[] | null) ?? [];

      // quem habilitou não vem da RPC; lemos a tabela (RLS: leitura por in_scope)
      const { data: flags } = await supabase
        .from("tenant_features")
        .select("tenant_id, enabled_by")
        .eq("feature", feature);
      const byTenant = new Map<string, string | null>(
        (flags ?? []).map((f) => [f.tenant_id as string, (f.enabled_by as string | null) ?? null]),
      );
      const userIds = [...new Set([...byTenant.values()].filter(Boolean) as string[])];
      const labels = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", userIds);
        for (const p of profiles ?? []) {
          labels.set(
            p.id as string,
            ((p.full_name as string | null) ?? (p.email as string | null) ?? "") || "—",
          );
        }
      }

      return rows.map((row) => {
        const by = byTenant.get(row.tenant_id) ?? null;
        return { ...row, enabled_by_label: by ? (labels.get(by) ?? "—") : null };
      });
    },
  });
}

export function useSetTenantFeature(feature: FeatureKey = "credit") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { tenantId: string; enabled: boolean; note?: string }) => {
      const { error } = await rpc("set_tenant_feature", {
        p_tenant: input.tenantId,
        p_feature: feature,
        p_enabled: input.enabled,
        p_note: input.note ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["platform-features", feature] });
      void queryClient.invalidateQueries({ queryKey: ["feature", feature] });
      void queryClient.invalidateQueries({ queryKey: ["can-credit"] });
      void queryClient.invalidateQueries({ queryKey: ["features-in-scope", feature] });
    },
  });
}

/**
 * Existe pelo menos um tenant no escopo visível com o módulo habilitado?
 * Usado pelo canal: sem nenhuma empresa habilitada, a comissão sobre crédito
 * é uma promessa que ele não pode cumprir — então não é exibida.
 */
export function useFeatureInScope(feature: FeatureKey = "credit", enabled = true) {
  return useQuery({
    queryKey: ["features-in-scope", feature],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_features")
        .select("tenant_id")
        .eq("feature", feature)
        .eq("enabled", true)
        .limit(1);
      if (error) throw new Error(error.message);
      return (data ?? []).length > 0;
    },
  });
}

export function isFeatureError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /forbidden|feature|modulo|módulo/i.test(message);
}
