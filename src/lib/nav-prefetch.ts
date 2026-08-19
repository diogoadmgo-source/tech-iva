import type { QueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/**
 * Pré-carregamento de DADOS por rota (o router já pré-carrega o CHUNK).
 *
 * Sem isto, o clique montava a tela com as consultas frias: aparecia o
 * esqueleto (a "piscada") e só depois o conteúdo. Ao passar o mouse / focar o
 * item do menu, aquecemos a consulta principal da tela; quando a tela monta,
 * o React Query já tem o dado em cache e não há estado de carregamento.
 *
 * Regras:
 * - só a consulta PRINCIPAL de cada tela (nada de aquecer a tela toda);
 * - mesmas chaves e mesmas consultas dos hooks — se divergirem, o cache não é
 *   aproveitado, então qualquer mudança de chave precisa ser espelhada aqui;
 * - falha silenciosa: prefetch é otimização, nunca pode quebrar a navegação.
 */

// As RPCs novas não estão no tipo gerado; o cast fica isolado aqui.
const rpc = (name: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(
    name,
    args,
  );

type Warmer = (qc: QueryClient, tenantId: string) => Promise<unknown>;

const staleTime = 30_000;

const WARMERS: Record<string, Warmer> = {
  "/t/$tenantId/cash": async (qc, t) => {
    await Promise.all([
      qc.prefetchQuery({
        queryKey: ["dashboard-cash", t, 30],
        staleTime,
        queryFn: async () => {
          const { data, error } = await supabase.rpc("dashboard_cash", {
            p_tenant: t,
            p_horizon_days: 30,
          });
          if (error) throw error;
          return data;
        },
      }),
      qc.prefetchQuery({
        queryKey: ["modalidade", t],
        staleTime,
        queryFn: async () => {
          const { data, error } = await rpc("tenant_modalidade", { p_tenant: t });
          if (error) throw new Error(error.message);
          return data ?? "apuracao";
        },
      }),
    ]);
  },

  "/t/$tenantId/apuracao": (qc, t) =>
    qc.prefetchQuery({
      queryKey: ["rtc-quota", t],
      staleTime,
      queryFn: async () => {
        const { data, error } = await rpc("rtc_quota_status", { p_tenant: t });
        if (error) throw new Error(error.message);
        return data;
      },
    }),

  "/t/$tenantId/chain": (qc, t) =>
    qc.prefetchQuery({
      queryKey: ["chain-map", t, "customer"],
      staleTime,
      queryFn: async () => {
        const { data, error } = await supabase.rpc("chain_map", {
          p_tenant: t,
          p_role: "customer",
          p_filters: {},
        });
        if (error) throw error;
        return data ?? [];
      },
    }),

  "/t/$tenantId/regime": (qc, t) =>
    qc.prefetchQuery({
      queryKey: ["regime-wallet", t],
      staleTime,
      queryFn: async () => {
        const { data, error } = await rpc("regime_wallet_summary", { p_tenant: t });
        if (error) throw new Error(error.message);
        return data;
      },
    }),

  "/t/$tenantId/simulador": (qc, t) =>
    qc.prefetchQuery({
      queryKey: ["calc-simulations", t],
      staleTime,
      queryFn: async () => {
        const { data, error } = await supabase
          .from("calc_simulations")
          .select(
            "id, nome, inputs, results, memory, calc_version, share_token, share_expires_at, created_at",
          )
          .eq("tenant_id", t)
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) throw error;
        return data ?? [];
      },
    }),

  "/t/$tenantId/validador": (qc, t) =>
    qc.prefetchQuery({
      queryKey: ["xml-validations", t],
      staleTime,
      queryFn: async () => {
        const { data, error } = await supabase
          .from("xml_validations")
          .select(
            "id, filename, access_key, modelo, valido, inconsistencias, total_itens, calc_version, created_at",
          )
          .eq("tenant_id", t)
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) throw error;
        return data ?? [];
      },
    }),

};

/** Aquece a consulta principal da rota; erros são ignorados de propósito. */
export function prefetchRouteData(qc: QueryClient, to: string | undefined, tenantId: string) {
  if (!to || !tenantId) return;
  const warm = WARMERS[to];
  if (!warm) return;
  void warm(qc, tenantId).catch(() => undefined);
}
