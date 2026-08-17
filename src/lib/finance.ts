import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/** RPCs criadas na migration 0019 (ainda não presentes nos tipos gerados). */
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export type OfferKind = "credit_advance" | "gap_line" | "provision_account";

export type CreditOffer = {
  id: string;
  kind: OfferKind;
  label: string;
  amount_cents: number;
  net_amount_cents: number;
  term_months: number;
  monthly_rate_pct: number;
  total_cost_cents: number;
  cet_pct: number;
  discount_pct: number;
  reference_date: string | null;
  status: string;
  expires_at: string;
  memory: Record<string, unknown>;
};

export type OfferSchedule = { installment: number; due_date: string; amount_cents: number };

export type OfferDetail = {
  offer: Omit<CreditOffer, "label" | "discount_pct" | "status" | "expires_at">;
  schedule: OfferSchedule[];
  impact: {
    gap_30_before_cents: number;
    gap_30_after_cents: number;
    gap_90_before_cents: number;
    gap_90_after_cents: number;
  };
};

export type CreditContract = {
  id: string;
  kind: OfferKind;
  status: string;
  principal_cents: number;
  net_disbursed_cents: number;
  total_due_cents: number;
  term_months: number;
  monthly_rate_pct: number;
  cet_pct: number;
  signed_at: string;
  signature_ref: string;
  paid_cents: number;
  next_due: string | null;
};

export type LedgerEntry = {
  id: number;
  entry_date: string;
  kind: "disbursement" | "fee" | "interest" | "repayment";
  amount_cents: number;
  memo: string | null;
};

export type ContractDetail = {
  contract: Omit<CreditContract, "paid_cents" | "next_due">;
  repayments: Array<OfferSchedule & { paid_at: string | null }>;
  ledger: LedgerEntry[];
};

export const OFFER_COPY: Record<OfferKind, { title: string; description: string }> = {
  credit_advance: {
    title: "Antecipar crédito acumulado",
    description: "Recebe agora o crédito de IBS/CBS que entraria ao longo dos próximos meses.",
  },
  gap_line: {
    title: "Linha para o descasamento",
    description: "Cobre a semana de maior buraco de caixa e devolve em parcelas mensais.",
  },
  provision_account: {
    title: "Conta de provisão",
    description: "Reserva parte do crédito previsto em conta remunerada até o vencimento do imposto.",
  },
};

export const LEDGER_COPY: Record<LedgerEntry["kind"], string> = {
  disbursement: "Liberação",
  fee: "Deságio",
  interest: "Juros",
  repayment: "Pagamento",
};

export function useCanCredit(tenantId: string) {
  return useQuery({
    queryKey: ["can-credit", tenantId],
    queryFn: async () => {
      const { data, error } = await rpc("can_credit", { p_tenant: tenantId });
      if (error) throw new Error(error.message);
      return Boolean(data);
    },
  });
}

export function useCreditOffers(tenantId: string) {
  return useQuery({
    queryKey: ["credit-offers", tenantId],
    queryFn: async (): Promise<CreditOffer[]> => {
      const { data, error } = await rpc("credit_offers", { p_tenant: tenantId });
      if (error) throw new Error(error.message);
      return (data as CreditOffer[] | null) ?? [];
    },
  });
}

export function useOfferDetail(offerId: string | null) {
  return useQuery({
    queryKey: ["credit-offer-detail", offerId],
    enabled: Boolean(offerId),
    queryFn: async (): Promise<OfferDetail> => {
      const { data, error } = await rpc("credit_offer_detail", { p_offer: offerId });
      if (error) throw new Error(error.message);
      return data as OfferDetail;
    },
  });
}

export function useCreditContracts(tenantId: string) {
  return useQuery({
    queryKey: ["credit-contracts", tenantId],
    queryFn: async (): Promise<CreditContract[]> => {
      const { data, error } = await rpc("credit_contracts", { p_tenant: tenantId });
      if (error) throw new Error(error.message);
      return (data as CreditContract[] | null) ?? [];
    },
  });
}

export function useContractDetail(contractId: string | null) {
  return useQuery({
    queryKey: ["credit-contract-detail", contractId],
    enabled: Boolean(contractId),
    queryFn: async (): Promise<ContractDetail> => {
      const { data, error } = await rpc("credit_contract_detail", { p_contract: contractId });
      if (error) throw new Error(error.message);
      return data as ContractDetail;
    },
  });
}

/** Recalcula as ofertas a partir do caixa projetado (next_gap + backlog de crédito). */
export function useGenerateOffers(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await rpc("credit_generate_offers", { p_tenant: tenantId });
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["credit-offers", tenantId] }),
  });
}

/** Contratação: exige aal2 no banco; erro "MFA required" quando a sessão não subiu para MFA. */
export function useAcceptOffer(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ offerId, signature }: { offerId: string; signature: string }) => {
      const { data, error } = await rpc("accept_credit_offer", {
        p_offer: offerId,
        p_signature_ref: signature,
      });
      if (error) throw new Error(error.message);
      return String(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credit-offers", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["credit-contracts", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["cash", tenantId] });
    },
  });
}

export function isMfaRequired(err: unknown): boolean {
  return err instanceof Error && /MFA required/i.test(err.message);
}
