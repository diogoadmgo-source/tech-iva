import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { RegimeKind } from "@/components/techiva/badges";

/** RPCs criadas na migration 0016 (ainda não presentes nos tipos gerados). */
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export type RegimeGroup = { regime: RegimeKind; count: number; volume_cents: number };

export type WalletSummary = {
  revenue_cents: number;
  b2b_cents: number;
  b2c_cents: number;
  b2b_share_pct: number;
  pj_regular_share_pct: number;
  customers_by_regime: RegimeGroup[];
  suppliers_by_regime: RegimeGroup[];
  purchases_cents: number;
  input_credit_cents: number;
  simples_supplier_share_pct: number;
  unknown_regime_count: number;
  next_window: string;
  rule_version_id: string | null;
};

export type RegimeInputs = {
  margin_pct: number;
  b2b_share_pct: number;
  growth_pct: number;
  swap_simples_suppliers: boolean;
  base_year: number;
  revenue_cents?: number;
};

export type RegimeYear = {
  year: number;
  iva_rate_pct: number;
  revenue_cents: number;
  traditional_cents: number;
  hybrid_cents: number;
};

export type RegimeScenario = {
  load_2027_cents: number;
  load_2033_cents: number;
  total_cents: number;
  credit_transferred_cents: number;
  compliance_cost_cents: number;
};

export type RegimeResults = {
  wallet: WalletSummary;
  years: RegimeYear[];
  traditional: RegimeScenario;
  hybrid: RegimeScenario;
  delta_pct: number;
  winner: "hybrid" | "traditional" | "tie";
  b2b_share_pct: number;
  confidence: string;
};

export type RegimeSimulation = {
  id: string;
  tenant_id: string;
  run_at: string;
  inputs: RegimeInputs & Record<string, unknown>;
  results: RegimeResults;
  recommendation: string | null;
  next_window: string | null;
  report_path: string | null;
};

const num = (v: unknown, fb = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};

function normalizeWallet(raw: unknown): WalletSummary {
  const w = (raw ?? {}) as Record<string, unknown>;
  const groups = (v: unknown): RegimeGroup[] =>
    Array.isArray(v)
      ? v.map((g) => {
          const o = g as Record<string, unknown>;
          return {
            regime: (o.regime as RegimeKind) ?? "desconhecido",
            count: num(o.count),
            volume_cents: num(o.volume_cents),
          };
        })
      : [];
  return {
    revenue_cents: num(w.revenue_cents),
    b2b_cents: num(w.b2b_cents),
    b2c_cents: num(w.b2c_cents),
    b2b_share_pct: num(w.b2b_share_pct),
    pj_regular_share_pct: num(w.pj_regular_share_pct),
    customers_by_regime: groups(w.customers_by_regime),
    suppliers_by_regime: groups(w.suppliers_by_regime),
    purchases_cents: num(w.purchases_cents),
    input_credit_cents: num(w.input_credit_cents),
    simples_supplier_share_pct: num(w.simples_supplier_share_pct),
    unknown_regime_count: num(w.unknown_regime_count),
    next_window: typeof w.next_window === "string" ? w.next_window : "",
    rule_version_id: typeof w.rule_version_id === "string" ? w.rule_version_id : null,
  };
}

export function walletKey(tenantId: string) {
  return ["regime-wallet", tenantId] as const;
}

/** Passo 1 do wizard: resumo da carteira + premissas sugeridas. */
export function useWalletSummary(tenantId: string) {
  return useQuery({
    queryKey: walletKey(tenantId),
    queryFn: async (): Promise<WalletSummary> => {
      const { data, error } = await rpc("regime_wallet_summary", { p_tenant: tenantId });
      if (error) throw new Error(error.message);
      return normalizeWallet(data);
    },
    staleTime: 60_000,
  });
}

export function simulationsKey(tenantId: string) {
  return ["regime-simulations", tenantId] as const;
}

/** Histórico de simulações do tenant (mais recente primeiro). */
export function useSimulations(tenantId: string, limit = 20) {
  return useQuery({
    queryKey: simulationsKey(tenantId),
    queryFn: async (): Promise<RegimeSimulation[]> => {
      const { data, error } = await supabase
        .from("regime_simulations")
        .select("id, tenant_id, run_at, inputs, results, recommendation, next_window, report_path")
        .eq("tenant_id", tenantId)
        .order("run_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as RegimeSimulation[];
    },
    staleTime: 30_000,
  });
}

/** Passo 3: roda a simulação (RPC run_regime_simulation) e devolve o id gravado. */
export function useRunSimulation(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (inputs: RegimeInputs): Promise<string> => {
      const { data, error } = await rpc("run_regime_simulation", {
        p_tenant: tenantId,
        p_inputs: inputs,
      });
      if (error) throw new Error(error.message);
      return String(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: simulationsKey(tenantId) });
      void queryClient.invalidateQueries({ queryKey: ["jobs", tenantId] });
    },
  });
}

/** Compartilha a simulação com o canal (tenant pai) via alerta. */
export function useShareSimulation(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note?: string }) => {
      const { error } = await rpc("share_regime_simulation", {
        p_simulation: id,
        p_note: note ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["alerts", tenantId] });
    },
  });
}

/** Contador regressivo até a próxima janela de opção de regime. */
export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  const diff = Math.ceil(
    (target.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000,
  );
  return diff;
}

/** Diff de premissas entre duas simulações (histórico). */
export function inputsDiff(
  current: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
): { key: string; from: unknown; to: unknown }[] {
  if (!previous) return [];
  const keys = new Set([...Object.keys(current), ...Object.keys(previous)]);
  const out: { key: string; from: unknown; to: unknown }[] = [];
  for (const k of keys) {
    if (JSON.stringify(current[k]) !== JSON.stringify(previous[k])) {
      out.push({ key: k, from: previous[k], to: current[k] });
    }
  }
  return out;
}

export const INPUT_LABELS: Record<string, string> = {
  margin_pct: "Margem (%)",
  b2b_share_pct: "Mix B2B (%)",
  growth_pct: "Crescimento (%)",
  swap_simples_suppliers: "Trocar fornecedores do Simples",
  base_year: "Ano-base",
  revenue_cents: "Receita 12m",
};
