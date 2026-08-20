import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { getPaddleEnvironment } from "@/lib/paddle";
import { openBillingPortal } from "@/lib/payments.functions";

export type BillingCycle = "month" | "year";

export type CatalogPlan = {
  code: "starter" | "pro" | "scale";
  name: string;
  /** centavos por ciclo */
  price: Record<BillingCycle, number>;
  priceId: Record<BillingCycle, string>;
  resumo: string;
  itens: string[];
};

/** Espelha o catálogo criado no provedor de pagamento (ids humanos). */
export const BILLING_CATALOG: CatalogPlan[] = [
  {
    code: "starter",
    name: "Starter",
    price: { month: 9900, year: 99000 },
    priceId: { month: "starter_monthly", year: "starter_yearly" },
    resumo: "1 empresa · 3 usuários · 500 notas/mês",
    itens: ["Caixa do imposto", "Simulador oficial", "Validador de XML"],
  },
  {
    code: "pro",
    name: "Pro",
    price: { month: 29900, year: 299000 },
    priceId: { month: "pro_monthly", year: "pro_yearly" },
    resumo: "1 empresa · 10 usuários · 5.000 notas/mês",
    itens: ["Tudo do Starter", "Preço de venda", "Apuração completa"],
  },
  {
    code: "scale",
    name: "Scale",
    price: { month: 79900, year: 799000 },
    priceId: { month: "scale_monthly", year: "scale_yearly" },
    resumo: "5 empresas · 30 usuários · 50.000 notas/mês",
    itens: ["Tudo do Pro", "Carteira de parceiros", "Comissionamento"],
  },
];

export type BillingSubscription = {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: string;
  started_at: string;
  ends_at: string | null;
  paddle_subscription_id: string | null;
  paddle_customer_id: string | null;
  paddle_price_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  environment: string;
};

const COLUMNS =
  "id, tenant_id, plan_id, status, started_at, ends_at, paddle_subscription_id, paddle_customer_id, paddle_price_id, current_period_start, current_period_end, cancel_at_period_end, environment";

/**
 * Assinatura vigente do tenant no ambiente atual de pagamento.
 * Teste e produção convivem na mesma tabela — o filtro de ambiente é obrigatório.
 */
export function useBillingSubscription(tenantId: string, pollMs = 0) {
  return useQuery({
    queryKey: ["billing-subscription", tenantId, getPaddleEnvironment()],
    enabled: Boolean(tenantId),
    refetchInterval: pollMs > 0 ? pollMs : false,
    queryFn: async (): Promise<BillingSubscription | null> => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select(COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("environment", getPaddleEnvironment())
        .order("started_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as BillingSubscription | null;
    },
  });
}

/** Quem pode contratar/alterar a assinatura — a regra é do banco. */
export function useCanManageBilling(tenantId: string) {
  return useQuery({
    queryKey: ["can-admin", tenantId],
    enabled: Boolean(tenantId),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("can_admin", { p_tenant: tenantId });
      if (error) throw error;
      return Boolean(data);
    },
  });
}

export function useBillingPortal(tenantId: string) {
  return useMutation({
    mutationFn: async () => {
      const { url } = await openBillingPortal({ data: { tenantId } });
      return url;
    },
    onSuccess: (url) => {
      window.open(url, "_blank", "noopener");
    },
  });
}

export function useRefreshBilling(tenantId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["billing-subscription", tenantId] });
    void queryClient.invalidateQueries({ queryKey: ["subscription", tenantId] });
    void queryClient.invalidateQueries({ queryKey: ["tenant-plan"] });
    void queryClient.invalidateQueries({ queryKey: ["tenant-plans-scope"] });
  };
}

export const BILLING_STATUS: Record<
  string,
  { label: string; tone: "ok" | "warn" | "bad" | "neutral" }
> = {
  active: { label: "Ativa", tone: "ok" },
  trialing: { label: "Em teste", tone: "ok" },
  past_due: { label: "Pagamento pendente", tone: "warn" },
  paused: { label: "Pausada", tone: "warn" },
  canceled: { label: "Cancelada", tone: "bad" },
};

export function cycleLabel(cycle: BillingCycle): string {
  return cycle === "month" ? "por mês" : "por ano";
}

export function priceIdCycle(priceId: string | null): BillingCycle | null {
  if (!priceId) return null;
  if (priceId.endsWith("_yearly")) return "year";
  if (priceId.endsWith("_monthly")) return "month";
  return null;
}

export function planCodeFromPriceId(priceId: string | null): string | null {
  return priceId ? (priceId.split("_")[0] ?? null) : null;
}
