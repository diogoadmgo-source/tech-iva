import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import { rtcCalculate, rtcEngineStatus, rtcValidate } from "@/lib/rtc-calc.functions";

/**
 * Simulador (calculadora oficial) e validador de XML — funcionalidade de
 * entrada, utilizável antes de conectar as notas.
 *
 * Nenhum número desta camada é calculado no front: tudo vem do componente
 * oficial da Receita via server function. Motor fora do ar => estado explícito.
 */

const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

const from = supabase.from.bind(supabase) as unknown as (table: string) => any;

/* ------------------------------------------------------- copy de produto */

/** As três frases vêm do manual da RFB e são o diferencial contra quem reimplementa regra. */
export const MOTOR_OFICIAL = [
  "Cálculo pelo motor oficial da Receita Federal, com memória de cálculo e base legal.",
  "Seus dados não saem da nossa infraestrutura: a calculadora roda localmente, sem telemetria.",
  "As regras se atualizam automaticamente quando a Receita publica alteração.",
] as const;

export const VALIDADOR_PITCH =
  "Não é validar uma nota: é descobrir que você erra a mesma coisa dezenas de vezes por mês e corrigir a parametrização do emissor.";

/* ----------------------------------------------------------- tipos motor */

export type Tribute = {
  valor_cents: number;
  aliquota_pct: number | null;
  reducao_pct: number | null;
};

export type CalcStepOut = {
  passo: string;
  descricao?: string;
  valor_cents?: number;
  aliquota_pct?: number;
  reducao_pct?: number;
  base_legal?: string;
};

export type CalcResult = {
  source: "official" | "dev-stub";
  calc_version: string | null;
  base_cents: number;
  cbs: Tribute;
  ibs_estadual: Tribute;
  ibs_municipal: Tribute;
  imposto_seletivo: Tribute;
  tributo_total_cents: number;
  total_operacao_cents: number;
  memory: { versao?: string | null; passos: CalcStepOut[]; base_legal?: string | null };
};

export type EngineStatus = {
  available: boolean;
  configured: boolean;
  reason: "not_configured" | "unreachable" | "error" | null;
  dev_stub: boolean;
  calc_version: string | null;
  checked_at: string;
};

export type SimulatorInputs = {
  cst: string;
  cclasstrib: string;
  ncm?: string;
  nbs?: string;
  base_cents: number;
  uf_origem: string;
  uf_destino: string;
  municipio_destino?: string;
  data_fato_gerador: string;
  descricao?: string;
};

/** Mensagem única para o estado "motor indisponível". */
export function engineUnavailableMessage(reason: EngineStatus["reason"]): string {
  switch (reason) {
    case "not_configured":
      return "Calculadora não disponível — o componente oficial ainda não foi configurado neste ambiente. Fale com o administrador.";
    case "unreachable":
      return "Calculadora não disponível — o componente oficial não está respondendo. Fale com o administrador.";
    default:
      return "Calculadora não disponível — o componente oficial devolveu erro. Fale com o administrador.";
  }
}

/* ------------------------------------------------------------- calculadora */

export function useEngineStatus() {
  const status = useServerFn(rtcEngineStatus);
  return useQuery({
    queryKey: ["rtc-engine-status"],
    queryFn: async (): Promise<EngineStatus> => (await status()) as EngineStatus,
    staleTime: 60_000,
    retry: false,
  });
}

export type CalcOutcome =
  | { available: true; result: CalcResult }
  | { available: false; reason: EngineStatus["reason"]; message: string };

export function useCalculate(tenantId: string) {
  const calc = useServerFn(rtcCalculate);
  return useMutation({
    mutationFn: async (inputs: SimulatorInputs): Promise<CalcOutcome> =>
      (await calc({ data: { tenantId, ...inputs } })) as CalcOutcome,
  });
}

/* ------------------------------------------------------------- simulações */

export type SimulationRow = {
  id: string;
  nome: string | null;
  inputs: SimulatorInputs;
  results: CalcResult;
  memory: CalcResult["memory"] | null;
  calc_version: string | null;
  share_token: string | null;
  created_at: string;
};

