import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/**
 * Integração RTC (Plataforma CBS — Manual RFB maio/2026).
 *
 * Achado que define a arquitetura: não existe API pública hospedada de cálculo.
 * O cálculo é feito pelo componente offline (Docker/JAR) rodando na NOSSA
 * infraestrutura, sem coleta de dados, telemetria ou transmissão automática.
 * Aqui só tratamos: matriz CST × cClassTrib, apuração assistida e cota da API.
 */

const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

/* ------------------------------------------------------------- apuração */

export type ApuracaoDivergencia =
  | { disponivel: false; nosso_debito_cents: number; mensagem: string }
  | {
      disponivel: true;
      competencia: string;
      receita_debito_cents: number | null;
      nosso_debito_cents: number;
      diferenca_cents: number;
      divergente: boolean;
      recebido_em: string | null;
    };

/** RPC apuracao_divergencia — nosso cálculo vs. apuração da Receita. */
export function useApuracaoDivergencia(tenantId: string, competencia: string) {
  return useQuery({
    queryKey: ["apuracao-divergencia", tenantId, competencia],
    enabled: Boolean(tenantId && competencia),
    queryFn: async (): Promise<ApuracaoDivergencia> => {
      const { data, error } = await rpc("apuracao_divergencia", {
        p_tenant: tenantId,
        p_competencia: competencia,
      });
      if (error) throw new Error(error.message);
      return data as ApuracaoDivergencia;
    },
  });
}

export type RtcQuota = {
  usadas: number;
  limite: number;
  restantes: number;
  pode_manual: boolean;
  downloads_usados: number;
  mensagem: string;
  reinicia_em: string;
};

