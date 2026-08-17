import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export type Plan = {
  id: string;
  code: string;
  name: string;
  price_cents: number;
  limits: Json;
  features: Json;
  active: boolean;
};

export type PlanInput = {
  code: string;
  name: string;
  price_cents: number;
  limits: Json;
  features: Json;
  active: boolean;
};

export type TenantSubscription = {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: string;
  started_at: string;
  ends_at: string | null;
  meta: unknown;
};

export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "canceled"] as const;

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Verdadeiro se o usuário tem membership em algum tenant de plataforma (espelha is_platform()). */
export function useIsPlatform() {
  return useQuery({
    queryKey: ["is-platform"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_platform");
      if (error) throw error;
      return Boolean(data);
    },
  });
}

export function usePlans() {
  return useQuery({
    queryKey: ["plans"],
    queryFn: async (): Promise<Plan[]> => {
      const { data, error } = await supabase
        .from("plans")
        .select("id, code, name, price_cents, limits, features, active")
        .order("price_cents");
      if (error) throw error;
      return (data ?? []) as Plan[];
    },
  });
}

export function usePlanMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["plans"] });

  const create = useMutation({
    mutationFn: async (input: PlanInput) => {
      const { error } = await supabase.from("plans").insert(input);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const update = useMutation({
    mutationFn: async ({ id, ...input }: PlanInput & { id: string }) => {
      const { error } = await supabase.from("plans").update(input).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("plans").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  return { create, update, remove };
}

export function useSubscription(tenantId: string) {
  return useQuery({
    queryKey: ["subscription", tenantId],
    queryFn: async (): Promise<TenantSubscription | null> => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("id, tenant_id, plan_id, status, started_at, ends_at, meta")
        .eq("tenant_id", tenantId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as TenantSubscription | null;
    },
  });
}

/** Troca/cria a assinatura do tenant. A RLS só permite platform_* e channel_admin. */
export function useChangeSubscription(tenantId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      planId,
      status,
      current,
    }: {
      planId: string;
      status: string;
      current: TenantSubscription | null;
    }) => {
      if (current) {
        const { error } = await supabase
          .from("subscriptions")
          .update({ plan_id: planId, status })
          .eq("id", current.id);
        if (error) throw error;
        return;
      }
      const { error } = await supabase
        .from("subscriptions")
        .insert({ tenant_id: tenantId, plan_id: planId, status });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["subscription", tenantId] }),
  });
}
