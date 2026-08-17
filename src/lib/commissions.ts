import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type CommissionLine = {
  tenant_id: string;
  name: string;
  cnpj: string | null;
  plan_code: string | null;
  plan_name: string | null;
  status: string | null;
  started_at: string | null;
  mrr_cents: number;
  commission_cents: number;
  billable: boolean;
};

export type CommissionRule = {
  id?: string;
  mrr_pct: number;
  credit_pct: number;
  note: string | null;
  created_at?: string;
};

export type CommissionStatement = {
  tenant_id: string;
  tenant_kind: string;
  month: string;
  rule: CommissionRule;
  lines: CommissionLine[];
  totals: {
    companies: number;
    billable: number;
    mrr_cents: number;
    commission_cents: number;
  };
};

/** Mês corrente no formato YYYY-MM-01. */
export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Lista os últimos N meses (mais recente primeiro) para o seletor do extrato. */
export function recentMonths(count = 6): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
  }
  return out;
}

export function formatMonth(value: string): string {
  const [y, m] = value.split("-");
  const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** RPC channel_commission_statement — extrato mensal de comissões do canal. */
export function useCommissionStatement(tenantId: string, month: string) {
  return useQuery({
    queryKey: ["commissions", tenantId, month],
    queryFn: async (): Promise<CommissionStatement> => {
      const { data, error } = await supabase.rpc("channel_commission_statement", {
        p_tenant: tenantId,
        p_month: month,
      });
      if (error) throw error;
      const s = data as unknown as CommissionStatement;
      return {
        ...s,
        rule: {
          ...s.rule,
          mrr_pct: Number(s.rule?.mrr_pct ?? 0),
          credit_pct: Number(s.rule?.credit_pct ?? 0),
        },
        lines: (s.lines ?? []).map((l) => ({
          ...l,
          mrr_cents: Number(l.mrr_cents ?? 0),
          commission_cents: Number(l.commission_cents ?? 0),
        })),
        totals: {
          companies: Number(s.totals?.companies ?? 0),
          billable: Number(s.totals?.billable ?? 0),
          mrr_cents: Number(s.totals?.mrr_cents ?? 0),
          commission_cents: Number(s.totals?.commission_cents ?? 0),
        },
      };
    },
  });
}

/** RPC set_commission_rule — apenas plataforma. */
export function useSetCommissionRule(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { mrr_pct: number; credit_pct: number; note?: string }) => {
      const { error } = await supabase.rpc("set_commission_rule", {
        p_tenant: tenantId,
        p_mrr_pct: input.mrr_pct,
        p_credit_pct: input.credit_pct,
        p_note: input.note ?? "",
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["commissions", tenantId] }),
  });
}
