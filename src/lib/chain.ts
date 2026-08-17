import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { RegimeKind, SemaphoreLevel } from "@/components/techiva/badges";

export type PartyRole = "customer" | "supplier";

export type ChainRow = {
  id: string;
  cnpj: string;
  name: string;
  regime: RegimeKind;
  credit_transfer_pct: number;
  share_pct: number;
  total_cents: number;
  credit_lost_cents: number;
  semaphore: SemaphoreLevel;
  suggested_action: string;
};

export type ChainFilters = {
  regime?: RegimeKind | "all";
  semaphore?: SemaphoreLevel | "all";
  min_cents?: number;
};

export function chainKey(tenantId: string, role: PartyRole) {
  return ["chain-map", tenantId, role] as const;
}

/** RPC chain_map — linhas da carteira (clientes ou fornecedores). */
export function useChainMap(tenantId: string, role: PartyRole) {
  return useQuery({
    queryKey: chainKey(tenantId, role),
    queryFn: async (): Promise<ChainRow[]> => {
      const { data, error } = await supabase.rpc("chain_map", {
        p_tenant: tenantId,
        p_role: role,
        p_filters: {},
      });
      if (error) throw error;
      return ((data ?? []) as ChainRow[]).map((r) => ({
        ...r,
        credit_transfer_pct: Number(r.credit_transfer_pct ?? 0),
        share_pct: Number(r.share_pct ?? 0),
        total_cents: Number(r.total_cents ?? 0),
        credit_lost_cents: Number(r.credit_lost_cents ?? 0),
      }));
    },
    staleTime: 60_000,
  });
}

export type CounterpartyInvoice = {
  id: string;
  issued_at: string;
  direction: "in" | "out";
  total_cents: number;
  ibs_cents: number | null;
  cbs_cents: number | null;
  credit_cents: number | null;
  access_key: string | null;
};

export type CounterpartyDetail = {
  party: {
    id: string;
    cnpj: string;
    name: string;
    regime: RegimeKind;
    regime_source: string | null;
    regime_checked_at: string | null;
    credit_transfer_pct: number | null;
    role: string;
  };
  invoices_12m: CounterpartyInvoice[];
  open_alerts: number;
};

/** RPC counterparty_detail — resumo, notas dos últimos 12 meses e alertas abertos. */
export function useCounterpartyDetail(tenantId: string, partyId: string | null) {
  return useQuery({
    queryKey: ["counterparty-detail", tenantId, partyId],
    queryFn: async (): Promise<CounterpartyDetail> => {
      const { data, error } = await supabase.rpc("counterparty_detail", {
        p_tenant: tenantId,
        p_id: partyId as string,
      });
      if (error) throw error;
      return data as unknown as CounterpartyDetail;
    },
    enabled: Boolean(partyId),
  });
}

/** RPC set_regime_manual — sobrescreve o regime com motivo (vai para a auditoria). */
export function useSetRegimeManual(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { partyId: string; regime: RegimeKind; reason: string }) => {
      const { error } = await supabase.rpc("set_regime_manual", {
        p_tenant: tenantId,
        p_party: input.partyId,
        p_regime: input.regime,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chain-map", tenantId] });
      void qc.invalidateQueries({ queryKey: ["counterparty-detail", tenantId] });
    },
  });
}

/** RPC mark_renegotiate — ação em lote: cria alerta info por contraparte. */
export function useMarkRenegotiate(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { partyIds: string[]; note?: string }) => {
      const { data, error } = await supabase.rpc("mark_renegotiate", {
        p_tenant: tenantId,
        p_parties: input.partyIds,
        p_note: input.note ?? undefined,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["alerts", tenantId] });
    },
  });
}

/** Sensibilidade estimada: impacto de exigir crédito integral / trocar fornecedor. */
export function sensitivity(row: ChainRow, role: PartyRole) {
  const pctOfPortfolio = row.share_pct;
  if (role === "customer") {
    const extraCents = row.credit_lost_cents;
    return {
      headline: "Se este cliente exigir crédito integral",
      detail: `você fica ${(pctOfPortfolio * (100 - row.credit_transfer_pct) / 100).toFixed(1).replace(".", ",")}% mais caro na carteira`,
      amountCents: extraCents,
    };
  }
  return {
    headline: "Se trocar este fornecedor por um regular",
    detail: `recupera crédito hoje perdido (${row.share_pct.toFixed(1).replace(".", ",")}% das compras)`,
    amountCents: row.credit_lost_cents,
  };
}
