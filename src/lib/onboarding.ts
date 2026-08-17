import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

/** Integrações usadas pelo onboarding da empresa (documento 03 §3.2). */
export type IntegrationKind = "dfe_auth" | "open_finance";

export type IntegrationRow = {
  id: string;
  kind: string;
  status: string;
  config: Json;
  connected_at: string | null;
  error: string | null;
};

export type RegimeDeclarado = "simples" | "simples_hibrido" | "presumido" | "real" | "mei";

export const REGIME_OPTIONS: Array<{ value: RegimeDeclarado; label: string }> = [
  { value: "simples", label: "Simples Nacional (tradicional)" },
  { value: "simples_hibrido", label: "Simples Nacional (híbrido)" },
  { value: "presumido", label: "Lucro Presumido" },
  { value: "real", label: "Lucro Real" },
  { value: "mei", label: "MEI" },
];

export type OnboardingSettings = {
  regime_declared?: RegimeDeclarado;
  accountant_email?: string | null;
  bank_skipped?: boolean;
  step?: number;
  completed_at?: string | null;
};

export type OnboardingState = {
  tenant: { id: string; name: string; cnpj: string | null; kind: string };
  settings: OnboardingSettings;
  integrations: IntegrationRow[];
  /** Índice do passo sugerido (0..3). */
  suggestedStep: number;
  done: boolean;
};

const key = (tenantId: string) => ["onboarding", tenantId] as const;

export function useOnboarding(tenantId: string) {
  return useQuery({
    queryKey: key(tenantId),
    queryFn: async (): Promise<OnboardingState> => {
      const [{ data: tenant, error: tErr }, { data: integrations, error: iErr }] =
        await Promise.all([
          supabase
            .from("tenants")
            .select("id, name, cnpj, kind, settings")
            .eq("id", tenantId)
            .maybeSingle(),
          supabase
            .from("integrations")
            .select("id, kind, status, config, connected_at, error")
            .eq("tenant_id", tenantId),
        ]);
      if (tErr) throw tErr;
      if (iErr) throw iErr;
      if (!tenant) throw new Error("Empresa não encontrada.");

      const raw = (tenant.settings ?? {}) as Record<string, unknown>;
      const settings = ((raw["onboarding"] as OnboardingSettings) ?? {}) as OnboardingSettings;
      const rows = (integrations ?? []) as IntegrationRow[];

      return {
        tenant: { id: tenant.id, name: tenant.name, cnpj: tenant.cnpj, kind: tenant.kind },
        settings,
        integrations: rows,
        suggestedStep: suggestStep(settings, rows),
        done: Boolean(settings.completed_at),
      };
    },
    enabled: Boolean(tenantId),
  });
}

function suggestStep(settings: OnboardingSettings, rows: IntegrationRow[]): number {
  if (!settings.regime_declared) return 0;
  const dfe = rows.find((r) => r.kind === "dfe_auth");
  if (!dfe || dfe.status === "pending") return 1;
  const bank = rows.find((r) => r.kind === "open_finance");
  if (!bank && !settings.bank_skipped) return 2;
  return 3;
}

/** Progresso agregado do onboarding de uma empresa, para o painel do canal. */
export function onboardingProgress(state: {
  settings: OnboardingSettings;
  integrations: IntegrationRow[];
}): { step: number; label: string } {
  if (state.settings.completed_at) return { step: 4, label: "Concluído" };
  const step = suggestStep(state.settings, state.integrations);
  const labels = ["Empresa", "Autorizar notas", "Conectar banco", "Lendo a operação"];
  return { step, label: labels[step] ?? "Empresa" };
}

export function useOnboardingMutations(tenantId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: key(tenantId) });

  /** Grava o bloco settings.onboarding preservando o restante de settings. */
  const saveSettings = useMutation({
    mutationFn: async (patch: OnboardingSettings) => {
      const { data, error } = await supabase
        .from("tenants")
        .select("settings")
        .eq("id", tenantId)
        .maybeSingle();
      if (error) throw error;
      const current = (data?.settings ?? {}) as Record<string, unknown>;
      const onboarding = { ...((current["onboarding"] as OnboardingSettings) ?? {}), ...patch };
      const { error: upErr } = await supabase
        .from("tenants")
        .update({ settings: { ...current, onboarding } as Json })
        .eq("id", tenantId);
      if (upErr) throw upErr;
    },
    onSuccess: refresh,
  });

  const saveTenantData = useMutation({
    mutationFn: async (input: { name?: string; cnpj?: string | null }) => {
      const { error } = await supabase
        .from("tenants")
        .update({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.cnpj !== undefined ? { cnpj: input.cnpj } : {}),
        })
        .eq("id", tenantId);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  /** Cria/atualiza a integração (dfe_auth ou open_finance). */
  const setIntegration = useMutation({
    mutationFn: async (input: {
      kind: IntegrationKind;
      status: string;
      config?: Record<string, unknown>;
    }) => {
      const { data: existing, error } = await supabase
        .from("integrations")
        .select("id, config")
        .eq("tenant_id", tenantId)
        .eq("kind", input.kind)
        .maybeSingle();
      if (error) throw error;

      const config = {
        ...(((existing?.config ?? {}) as Record<string, unknown>) ?? {}),
        ...(input.config ?? {}),
      } as Json;
      const connected_at = input.status === "connected" ? new Date().toISOString() : null;

      if (existing) {
        const { error: upErr } = await supabase
          .from("integrations")
          .update({ status: input.status, config, connected_at, error: null })
          .eq("id", existing.id);
        if (upErr) throw upErr;
        return existing.id;
      }
      const { data: inserted, error: insErr } = await supabase
        .from("integrations")
        .insert({ tenant_id: tenantId, kind: input.kind, status: input.status, config, connected_at })
        .select("id")
        .single();
      if (insErr) throw insErr;
      return inserted.id;
    },
    onSuccess: refresh,
  });

  return { saveSettings, saveTenantData, setIntegration };
}

/** Validação de CNPJ (dígitos verificadores). */
export function isValidCnpj(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;
  const calc = (len: number) => {
    let sum = 0;
    let pos = len - 7;
    for (let i = 0; i < len; i += 1) {
      sum += Number(digits[i]) * pos;
      pos -= 1;
      if (pos < 2) pos = 9;
    }
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  return calc(12) === Number(digits[12]) && calc(13) === Number(digits[13]);
}
