/**
 * Diagnóstico por linha para o cliente sanear a base. Toda linha recebe um
 * status, uma causa e uma ação: nada sai sem resposta. Só lê o que o banco
 * gravou (classe e base da classificação); não deduz regime nenhum.
 */
import { formatCnpj } from "./cnpj";
import { classificationText, type TaxClassification } from "./labels";
import type { PortfolioRow } from "./portfolio";

export type DiagnosisStatus =
  | "identificado"
  | "ressalva"
  | "provavel_cpf"
  | "cnpj_nao_encontrado"
  | "sem_fonte_publica"
  | "aguardando";

export const DIAGNOSIS_LABEL: Record<DiagnosisStatus, string> = {
  identificado: "Identificado",
  ressalva: "Identificado com ressalva",
  provavel_cpf: "Não diagnosticado · provável CPF",
  cnpj_nao_encontrado: "Não diagnosticado · CNPJ não encontrado na Receita",
  sem_fonte_publica: "Não diagnosticado · sem fonte pública",
  aguardando: "Aguardando processamento",
};

/** Ordem de leitura no resumo e no saneamento. */
export const DIAGNOSIS_ORDER: DiagnosisStatus[] = [
  "identificado",
  "ressalva",
  "sem_fonte_publica",
  "cnpj_nao_encontrado",
  "provavel_cpf",
  "aguardando",
];

export type Priority = "Alta" | "Média" | "Baixa" | "—";

export type Diagnosis = {
  status: DiagnosisStatus;
  regime: string;
  causa: string;
  acao: string;
  prioridade: Priority;
  alertas: string[];
  precisaAcao: boolean;
};

type Basis = Record<string, unknown> | null | undefined;
const s = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const br = (v: unknown) => {
  const x = s(v);
  return x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x.split("-").reverse().join("/") : x;
};

const SUFIXOS = new Set([
  "LTDA", "ME", "EPP", "EIRELI", "SA", "S", "A", "CIA", "DE", "DA", "DO", "DAS", "DOS", "E",
  "EM", "LIMITADA", "MEI", "SOCIEDADE", "EMPRESARIAL", "UNIPESSOAL", "SLU",
]);
const tokens = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !SUFIXOS.has(t));

/** Razões sociais claramente diferentes (não só pontuação, acento ou sufixo). */
export function razaoDivergente(declarada: string | null, publica: string | null): boolean {
  if (!declarada || !publica) return false;
  const a = tokens(declarada);
  const b = new Set(tokens(publica));
  if (!a.length || !b.size) return false;
  const comuns = a.filter((t) => b.has(t)).length;
  return comuns / Math.min(a.length, b.size) < 0.5;
}

const situacaoTexto = (r: PortfolioRow) => {
  const sit = r.tax_entities.situacao_cadastral;
  if (!sit || sit === "ATIVA") return null;
  const data = br(r.tax_entities.situacao_data);
  return `${sit.charAt(0)}${sit.slice(1).toLowerCase()}${data ? ` desde ${data}` : ""}`;
};