/** RPC rtc_quota_status — cota do dia, exibida ANTES do clique. */
export function useRtcQuota(tenantId: string) {
  return useQuery({
    queryKey: ["rtc-quota", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<RtcQuota> => {
      const { data, error } = await rpc("rtc_quota_status", { p_tenant: tenantId });
      if (error) throw new Error(error.message);
      return data as RtcQuota;
    },
    staleTime: 30_000,
  });
}

/** Enfileira fetch_apuracao (o worker é desenhado à parte). */
export function useRequestApuracao(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (competencia: string) => {
      const { data, error } = await rpc("enqueue_job", {
        p_tenant: tenantId,
        p_kind: "fetch_apuracao",
        p_params: { competencia },
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rtc-quota", tenantId] });
      void queryClient.invalidateQueries({ queryKey: ["jobs", tenantId] });
    },
  });
}

/** Apurações já recebidas, para o histórico da tela. */
export type ApuracaoRow = {
  id: string;
  competencia: string;
  status: string;
  debitos_cents: number | null;
  creditos_cents: number | null;
  pagamentos_cents: number | null;
  saldo_cents: number | null;
  solicitado_em: string;
  recebido_em: string | null;
  erro: string | null;
};

export function useApuracoes(tenantId: string) {
  return useQuery({
    queryKey: ["rtc-apuracoes", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<ApuracaoRow[]> => {
      const { data, error } = await (supabase.from as unknown as (t: string) => any)("rtc_apuracao")
        .select(
          "id, competencia, status, debitos_cents, creditos_cents, pagamentos_cents, saldo_cents, solicitado_em, recebido_em, erro",
        )
        .eq("tenant_id", tenantId)
        .order("competencia", { ascending: false })
        .limit(24);
      if (error) throw new Error(error.message);
      return (data ?? []) as ApuracaoRow[];
    },
  });
}

/* -------------------------------------------- documentos da competência */

export type InvoiceRow = {
  id: string;
  number: string | null;
  series: string | null;
  issued_at: string;
  total_cents: number;
  ibs_cents: number | null;
  cbs_cents: number | null;
  access_key: string | null;
  counterparty_id: string | null;
};

export function useCompetenciaInvoices(tenantId: string, competencia: string) {
  return useQuery({
    queryKey: ["competencia-invoices", tenantId, competencia],
    enabled: Boolean(tenantId && competencia),
    queryFn: async (): Promise<InvoiceRow[]> => {
      const start = competencia;
      const end = nextMonth(competencia);
      const { data, error } = await supabase
        .from("invoices")
        .select("id, number, series, issued_at, total_cents, ibs_cents, cbs_cents, access_key, counterparty_id")
        .eq("tenant_id", tenantId)
        .eq("direction", "out")
        .gte("issued_at", start)
        .lt("issued_at", end)
        .order("issued_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as InvoiceRow[];
    },
  });
}

export type CalcStep = {
  passo?: string;
  descricao?: string;
  valor_cents?: number;
  aliquota_pct?: number;
  reducao_pct?: number;
  base_legal?: string;
  [key: string]: unknown;
};

export type CalcMemory = {
  versao?: string;
  passos?: CalcStep[];
  base_legal?: string;
  [key: string]: unknown;
};

export type InvoiceItemRow = {
  id: string;
  line: number;
  description: string | null;
  ncm: string | null;
  cst: string | null;
  cclasstrib: string | null;
  qty: number | null;
  unit_price_cents: number | null;
  base_cents: number | null;
  ibs_cents: number | null;
  cbs_cents: number | null;
  is_cents: number | null;
  credit_eligible: boolean | null;
  credit_cents: number | null;
  calc_memory: CalcMemory | null;
  inconsistency: Record<string, unknown> | null;
};

export function useInvoiceItems(invoiceId: string | null) {
  return useQuery({
    queryKey: ["invoice-items", invoiceId],
    enabled: Boolean(invoiceId),
    queryFn: async (): Promise<InvoiceItemRow[]> => {
      const { data, error } = await supabase
        .from("invoice_items")
        .select(
          "id, line, description, ncm, cst, cclasstrib, qty, unit_price_cents, base_cents, ibs_cents, cbs_cents, is_cents, credit_eligible, credit_cents, calc_memory, inconsistency",
        )
        .eq("invoice_id", invoiceId as string)
        .order("line", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as InvoiceItemRow[];
    },
  });
}

/* ------------------------------------------- validação CST × cClassTrib */

export type ClassTribValid = {
  valida: true;
  efeito: string | null;
  reducao_pct: number | null;
  permite_credito: boolean | null;
  base_legal: string | null;
  descricao: string | null;
};

export type ClassTribInvalid = {
  valida: false;
  motivo: string;
  sugestoes: Array<{ cclasstrib: string; descricao: string | null }>;
};

export type ClassTribResult = ClassTribValid | ClassTribInvalid;

/** RPC validate_class_trib — validação inline, com sugestões quando inválida. */
export function useValidateClassTrib(
  cst: string | null | undefined,
  cclasstrib: string | null | undefined,
  data?: string,
) {
  const cstClean = (cst ?? "").trim();
  const ccClean = (cclasstrib ?? "").trim();
  return useQuery({
    queryKey: ["validate-class-trib", cstClean, ccClean, data ?? "hoje"],
    enabled: cstClean.length >= 3 && ccClean.length >= 4,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ClassTribResult> => {
      const args: Record<string, unknown> = { p_cst: cstClean, p_cclasstrib: ccClean };
      if (data) args["p_data"] = data;
      const { data: result, error } = await rpc("validate_class_trib", args);
      if (error) throw new Error(error.message);
      return result as ClassTribResult;
    },
  });
}

export const EFEITO_LABEL: Record<string, string> = {
  tributado: "Tributação integral",
  reduzido: "Alíquota reduzida",
  isento: "Isento",
  imune: "Imune",
  diferido: "Diferimento",
  monofasico: "Monofásico",
  suspenso: "Suspensão",
};

/* ------------------------------------------------------------ utilidades */

/** Primeiro dia do mês, formato ISO (competência). */
export function monthStart(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

export function nextMonth(competencia: string): string {
  const [y, m] = competencia.split("-").map(Number);
  const year = m === 12 ? (y ?? 0) + 1 : (y ?? 0);
  const month = m === 12 ? 1 : (m ?? 1) + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** Últimas N competências, da mais recente para a mais antiga. */
export function lastCompetencias(count = 12): string[] {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => monthStart(new Date(now.getFullYear(), now.getMonth() - i, 1)));
}

export function formatCompetencia(competencia: string): string {
  const [y, m] = competencia.split("-");
  const names = [
    "jan", "fev", "mar", "abr", "mai", "jun",
    "jul", "ago", "set", "out", "nov", "dez",
  ];
  return `${names[Number(m) - 1] ?? m}/${y}`;
}

/** Limitação declarada pela Receita na apuração assistida. */
export const APURACAO_LIMITACAO =
  "A apuração assistida da Receita ainda não trata cancelamento e devolução de documentos. " +
  "Nossa comparação herda a mesma limitação: competências com muitos cancelamentos podem divergir por esse motivo, e não por erro de cálculo.";

/** Copy de produto: o cálculo roda na nossa infraestrutura, offline. */
export const CALCULADORA_OFFLINE =
  "O cálculo usa a calculadora oficial da Receita rodando na nossa infraestrutura, que opera sem coleta de dados, sem telemetria e sem transmissão automática de informações. Seu dado fiscal não sai daqui.";
