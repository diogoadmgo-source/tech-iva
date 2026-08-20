import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import {
  apuracaoProcessarPendentes,
  apuracaoSolicitar,
} from "@/lib/rtc-apuracao.functions";
import {
  DEFAULT_PAGE_SIZE,
  EXACT_COUNT_LIMIT,
  fetchAllPages,
  paged,
  rangeOf,
  useRowCount,
  type Paged,
} from "@/lib/paginate";

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

/**
 * Solicita a apuração à Receita pelo próprio aplicativo: registra, debita cota,
 * chama a API com a URL de retorno deste ambiente e (quando o tíquete chega)
 * baixa e grava o JSON. Sem worker externo na jogada.
 */
export function useRequestApuracao(tenantId: string) {
  const queryClient = useQueryClient();
  const solicitar = useServerFn(apuracaoSolicitar);
  return useMutation({
    mutationFn: async (competencia: string) => {
      const result = await solicitar({ data: { tenantId, competencia } });
      if (!result.ok) throw new Error(result.motivo);
      return result.id;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rtc-quota", tenantId] });
      void queryClient.invalidateQueries({ queryKey: ["rtc-apuracoes", tenantId] });
      void queryClient.invalidateQueries({ queryKey: ["apuracao-detalhe", tenantId] });
      void queryClient.invalidateQueries({ queryKey: ["jobs", tenantId] });
    },
  });
}

