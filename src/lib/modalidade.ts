import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/**
 * Modalidade de recolhimento — premissa explícita da projeção de caixa.
 *
 * FATO (CGIBS, 12/08/2026): o split payment NÃO começa em janeiro de 2027. O padrão
 * de 2027 é a APURAÇÃO MENSAL (imposto sai no dia 20 do mês seguinte). RAD e split
 * são modalidades OPCIONAIS — o split ainda sem data. Por isso a empresa escolhe a
 * modalidade e compara o efeito no caixa antes de decidir.
 */

export type Modalidade = "apuracao" | "rad" | "split";

export const MODALIDADES: { value: Modalidade; label: string; short: string }[] = [
  { value: "apuracao", label: "Apuração mensal (padrão em 2027)", short: "Apuração mensal" },
  { value: "rad", label: "Recolhimento pelo Adquirente (opcional)", short: "RAD" },
  { value: "split", label: "Split Payment (sem data definida)", short: "Split" },
];

export function modalidadeLabel(value: string | null | undefined) {
  return MODALIDADES.find((m) => m.value === value)?.short ?? "Apuração mensal";
}

const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

/** RPC tenant_modalidade — modalidade vigente do tenant (padrão 'apuracao'). */
export function useModalidade(tenantId: string) {
  return useQuery({
    queryKey: ["modalidade", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<Modalidade> => {
      const { data, error } = await rpc("tenant_modalidade", { p_tenant: tenantId });
      if (error) throw new Error(error.message);
      return ((data as Modalidade) ?? "apuracao") as Modalidade;
    },
    staleTime: 60_000,
  });
}

export type CenarioModalidade = {
  modalidade: Modalidade;
  rotulo: string;
  gap_30_cents: number;
  gap_60_cents: number;
  gap_90_cents: number;
  pior_semana: { semana: string; saldo_cents: number } | null;
};

export type ComparacaoModalidades = {
  atual: Modalidade;
  horizonte_dias: number;
  cenarios: CenarioModalidade[];
  /** Texto com a fonte e a data — vem do banco, não do código. */
  observacao: string;
};

/** RPC comparar_modalidades — os três cenários com gap de 30/60/90 e pior semana. */
export function useCompararModalidades(tenantId: string, horizonDays = 120) {
  return useQuery({
    queryKey: ["comparar-modalidades", tenantId, horizonDays],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<ComparacaoModalidades> => {
      const { data, error } = await rpc("comparar_modalidades", {
        p_tenant: tenantId,
        p_horizon_days: horizonDays,
      });
      if (error) throw new Error(error.message);
      return data as ComparacaoModalidades;
    },
    staleTime: 60_000,
  });
}

/**
 * Troca a modalidade (auditada no banco) e reenfileira project_cash, porque a
 * modalidade muda o RITMO da saída do imposto — a projeção inteira precisa
 * ser refeita.
 */
export function useSetModalidade(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (modalidade: Modalidade) => {
      const { error } = await rpc("set_tenant_modalidade", {
        p_tenant: tenantId,
        p_modalidade: modalidade,
      });
      if (error) throw new Error(error.message);
      const { error: jobError } = await rpc("enqueue_job", {
        p_tenant: tenantId,
        p_kind: "project_cash",
        p_params: { modalidade },
      });
      if (jobError) throw new Error(jobError.message);
      return modalidade;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["modalidade", tenantId] });
      void queryClient.invalidateQueries({ queryKey: ["comparar-modalidades", tenantId] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-cash", tenantId] });
      void queryClient.invalidateQueries({ queryKey: ["jobs", tenantId] });
    },
  });
}
