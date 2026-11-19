import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import { apuracaoProcessarPendentes } from "@/lib/rtc-apuracao.functions";
import {
  cbsDarfPcont,
  cbsDarfPdf,
  cbsDarfRad,
  cbsPodeEmitirDarf,
  cbsV2Abrir,
} from "@/lib/rtc-cbs-v2.functions";
import type { ItemRad, OpcaoPagamento } from "@/lib/rtc-v2/darf";

/**
 * Dados da tela "DARF e recolhimentos" (API v2 da apuração da CBS).
 * As tabelas são da 0260; os tipos gerados do Supabase ainda não as conhecem,
 * por isso o acesso passa por um cliente sem tipo, com os tipos declarados aqui.
 */

const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const from = (t: string): any => (supabase.from as unknown as (t: string) => unknown).call(supabase, t);

export type RecursoV2 = "debitos" | "pagamentos" | "recolhimentos";

export type CotaRecurso = { usadas: number; limite: number; restantes: number; pode_manual: boolean };
export type CotaV2 = Partial<Record<RecursoV2 | "creditos", CotaRecurso>> & { reinicia_em?: string };

export type DebitoV2 = {
  id: string;
  pa: string;
  chave: string;
  origem: number;
  documento: number;
  emissao: string | null;
  atualizacao: string | null;
  apurado_cents: number;
  excedente_cents: number;
  inexigivel_cents: number;
  suspenso_cents: number;
  pgto_antecipado_cents: number;
  extinto_cents: number;
  saldo_devedor_cents: number;
};

export type PagamentoV2 = {
  id: string;
  recurso: "pagamentos" | "recolhimentos";
  data_arrecadacao: string;
  numero_darf: string;
  tipo: number;
  ni_adquirente: string | null;
  ni_contribuinte: string | null;
  sequencial: number;
  pa: string;
  vencimento: string | null;
  ni_fornecedor: string | null;
  chave_dfe: string | null;
  principal_cents: number;
  multa_cents: number;
  juros_cents: number;
  total_cents: number;
};

export type DarfRow = {
  id: string;
  tipo: "pcont" | "rad";
  pa: string | null;
  chave_dfe: string | null;
  opcao_pagamento: OpcaoPagamento;
  valor_parcial_cents: number | null;
  cd_retorno: string;
  gerado: boolean;
  chave_pix: string | null;
  codigo_barras: string | null;
  link_pdf: string | null;
  data_maxima: string | null;
  principal_cents: number | null;
  multa_cents: number | null;
  juros_cents: number | null;
  total_cents: number | null;
  mensagem: string | null;
  dados_invalidos: string[];
  criado_em: string;
};

export type SolicitacaoV2 = {
  id: string;
  recurso: string;
  status: string;
  solicitado_em: string | null;
  recebido_em: string | null;
  erro: string | null;
};

