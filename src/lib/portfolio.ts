import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { SemaphoreLevel } from "@/components/techiva/badges";

export type PortfolioRow = {
  tenant_id: string;
  name: string;
  cnpj: string | null;
  plan_code: string | null;
  last_ingest: string | null;
  gap_30_cents: number;
  gap_90_cents: number;
  next_window: string | null;
  open_alerts: number;
};

/** RPC channel_portfolio (documento 02) — carteira do canal com uma linha por empresa. */
export function usePortfolio(tenantId: string) {
  return useQuery({
    queryKey: ["channel-portfolio", tenantId],
    queryFn: async (): Promise<PortfolioRow[]> => {
      const { data, error } = await supabase.rpc("channel_portfolio", { p_tenant: tenantId });
      if (error) throw error;
      return ((data ?? []) as unknown as PortfolioRow[]).map((row) => ({
        ...row,
        gap_30_cents: Number(row.gap_30_cents ?? 0),
        gap_90_cents: Number(row.gap_90_cents ?? 0),
        open_alerts: Number(row.open_alerts ?? 0),
      }));
    },
  });
}

/** Semáforo de saúde da ingestão: > 7 dias sem notas é crítico. */
export function ingestHealth(lastIngest: string | null): SemaphoreLevel {
  if (!lastIngest) return "crit";
  const days = (Date.now() - new Date(lastIngest).getTime()) / 86_400_000;
  if (days > 7) return "crit";
  if (days > 3) return "warn";
  return "ok";
}

export function daysUntil(date: string | null): number | null {
  if (!date) return null;
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
}

/** Urgência da janela de opção de regime: < 60 dias entra no KPI do canal. */
export function windowUrgency(nextWindow: string | null): SemaphoreLevel {
  const days = daysUntil(nextWindow);
  if (days === null) return "ok";
  if (days <= 30) return "crit";
  if (days <= 60) return "warn";
  return "ok";
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

/** Ação em lote: enfileira uma simulação de regime por empresa selecionada. */
export function useBatchRegimeSim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tenantIds: string[]) => {
      const results = await Promise.allSettled(
        tenantIds.map(async (id) => {
          const { error } = await supabase.rpc("enqueue_job", {
            p_tenant: id,
            p_kind: "regime_sim",
            p_params: { source: "channel_batch" },
          });
          if (error) throw error;
        }),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      return { queued: results.length - failed, failed };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
}