export function useSimulations(tenantId: string) {
  return useQuery({
    queryKey: ["calc-simulations", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<SimulationRow[]> => {
      const { data, error } = await from("calc_simulations")
        .select("id, nome, inputs, results, memory, calc_version, share_token, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as SimulationRow[];
    },
  });
}

export function useSaveSimulation(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      nome: string;
      inputs: SimulatorInputs;
      result: CalcResult;
    }): Promise<string> => {
      const { data, error } = await rpc("save_simulation", {
        p_tenant: tenantId,
        p_nome: payload.nome,
        p_inputs: payload.inputs,
        p_results: payload.result,
        p_memory: payload.result.memory,
        p_calc_version: payload.result.calc_version,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["calc-simulations", tenantId] });
    },
  });
}

export function useShareSimulation(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<string> => {
      const { data, error } = await rpc("share_simulation", { p_id: id });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["calc-simulations", tenantId] });
    },
  });
}

/* -------------------------------------------------------------- validador */

export type ValidationSummary = {
  periodo_dias: number;
  total: number;
  validos: number;
  invalidos: number;
  taxa_erro: number;
  ultima: string | null;
};

export function useValidationSummary(tenantId: string, dias = 30) {
  return useQuery({
    queryKey: ["validation-summary", tenantId, dias],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<ValidationSummary> => {
      const { data, error } = await rpc("validation_summary", {
        p_tenant: tenantId,
        p_dias: dias,
      });
      if (error) throw new Error(error.message);
      return data as ValidationSummary;
    },
  });
}

export type TopIssue = {
  codigo: string;
  descricao: string | null;
  ocorrencias: number;
  documentos: number;
  ultimo: string;
};

export function useValidationTopIssues(tenantId: string, dias = 30) {
  return useQuery({
    queryKey: ["validation-top-issues", tenantId, dias],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<TopIssue[]> => {
      const { data, error } = await rpc("validation_top_issues", {
        p_tenant: tenantId,
        p_dias: dias,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as TopIssue[];
    },
  });
}

export type XmlIssue = {
  codigo: string;
  descricao: string | null;
  item: number | null;
  cst: string | null;
  cclasstrib: string | null;
  severidade: string | null;
};

export type XmlValidationRow = {
  id: string;
  filename: string | null;
  access_key: string | null;
  modelo: string | null;
  valido: boolean;
  inconsistencias: XmlIssue[];
  total_itens: number | null;
  calc_version: string | null;
  created_at: string;
};

export function useXmlValidations(tenantId: string) {
  return useQuery({
    queryKey: ["xml-validations", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<XmlValidationRow[]> => {
      const { data, error } = await from("xml_validations")
        .select(
          "id, filename, access_key, modelo, valido, inconsistencias, total_itens, calc_version, created_at",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as XmlValidationRow[];
    },
  });
}

export type ValidateOutcome =
  | {
      available: true;
      results: Array<
        | {
            filename: string;
            ok: true;
            id: string | null;
            validation: {
              source: "official" | "dev-stub";
              valido: boolean;
              filename: string;
              access_key: string | null;
              modelo: string | null;
              total_itens: number | null;
              inconsistencias: XmlIssue[];
              calc_version: string | null;
            };
          }
        | { filename: string; ok: false; message: string }
      >;
    }
  | { available: false; reason: EngineStatus["reason"]; message: string };

export function useValidateXml(tenantId: string) {
  const validate = useServerFn(rtcValidate);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (files: Array<{ filename: string; xml: string }>): Promise<ValidateOutcome> =>
      (await validate({ data: { tenantId, files } })) as ValidateOutcome,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["validation-summary", tenantId] });
      void queryClient.invalidateQueries({ queryKey: ["validation-top-issues", tenantId] });
      void queryClient.invalidateQueries({ queryKey: ["xml-validations", tenantId] });
      void queryClient.invalidateQueries({ queryKey: ["alerts", tenantId] });
    },
  });
}

/* ------------------------------------------------------------ utilidades */

export const UF_LIST = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR",
  "RJ","RN","RO","RR","RS","SC","SE","SP","TO",
] as const;

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "1.234,56" | "1234.56" -> centavos. Entrada do usuário, não cálculo fiscal. */
export function parseMoneyToCents(input: string): number {
  const clean = input.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const value = Number(clean);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

export function shareUrl(token: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/s/${token}`;
}