/** Recuperação manual do passo 3 quando um retorno ficou para trás. */
export function useProcessarPendentesApuracao(tenantId: string) {
  const queryClient = useQueryClient();
  const processar = useServerFn(apuracaoProcessarPendentes);
  return useMutation({
    mutationFn: async () => processar({ data: { tenantId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rtc-apuracoes", tenantId] });
      void queryClient.invalidateQueries({ queryKey: ["apuracao-detalhe", tenantId] });
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

/**
 * Notas da competência. Ordenação `issued_at desc, id` — coberta pelo índice
 * invoices_tenant_issued_id. A contagem é consulta separada e cacheada pela
 * competência: repetir count(*) a cada página custava a tabela inteira, e o
 * total não muda enquanto a competência é a mesma. Acima de EXACT_COUNT_LIMIT
 * o total vem estimado (a tela mostra "aprox.").
 */
export function useCompetenciaInvoices(
  tenantId: string,
  competencia: string,
  page = 0,
  pageSize = DEFAULT_PAGE_SIZE,
) {
  const enabled = Boolean(tenantId && competencia);
  const start = competencia;
  const end = competencia ? nextMonth(competencia) : competencia;

  const rowsQuery = useQuery({
    queryKey: ["competencia-invoices", tenantId, competencia, page, pageSize],
    enabled,
    queryFn: async (): Promise<InvoiceRow[]> => {
      const [from, to] = rangeOf(page, pageSize);
      const { data, error } = await supabase
        .from("invoices")
        .select(
          "id, number, series, issued_at, total_cents, ibs_cents, cbs_cents, access_key, counterparty_id",
        )
        .eq("tenant_id", tenantId)
        .eq("direction", "out")
        .gte("issued_at", start)
        .lt("issued_at", end)
        .order("issued_at", { ascending: false })
        .order("id", { ascending: true }) // desempate: ordenação estável entre páginas
        .range(from, to);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as InvoiceRow[];
    },
  });

  const count = useRowCount(
    ["competencia-invoices", tenantId, competencia],
    async () => {
      const { count: n, error } = await supabase
        .from("invoices")
        .select("id", { count: "estimated", head: true })
        .eq("tenant_id", tenantId)
        .eq("direction", "out")
        .gte("issued_at", start)
        .lt("issued_at", end);
      if (error) throw new Error(error.message);
      return n ?? 0;
    },
    enabled,
  );

  const total = count.data ?? 0;
  return {
    ...rowsQuery,
    data: rowsQuery.data
      ? { ...paged(rowsQuery.data, total, page, pageSize), approx: total > EXACT_COUNT_LIMIT }
      : (undefined as Paged<InvoiceRow> | undefined),
  };
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
      // uma nota pode passar de 1000 itens; varremos página por página em vez de
      // aceitar o corte padrão do PostgREST.
      const rows = await fetchAllPages<InvoiceItemRow>(
        (from, to) =>
          supabase
            .from("invoice_items")
            .select(
              "id, line, description, ncm, cst, cclasstrib, qty, unit_price_cents, base_cents, ibs_cents, cbs_cents, is_cents, credit_eligible, credit_cents, calc_memory, inconsistency",
            )
            .eq("invoice_id", invoiceId as string)
            .order("line", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<{
            data: InvoiceItemRow[] | null;
            error: { message: string } | null;
          }>,
        { pageSize: 1000, hardCap: 20_000 },
      );
      return rows;
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

/* ------------------------------------ apuração assistida: estrutura real */

/**
 * A estrutura real do portal (observada na Apuração Assistida da GDB, ago/2026):
 * situação em estágios, DOIS totais com natureza C/D, seis visões (abas) e uma
 * árvore de contas cuja ORDEM de apresentação é parte do vocabulário do contador.
 * Natureza é dado próprio — "8.253,73 C" — nunca sinal negativo.
 */
export type ApuracaoSituacao = "em_andamento" | "periodo_ajuste" | "concluida";
export type ApuracaoNatureza = "credor" | "devedor" | "neutro";

export type ApuracaoConta = {
  caminho: string;
  conta: string;
  nivel: number;
  valor_cents: number;
  natureza: ApuracaoNatureza;
  tem_detalhe: boolean;
};

export type ApuracaoDetalhe =
  | { disponivel: false; competencia: string }
  | {
      disponivel: true;
      competencia: string;
      situacao: ApuracaoSituacao | null;
      resultado_cents: number | null;
      natureza_resultado: ApuracaoNatureza | null;
      saldo_atualizado_cents: number | null;
      natureza_saldo: ApuracaoNatureza | null;
      intencao_ressarcimento: boolean;
      recebido_em: string | null;
      visoes: Record<string, ApuracaoConta[]>;
    };

/** RPC apuracao_detalhe — totais + árvore de contas por visão. */
export function useApuracaoDetalhe(tenantId: string, competencia: string) {
  return useQuery({
    queryKey: ["apuracao-detalhe", tenantId, competencia],
    enabled: Boolean(tenantId && competencia),
    queryFn: async (): Promise<ApuracaoDetalhe> => {
      const { data, error } = await rpc("apuracao_detalhe", {
        p_tenant: tenantId,
        p_competencia: competencia,
      });
      if (error) throw new Error(error.message);
      return data as ApuracaoDetalhe;
    },
  });
}

export type ApuracaoListaRow = {
  competencia: string;
  situacao: ApuracaoSituacao | null;
  natureza_resultado: ApuracaoNatureza | null;
  resultado_cents: number | null;
  saldo_atualizado_cents: number | null;
  recebido_em: string | null;
};

/** RPC apuracoes_lista — equivalente ao "Minhas Apurações da CBS". */
export function useApuracoesLista(tenantId: string, limite = 24) {
  return useQuery({
    queryKey: ["apuracoes-lista", tenantId, limite],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<ApuracaoListaRow[]> => {
      const { data, error } = await rpc("apuracoes_lista", {
        p_tenant: tenantId,
        p_limite: limite,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as ApuracaoListaRow[];
    },
  });
}

/** As seis abas do portal, na mesma ordem. */
export const APURACAO_VISOES: Array<{ key: string; label: string; hint: string }> = [
  { key: "resultado", label: "Resultado", hint: "Débitos, créditos apropriados e redutores da competência." },
  { key: "saldo_atualizado", label: "Saldo Atualizado", hint: "Saldo após as movimentações posteriores ao fechamento." },
  { key: "eventos", label: "Eventos", hint: "Movimentações registradas na apuração." },
  { key: "em_processamento", label: "Em Processamento", hint: "Itens que a Receita ainda está processando." },
  { key: "outras_informacoes", label: "Outras Informações", hint: "Inclui os créditos acumulados passíveis de apropriação." },
  { key: "nao_aproveitados", label: "Não Aproveitados", hint: "Créditos e débitos que não entraram no resultado." },
];

export const SITUACAO_LABEL: Record<ApuracaoSituacao, string> = {
  em_andamento: "Em andamento",
  periodo_ajuste: "Período de ajuste",
  concluida: "Concluída",
};

export const SITUACAO_ORDEM: ApuracaoSituacao[] = ["em_andamento", "periodo_ajuste", "concluida"];

export const NATUREZA_SIGLA: Record<ApuracaoNatureza, string> = {
  credor: "C",
  devedor: "D",
  neutro: "",
};

export const NATUREZA_LABEL: Record<ApuracaoNatureza, string> = {
  credor: "Credor",
  devedor: "Devedor",
  neutro: "Neutro",
};

/**
 * Créditos acumulados passíveis de apropriação — o número que conta a história
 * do produto ("R$ 40 mil de crédito parado"). Vem em "Outras Informações".
 */
export function creditoAcumulado(detalhe: ApuracaoDetalhe | undefined): ApuracaoConta | null {
  if (!detalhe?.disponivel) return null;
  const contas = Object.values(detalhe.visoes).flat();
  return (
    contas.find(
      (c) => /acumulad/i.test(c.conta) && /apropria/i.test(c.conta) && c.valor_cents > 0,
    ) ?? null
  );
}

/** Copy de caixa para o crédito acumulado — nunca vocabulário de conta contábil. */
export const CREDITO_ACUMULADO_COPY =
  "Isso é dinheiro seu parado. Esse crédito não é uma conta contábil: ele reduz o que você vai " +
  "pagar quando houver débito de CBS, e enquanto não houver débito ele fica retido.";

/* ---------------------------------------- conciliação nota a nota (0154) */

/**
 * Reconciliação no nível do DOCUMENTO. A RPC conciliacao_documentos casa o
 * débito que a Receita apurou por chave de DF-e com a nossa nota, então em vez
 * de "há divergência de R$ 3 mil" a tela aponta a nota exata.
 */
export type ConciliacaoDoc = {
  chave_dfe: string | null;
  numero_dfe: string | null;
  contraparte: string | null;
  receita_cents: number | null;
  nosso_cents: number | null;
  diferenca_cents: number | null;
  nao_extinto_cents: number | null;
  situacao: string | null;
  grupo: "corrente" | "ajuste" | "extemporaneo" | null;
};

export function useConciliacaoDocumentos(
  tenantId: string,
  competencia: string,
  soDivergentes = true,
) {
  return useQuery({
    queryKey: ["conciliacao-documentos", tenantId, competencia, soDivergentes],
    enabled: Boolean(tenantId && competencia),
    queryFn: async (): Promise<ConciliacaoDoc[]> => {
      const { data, error } = await rpc("conciliacao_documentos", {
        p_tenant: tenantId,
        p_competencia: competencia,
        p_so_divergentes: soDivergentes,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as ConciliacaoDoc[];
    },
  });
}

/** Resumo por forma de extinção — quanto saiu em dinheiro e quanto virou crédito. */
export type ExtincaoResumo = {
  competencia: string;
  debito_total_cents: number;
  extinto_cents: number;
  ainda_devido_cents: number;
  por_credito_cbs_cents: number;
  por_credito_piscofins_cents: number;
  por_pagamento_cents: number;
  por_prescricao_cents: number;
  documentos: number;
  documentos_em_aberto: number;
  extemporaneos_cents: number;
};

export function useExtincaoResumo(tenantId: string, competencia: string) {
  return useQuery({
    queryKey: ["extincao-resumo", tenantId, competencia],
    enabled: Boolean(tenantId && competencia),
    queryFn: async (): Promise<ExtincaoResumo> => {
      const { data, error } = await rpc("extincao_resumo", {
        p_tenant: tenantId,
        p_competencia: competencia,
      });
      if (error) throw new Error(error.message);
      return data as ExtincaoResumo;
    },
  });
}

export const DEBITO_SITUACAO_LABEL: Record<string, string> = {
  aguardando_processamento: "Aguardando processamento",
  nao_extinto: "Em aberto",
  extinto_parcial: "Pago em parte",
  extinto_total: "Quitado",
  cancelado: "Cancelado",
};

export const GRUPO_LABEL: Record<string, string> = {
  corrente: "Competência",
  ajuste: "Ajuste",
  extemporaneo: "Extemporâneo",
};

/** Motivo provável da divergência, em linguagem de quem confere nota. */
export function motivoDivergencia(doc: ConciliacaoDoc): string {
  const nosso = doc.nosso_cents ?? 0;
  const diff = doc.diferenca_cents ?? 0;
  if (nosso === 0) return "Nota na Receita sem correspondente aqui";
  if (doc.situacao === "cancelado") return "Documento cancelado na Receita";
  if (diff > 0) return "Receita apurou mais do que calculamos";
  if (diff < 0) return "Calculamos mais do que a Receita apurou";
  return "Valores iguais";
}

/** CSV da conciliação — ponto-e-vírgula e valores em reais, pronto para o ERP. */
export function conciliacaoCsv(rows: ConciliacaoDoc[]): string {
  const head = [
    "chave_dfe",
    "numero",
    "contraparte",
    "receita",
    "nosso_calculo",
    "diferenca",
    "ainda_devido",
    "situacao",
    "grupo",
    "motivo",
  ].join(";");
  const money = (c: number | null) => ((c ?? 0) / 100).toFixed(2).replace(".", ",");
  const txt = (v: string | null | undefined) => (v ?? "").replace(/;/g, ",");
  const body = rows
    .map((r) =>
      [
        txt(r.chave_dfe),
        txt(r.numero_dfe),
        txt(r.contraparte),
        money(r.receita_cents),
        money(r.nosso_cents),
        money(r.diferenca_cents),
        money(r.nao_extinto_cents),
        txt(r.situacao ? (DEBITO_SITUACAO_LABEL[r.situacao] ?? r.situacao) : ""),
        txt(r.grupo ? (GRUPO_LABEL[r.grupo] ?? r.grupo) : ""),
        txt(motivoDivergencia(r)),
      ].join(";"),
    )
    .join("\n");
  return `${head}\n${body}`;
}
