import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { RegimeKind } from "@/components/techiva/badges";

/** RPCs criadas na migration 0018 (ainda não presentes nos tipos gerados). */
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export const FISCAL_YEARS = [2027, 2028, 2029, 2030, 2031, 2032, 2033] as const;

export type ScenarioStatus = "draft" | "approved" | "archived";

export type PriceScenarioRow = {
  id: string;
  name: string;
  target_margin: number;
  fiscal_year: number;
  status: ScenarioStatus;
  created_at: string;
  approved_at: string | null;
  assumptions: Record<string, unknown>;
};

export type PriceLine = {
  id: string;
  product_id: string;
  sku: string | null;
  name: string;
  ncm: string | null;
  cost_cents: number;
  input_credit_cents: number;
  floor_price_cents: number;
  target_price_cents: number;
  current_price_cents: number;
  delta_pct: number | null;
  below_floor: boolean;
  counterparty_id: string | null;
  counterparty_name: string | null;
  memory: Record<string, unknown>;
};

export type PriceTotals = {
  lines: number;
  revenue_current_cents: number;
  revenue_target_cents: number;
  avg_delta_pct: number;
  avg_margin_pct: number;
  below_floor: number;
};

export type PriceScenarioDetail = {
  scenario: PriceScenarioRow & { tenant_id: string; iva_rate: number };
  lines: PriceLine[];
  totals: PriceTotals;
};

export type PriceCustomer = { id: string; name: string; cnpj: string; regime: RegimeKind };

const num = (v: unknown, fb = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};

function normalizeDetail(raw: unknown): PriceScenarioDetail {
  const o = (raw ?? {}) as Record<string, unknown>;
  const s = (o["scenario"] ?? {}) as Record<string, unknown>;
  const t = (o["totals"] ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(o["lines"]) ? (o["lines"] as Record<string, unknown>[]) : [];

  return {
    scenario: {
      id: String(s["id"] ?? ""),
      tenant_id: String(s["tenant_id"] ?? ""),
      name: String(s["name"] ?? ""),
      target_margin: num(s["target_margin"]),
      fiscal_year: num(s["fiscal_year"], 2027),
      status: (s["status"] as ScenarioStatus) ?? "draft",
      created_at: String(s["created_at"] ?? ""),
      approved_at: (s["approved_at"] as string | null) ?? null,
      assumptions: (s["assumptions"] as Record<string, unknown>) ?? {},
      iva_rate: num(s["iva_rate"]),
    },
    lines: lines.map((l) => ({
      id: String(l["id"] ?? ""),
      product_id: String(l["product_id"] ?? ""),
      sku: (l["sku"] as string | null) ?? null,
      name: String(l["name"] ?? ""),
      ncm: (l["ncm"] as string | null) ?? null,
      cost_cents: num(l["cost_cents"]),
      input_credit_cents: num(l["input_credit_cents"]),
      floor_price_cents: num(l["floor_price_cents"]),
      target_price_cents: num(l["target_price_cents"]),
      current_price_cents: num(l["current_price_cents"]),
      delta_pct: l["delta_pct"] === null || l["delta_pct"] === undefined ? null : num(l["delta_pct"]),
      below_floor: Boolean(l["below_floor"]),
      counterparty_id: (l["counterparty_id"] as string | null) ?? null,
      counterparty_name: (l["counterparty_name"] as string | null) ?? null,
      memory: (l["memory"] as Record<string, unknown>) ?? {},
    })),
    totals: {
      lines: num(t["lines"]),
      revenue_current_cents: num(t["revenue_current_cents"]),
      revenue_target_cents: num(t["revenue_target_cents"]),
      avg_delta_pct: num(t["avg_delta_pct"]),
      avg_margin_pct: num(t["avg_margin_pct"]),
      below_floor: num(t["below_floor"]),
    },
  };
}

export function usePriceScenarios(tenantId: string) {
  return useQuery({
    queryKey: ["price-scenarios", tenantId],
    queryFn: async (): Promise<PriceScenarioRow[]> => {
      const { data, error } = await supabase
        .from("price_scenarios")
        .select("id, name, target_margin, fiscal_year, status, created_at, approved_at, assumptions")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        target_margin: num(s.target_margin),
        fiscal_year: num(s.fiscal_year, 2027),
        status: (s.status as ScenarioStatus) ?? "draft",
        created_at: s.created_at ?? "",
        approved_at: s.approved_at ?? null,
        assumptions: (s.assumptions as Record<string, unknown>) ?? {},
      }));
    },
    enabled: Boolean(tenantId),
  });
}