export function diagnose(r: PortfolioRow): Diagnosis {
  const e = r.tax_entities;
  const c: TaxClassification = e.public_classification;
  const b: Basis = e.public_classification_basis;
  const regime = classificationText(c, b);
  const sit = situacaoTexto(r);
  const alertas: string[] = [];
  if (sit) alertas.push(`Situação na Receita: ${sit}`);
  if (razaoDivergente(r.declared_razao_social, e.razao_social))
    alertas.push("Razão social do seu cadastro difere da Receita");
  const inativo = sit ? `A empresa está ${sit.toLowerCase()} na Receita. ` : "";

  if (c === "consulta_pendente")
    return {
      status: "aguardando", regime, alertas, precisaAcao: true, prioridade: "Baixa",
      causa: "CNPJ ainda não cruzado com os arquivos da Receita (entrou na base depois do último processamento).",
      acao: "Processar a base novamente.",
    };

  if (b?.["provavel_cpf"])
    return {
      status: "provavel_cpf", regime: "—", alertas, precisaAcao: true, prioridade: "Alta",
      causa:
        "O número não existe no cadastro de CNPJ da Receita e, sem os três zeros iniciais, é um CPF válido. Pessoa física não tem regime tributário de empresa.",
      acao: "Corrigir para o CNPJ da empresa ou retirar da base (pessoa física).",
    };

  if (b?.["cnpj_inexistente"])
    return {
      status: "cnpj_nao_encontrado", regime: "—", alertas, precisaAcao: true, prioridade: "Alta",
      causa: "O número não consta no cadastro de CNPJ da Receita (provável erro de digitação ou número substituído).",
      acao: "Conferir o CNPJ no cadastro de origem e corrigir.",
    };

  if (c === "excluido_simples") {
    const saida = br(b?.["data_exclusao"]);
    const ecf = b?.["ecf"] as { ano?: unknown } | null | undefined;
    return {
      status: "ressalva", regime, alertas, precisaAcao: true, prioridade: sit ? "Alta" : "Média",
      causa:
        inativo +
        `Saiu do Simples Nacional${saida ? ` em ${saida}` : ""} e ainda não há ECF publicada depois da saída` +
        (ecf?.ano ? ` (a última ECF publicada é de ${String(ecf.ano)}, anterior à saída)` : "") +
        ". O regime atual não pode ser confirmado por fonte pública.",
      acao: sit
        ? "Confirmar se o cadastro ainda é usado; se sim, confirmar o regime atual com o parceiro."
        : "Confirmar com o parceiro o regime atual (Lucro Presumido ou Lucro Real).",
    };
  }

  if (c === "nao_identificado") {
    const motivo = s(b?.["motivo"]);
    return {
      status: "sem_fonte_publica", regime: "—", alertas, precisaAcao: true, prioridade: sit ? "Alta" : "Média",
      causa:
        inativo +
        (motivo ? `${motivo}.` : "Sem opção pelo Simples e sem ECF publicada.") +
        " A ausência do Simples não indica Lucro Presumido nem Lucro Real.",
      acao: sit
        ? "Confirmar se o cadastro ainda é usado; se sim, solicitar o regime ao parceiro."
        : "Solicitar ao parceiro o regime tributário atual.",
    };
  }

  // Identificado pela fonte pública.
  const ano = s(b?.["ano_calendario"]);
  const causa =
    c === "lucro_real" || c === "lucro_presumido"
      ? `Declarado na ECF do ano-calendário ${ano ?? "indicado"} (histórico, não o regime vigente).`
      : c === "mei_simei"
        ? `Optante pelo SIMEI${b?.["data_opcao_mei"] ? ` desde ${br(b["data_opcao_mei"])}` : ""}, segundo a Receita.`
        : c === "simples_nacional"
          ? `Optante pelo Simples Nacional${b?.["data_opcao_simples"] ? ` desde ${br(b["data_opcao_simples"])}` : ""}, segundo a Receita.`
          : "Identificado na fonte pública.";
  return {
    status: "identificado", regime, alertas,
    precisaAcao: Boolean(sit) || alertas.length > 0,
    prioridade: sit ? "Alta" : alertas.length ? "Baixa" : "—",
    causa: inativo + causa,
    acao: sit
      ? "Avaliar inativar o cadastro."
      : alertas.length
        ? "Conferir a razão social no seu cadastro."
        : "Nenhuma ação necessária.",
  };
}

// ------------------------------------------------------------ cadastro
export const PORTE_LABEL: Record<string, string> = {
  "00": "Não informado",
  "01": "Microempresa",
  "03": "Empresa de pequeno porte",
  "05": "Demais",
};

/** CNPJ que é, na verdade, CPF com "000" na frente → CPF formatado. */
export function documento(r: PortfolioRow, d: Diagnosis): { tipo: "CNPJ" | "CPF"; numero: string } {
  if (d.status === "provavel_cpf" && /^000\d{11}$/.test(r.cnpj)) {
    const c = r.cnpj.slice(3);
    return { tipo: "CPF", numero: `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` };
  }
  return { tipo: "CNPJ", numero: formatCnpj(r.cnpj) };
}

/** 4530703 → "4530-7/03 · descrição". */
export function cnaeText(code?: string | null, desc?: string | null): string | null {
  if (!code || !/^\d{7}$/.test(code)) return null;
  const f = `${code.slice(0, 4)}-${code.slice(4, 5)}/${code.slice(5)}`;
  return desc ? `${f} · ${desc}` : f;
}

/** 2062 → "206-2 · descrição". */
export function naturezaText(code?: string | null, desc?: string | null): string | null {
  if (!code || !/^\d{4}$/.test(code)) return null;
  const f = `${code.slice(0, 3)}-${code.slice(3)}`;
  return desc ? `${f} · ${desc}` : f;
}