export function useCotaV2(tenantId: string) {
  return useQuery({
    queryKey: ["rtc-cota-v2", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<CotaV2> => {
      const { data, error } = await rpc("rtc_quota_status_v2", { p_tenant: tenantId });
      if (error) throw new Error(error.message);
      return (data ?? {}) as CotaV2;
    },
    staleTime: 30_000,
  });
}

export function useSolicitacoesV2(tenantId: string, polling: boolean) {
  return useQuery({
    queryKey: ["rtc-solicitacoes-v2", tenantId],
    enabled: Boolean(tenantId),
    refetchInterval: polling ? 10_000 : false,
    queryFn: async (): Promise<SolicitacaoV2[]> => {
      const { data, error } = await from("rtc_apuracao")
        .select("id, recurso, status, solicitado_em, recebido_em, erro")
        .eq("tenant_id", tenantId)
        .eq("api_versao", 2)
        .order("solicitado_em", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return (data ?? []) as SolicitacaoV2[];
    },
  });
}

export function useDebitosV2(tenantId: string) {
  return useQuery({
    queryKey: ["rtc-debitos-v2", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<DebitoV2[]> => {
      const { data, error } = await from("rtc_cbs_debito_v2")
        .select(
          "id, pa, chave, origem, documento, emissao, atualizacao, apurado_cents, excedente_cents, inexigivel_cents, suspenso_cents, pgto_antecipado_cents, extinto_cents, saldo_devedor_cents",
        )
        .eq("tenant_id", tenantId)
        .order("pa", { ascending: false })
        .order("emissao", { ascending: false })
        .limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as DebitoV2[];
    },
  });
}

export function usePagamentosV2(tenantId: string, recurso: "pagamentos" | "recolhimentos") {
  return useQuery({
    queryKey: ["rtc-pagamentos-v2", tenantId, recurso],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<PagamentoV2[]> => {
      const { data, error } = await from("rtc_cbs_pagamento")
        .select(
          "id, recurso, data_arrecadacao, numero_darf, tipo, ni_adquirente, ni_contribuinte, sequencial, pa, vencimento, ni_fornecedor, chave_dfe, principal_cents, multa_cents, juros_cents, total_cents",
        )
        .eq("tenant_id", tenantId)
        .eq("recurso", recurso)
        .order("data_arrecadacao", { ascending: false })
        .limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as PagamentoV2[];
    },
  });
}

export function useDarfs(tenantId: string) {
  return useQuery({
    queryKey: ["rtc-darfs", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<DarfRow[]> => {
      const { data, error } = await from("rtc_cbs_darf")
        .select(
          "id, tipo, pa, chave_dfe, opcao_pagamento, valor_parcial_cents, cd_retorno, gerado, chave_pix, codigo_barras, link_pdf, data_maxima, principal_cents, multa_cents, juros_cents, total_cents, mensagem, dados_invalidos, criado_em",
        )
        .eq("tenant_id", tenantId)
        .order("criado_em", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as DarfRow[];
    },
  });
}

export function usePodeEmitirDarf(tenantId: string) {
  const pode = useServerFn(cbsPodeEmitirDarf);
  return useQuery({
    queryKey: ["rtc-pode-darf", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => (await pode({ data: { tenantId } })).pode,
    staleTime: 300_000,
  });
}

function invalidar(qc: ReturnType<typeof useQueryClient>, tenantId: string) {
  for (const k of ["rtc-cota-v2", "rtc-solicitacoes-v2", "rtc-debitos-v2", "rtc-pagamentos-v2", "rtc-darfs"]) {
    void qc.invalidateQueries({ queryKey: [k, tenantId] });
  }
}

export function useAbrirV2(tenantId: string) {
  const qc = useQueryClient();
  const abrir = useServerFn(cbsV2Abrir);
  return useMutation({
    mutationFn: async (recurso: RecursoV2) => {
      const r = await abrir({ data: { tenantId, recurso } });
      if (!r.ok) throw new Error(r.motivo);
      return r.id;
    },
    onSuccess: () => invalidar(qc, tenantId),
  });
}

/** Acompanha as solicitações abertas (situação → link → arquivo → banco). */
export function useAtualizarV2(tenantId: string) {
  const qc = useQueryClient();
  const processar = useServerFn(apuracaoProcessarPendentes);
  return useMutation({
    mutationFn: async () => processar({ data: { tenantId } }),
    onSuccess: () => invalidar(qc, tenantId),
  });
}

export function useGerarDarfPcont(tenantId: string) {
  const qc = useQueryClient();
  const gerar = useServerFn(cbsDarfPcont);
  return useMutation({
    mutationFn: async (input: { pa: string; opcao: OpcaoPagamento; valorParcialCents?: number | null }) => {
      const r = await gerar({ data: { tenantId, ...input } });
      if (!r.ok) throw new Error(r.motivo);
      return r.darfs;
    },
    onSettled: () => invalidar(qc, tenantId),
  });
}

export function useGerarDarfRad(tenantId: string) {
  const qc = useQueryClient();
  const gerar = useServerFn(cbsDarfRad);
  return useMutation({
    mutationFn: async (itens: ItemRad[]) => {
      const r = await gerar({ data: { tenantId, itens } });
      if (!r.ok) throw new Error(r.motivo);
      return r.darfs;
    },
    onSettled: () => invalidar(qc, tenantId),
  });
}

export function useBaixarPdfDarf(tenantId: string) {
  const baixar = useServerFn(cbsDarfPdf);
  return useMutation({
    mutationFn: async (darfId: string) => {
      const r = await baixar({ data: { tenantId, darfId } });
      if (!r.ok) throw new Error(r.motivo);
      const bin = atob(r.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.nome;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  });
}

/* ------------------------------------------------------------ apoio à tela */

export const ORIGEM_LABEL: Record<number, string> = {
  0: "Normal",
  20: "Devolução por PCONT",
  21: "Devolução por RAD",
  22: "Devolução por crédito",
  30: "Cancelamento de crédito",
  31: "Cancelamento de RAD",
  32: "Cancelamento de PCONT",
  50: "Perecimento (FOB)",
  51: "Perecimento (CIF)",
  52: "Devolução perecimento CIF por PCONT",
  53: "Devolução perecimento CIF por RAD",
  54: "Devolução perecimento CIF por crédito",
  55: "Nota de crédito (multa e juros)",
};

export const DOCUMENTO_LABEL: Record<number, string> = {
  55: "NF-e",
  57: "CT-e",
  62: "NFCom",
  63: "BP-e",
  64: "GTV-e",
  65: "NFC-e",
  66: "NF3-e",
  67: "CT-e OS",
  91: "NFS-e",
  92: "NFS-e Via",
  93: "BP-e TM",
  94: "DERE",
  97: "CT-e Simplificado",
};

/** "2026-08-01" → "08/2026". */
export function paTexto(pa: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(pa);
  return m ? `${m[2]}/${m[1]}` : pa;
}

export type ResumoPa = {
  pa: string;
  documentos: number;
  apurado_cents: number;
  extinto_cents: number;
  pgto_antecipado_cents: number;
  suspenso_cents: number;
  inexigivel_cents: number;
  saldo_devedor_cents: number;
};

/** Soma por período de apuração — só transporta o que a Receita mandou. */
export function resumirPorPa(linhas: DebitoV2[]): ResumoPa[] {
  const mapa = new Map<string, ResumoPa>();
  for (const l of linhas) {
    const r =
      mapa.get(l.pa) ??
      ({
        pa: l.pa,
        documentos: 0,
        apurado_cents: 0,
        extinto_cents: 0,
        pgto_antecipado_cents: 0,
        suspenso_cents: 0,
        inexigivel_cents: 0,
        saldo_devedor_cents: 0,
      } satisfies ResumoPa);
    r.documentos += 1;
    r.apurado_cents += Number(l.apurado_cents);
    r.extinto_cents += Number(l.extinto_cents);
    r.pgto_antecipado_cents += Number(l.pgto_antecipado_cents);
    r.suspenso_cents += Number(l.suspenso_cents);
    r.inexigivel_cents += Number(l.inexigivel_cents);
    r.saldo_devedor_cents += Number(l.saldo_devedor_cents);
    mapa.set(l.pa, r);
  }
  return [...mapa.values()].sort((a, b) => (a.pa < b.pa ? 1 : -1));
}

/** "1.234,56" / "1234.56" / "1234" → centavos; null se não for valor. */
export function textoParaCentavos(t: string): number | null {
  const limpo = t.trim().replace(/\s|R\$/g, "");
  if (!limpo) return null;
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normal);
  if (!m) return null;
  return Number(m[1]) * 100 + Number(`${m[2] ?? ""}00`.slice(0, 2));
}