export function usePriceScenarioDetail(scenarioId: string | null) {
  return useQuery({
    queryKey: ["price-scenario", scenarioId],
    queryFn: async (): Promise<PriceScenarioDetail> => {
      const { data, error } = await rpc("price_scenario_detail", { p_scenario: scenarioId });
      if (error) throw new Error(error.message);
      return normalizeDetail(data);
    },
    enabled: Boolean(scenarioId),
  });
}

export function usePriceCustomers(tenantId: string) {
  return useQuery({
    queryKey: ["price-customers", tenantId],
    queryFn: async (): Promise<PriceCustomer[]> => {
      const { data, error } = await supabase
        .from("counterparties")
        .select("id, name, cnpj, regime")
        .eq("tenant_id", tenantId)
        .in("role", ["customer", "both"])
        .order("name")
        .limit(500);
      if (error) throw error;
      return (data ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        cnpj: c.cnpj,
        regime: (c.regime as RegimeKind) ?? "desconhecido",
      }));
    },
    enabled: Boolean(tenantId),
  });
}

export type CreateScenarioInput = {
  name: string;
  targetMargin: number;
  fiscalYear: number;
  counterpartyId?: string | null;
  varExpPct?: number;
};

export function usePricingMutations(tenantId: string) {
  const queryClient = useQueryClient();
  const invalidate = (scenarioId?: string) => {
    void queryClient.invalidateQueries({ queryKey: ["price-scenarios", tenantId] });
    void queryClient.invalidateQueries({ queryKey: ["jobs", tenantId] });
    if (scenarioId) void queryClient.invalidateQueries({ queryKey: ["price-scenario", scenarioId] });
  };

  const createScenario = useMutation({
    mutationFn: async (input: CreateScenarioInput): Promise<string> => {
      const { data, error } = await rpc("price_scenario_create", {
        p_tenant: tenantId,
        p_name: input.name,
        p_target_margin: input.targetMargin,
        p_fiscal_year: input.fiscalYear,
        p_counterparty: input.counterpartyId ?? null,
        p_var_exp_pct: input.varExpPct ?? 0.05,
      });
      if (error) throw new Error(error.message);
      return String(data);
    },
    onSuccess: (id) => invalidate(id),
  });

  const recompute = useMutation({
    mutationFn: async (scenarioId: string) => {
      const { error } = await rpc("price_scenario_compute", { p_scenario: scenarioId });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, scenarioId) => invalidate(scenarioId),
  });

  const approve = useMutation({
    mutationFn: async (scenarioId: string) => {
      const { error } = await rpc("approve_price_scenario", { p_scenario: scenarioId });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, scenarioId) => invalidate(scenarioId),
  });

  const updateProduct = useMutation({
    mutationFn: async (input: {
      productId: string;
      scenarioId: string;
      costCents?: number | null;
      currentPriceCents?: number | null;
    }) => {
      const { error } = await rpc("update_product_price", {
        p_product: input.productId,
        p_cost_cents: input.costCents ?? null,
        p_current_price_cents: input.currentPriceCents ?? null,
      });
      if (error) throw new Error(error.message);
      const { error: cErr } = await rpc("price_scenario_compute", { p_scenario: input.scenarioId });
      if (cErr) throw new Error(cErr.message);
    },
    onSuccess: (_d, input) => invalidate(input.scenarioId),
  });

  return { createScenario, recompute, approve, updateProduct };
}

/** CSV pronto para importação no ERP (ponto-e-vírgula, valores em reais). */
export function scenarioCsv(detail: PriceScenarioDetail): string {
  const head = [
    "sku",
    "produto",
    "ncm",
    "custo",
    "credito_entrada",
    "preco_atual",
    "piso",
    "alvo",
    "delta_pct",
    "abaixo_do_piso",
  ].join(";");
  const money = (c: number) => (c / 100).toFixed(2).replace(".", ",");
  const body = detail.lines
    .map((l) =>
      [
        l.sku ?? "",
        l.name.replace(/;/g, ","),
        l.ncm ?? "",
        money(l.cost_cents),
        money(l.input_credit_cents),
        money(l.current_price_cents),
        money(l.floor_price_cents),
        money(l.target_price_cents),
        l.delta_pct === null ? "" : String(l.delta_pct).replace(".", ","),
        l.below_floor ? "sim" : "nao",
      ].join(";"),
    )
    .join("\n");
  return `${head}\n${body}`;
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([`\ufeff${content}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
