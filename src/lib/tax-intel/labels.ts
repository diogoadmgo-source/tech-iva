/**
 * Rótulos do módulo Inteligência Tributária. Espelham os enums da migration 0240.
 * A classificação vem SEMPRE do banco: nada aqui deduz regime.
 */
export type TaxClassification =
  | "simples_nacional"
  | "mei_simei"
  | "simples_com_ibs_cbs_regular"
  | "lucro_presumido"
  | "lucro_real"
  | "excluido_simples"
  | "nao_identificado"
  | "consulta_pendente";

export const CLASSIFICATIONS: TaxClassification[] = [
  "simples_nacional",
  "mei_simei",
  "simples_com_ibs_cbs_regular",
  "lucro_presumido",
  "lucro_real",
  "excluido_simples",
  "nao_identificado",
  "consulta_pendente",
];

export const CLASSIFICATION_LABEL: Record<TaxClassification, string> = {
  simples_nacional: "Simples Nacional",
  mei_simei: "MEI (SIMEI)",
  simples_com_ibs_cbs_regular: "Simples com IBS/CBS regular",
  lucro_presumido: "Lucro Presumido",
  lucro_real: "Lucro Real",
  excluido_simples: "Excluído do Simples",
  nao_identificado: "Não identificado",
  consulta_pendente: "Consulta pendente",
};

/** Tom visual por classe (tokens do design system; sem cor fora do tema). */
export const CLASSIFICATION_TONE: Record<TaxClassification, string> = {
  simples_nacional: "text-regime-simples border-regime-simples/40 bg-regime-simples/10",
  mei_simei: "text-regime-mei border-regime-mei/40 bg-regime-mei/10",
  simples_com_ibs_cbs_regular: "text-regime-hibrido border-regime-hibrido/40 bg-regime-hibrido/10",
  lucro_presumido: "text-regime-presumido border-regime-presumido/40 bg-regime-presumido/10",
  lucro_real: "text-regime-real border-regime-real/40 bg-regime-real/10",
  excluido_simples: "text-warn border-warn/40 bg-warn/10",
  nao_identificado: "text-muted-foreground border-border bg-muted/40",
  consulta_pendente: "text-muted-foreground border-dashed border-border bg-surface-2/60",
};

/** Cor sólida da barra de distribuição (mesmos tokens). */
export const CLASSIFICATION_BAR: Record<TaxClassification, string> = {
  simples_nacional: "bg-regime-simples",
  mei_simei: "bg-regime-mei",
  simples_com_ibs_cbs_regular: "bg-regime-hibrido",
  lucro_presumido: "bg-regime-presumido",
  lucro_real: "bg-regime-real",
  excluido_simples: "bg-warn",
  nao_identificado: "bg-muted-foreground/50",
  consulta_pendente: "bg-muted-foreground/25",
};

export type ConsultationStatus = "ok" | "nao_encontrado" | "erro" | "fonte_indisponivel";
export const CONSULTATION_LABEL: Record<ConsultationStatus, string> = {
  ok: "Respondida",
  nao_encontrado: "Não encontrado na fonte",
  erro: "Erro",
  fonte_indisponivel: "Fonte indisponível",
};

export type SourceStatus = "ativa" | "a_confirmar" | "indisponivel";
export const SOURCE_STATUS_LABEL: Record<SourceStatus, string> = {
  ativa: "Ativa",
  a_confirmar: "A confirmar",
  indisponivel: "Indisponível",
};

export const RELATIONSHIP_LABEL = { cliente: "Cliente", fornecedor: "Fornecedor" } as const;

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "tax.import.create": "Importação iniciada",
  "tax.import.finalize": "Importação concluída",
  "tax.import.cancel": "Importação cancelada",
};

export const n = (v: number | null | undefined) => (v ?? 0).toLocaleString("pt-BR");
export const pct = (part: number, total: number) =>
  total > 0
    ? `${((part / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
    : "0%";

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
/** "há 5 minutos", "ontem"… a partir de um ISO do banco. */
export function since(iso: string, now = Date.now()): string {
  const s = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(s, "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  return new Date(iso).toLocaleDateString("pt-BR");
}

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
