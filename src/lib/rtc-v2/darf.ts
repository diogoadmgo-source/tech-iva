import { reaisParaCentavos } from "./valores";

/**
 * Geração de DARF da CBS (documentação 1.0, 13/11/2026). Duas APIs síncronas:
 *
 *   PCONT  POST /apuracao-cbs/v2/pcont/{cnpj}
 *          { pa: "MM/AAAA", opcaoPagamento, valorDarfParcial? }
 *          pagamento pela própria empresa, como contribuinte.
 *   RAD    POST /apuracao-cbs/v2/rad/{cnpj}
 *          [ { chaveDFE, opcaoPagamento, valorDarfParcial? }, ... ]
 *          recolhimento como ADQUIRENTE, nota a nota do fornecedor.
 *
 * Gerar DARF cria um documento oficial de arrecadação na Receita. Este módulo
 * só monta o pedido e lê a resposta; quem chama confirma com o usuário antes.
 */
export type OpcaoPagamento = "PAGAMENTO_TOTAL" | "PAGAMENTO_PARCIAL";

export type CodigoRetornoDarf =
  | "DARF_GERADO"
  | "DFE_NAO_ENCONTRADO"
  | "VALOR_PARCIAL_SUPERIOR_DFE"
  | "CNPJ_NAO_ADQUIRENTE"
  | "DADOS_DE_ENTRADA_INVALIDOS";

/** Texto que a tela mostra para cada código — o da Receita é técnico. */
export const RETORNO_DARF_LABEL: Record<string, string> = {
  DARF_GERADO: "DARF gerado",
  DFE_NAO_ENCONTRADO: "Documento fiscal não encontrado ou não vinculado a este CNPJ",
  VALOR_PARCIAL_SUPERIOR_DFE: "Valor parcial maior que o valor total do documento",
  CNPJ_NAO_ADQUIRENTE: "Este CNPJ não é o adquirente do documento",
  DADOS_DE_ENTRADA_INVALIDOS: "A Receita recusou os dados enviados",
};

export class PedidoDarfInvalido extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PedidoDarfInvalido";
  }
}

/** Centavos → número com 2 casas, por texto (sem erro de ponto flutuante). */
export function centavosParaReais(cents: number): number {
  if (!Number.isSafeInteger(cents)) throw new PedidoDarfInvalido("Valor inválido.");
  const sinal = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return Number(`${sinal}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`);
}

/** "2026-08" ou "08/2026" → "08/2026". */
export function paReceita(entrada: string): string {
  const t = entrada.trim();
  let m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(t);
  if (m) return validarPa(m[2] as string, m[1] as string);
  m = /^(\d{2})\/(\d{4})$/.exec(t);
  if (m) return validarPa(m[1] as string, m[2] as string);
  throw new PedidoDarfInvalido("Período de apuração inválido. Use MM/AAAA.");
}
function validarPa(mes: string, ano: string): string {
  const n = Number(mes);
  if (n < 1 || n > 12) throw new PedidoDarfInvalido("Mês do período de apuração inválido.");
  return `${mes}/${ano}`;
}

function parcial(opcao: OpcaoPagamento, valorCents: number | null | undefined): number | undefined {
  if (opcao === "PAGAMENTO_TOTAL") return undefined;
  if (valorCents === null || valorCents === undefined || !Number.isSafeInteger(valorCents) || valorCents <= 0) {
    throw new PedidoDarfInvalido("Pagamento parcial exige um valor maior que zero.");
  }
  return centavosParaReais(valorCents);
}

export function pedidoPcont(input: {
  pa: string;
  opcao: OpcaoPagamento;
  valorParcialCents?: number | null | undefined;
}): { pa: string; opcaoPagamento: OpcaoPagamento; valorDarfParcial?: number } {
  const valor = parcial(input.opcao, input.valorParcialCents);
  return {
    pa: paReceita(input.pa),
    opcaoPagamento: input.opcao,
    ...(valor !== undefined ? { valorDarfParcial: valor } : {}),
  };
}

export type ItemRad = { chaveDFE: string; opcao: OpcaoPagamento; valorParcialCents?: number | null | undefined };

/** Limite nosso, não da Receita: evita um pedido gigante por engano. */
export const MAX_ITENS_RAD = 50;

export function pedidoRad(
  itens: ItemRad[],
): Array<{ chaveDFE: string; opcaoPagamento: OpcaoPagamento; valorDarfParcial?: number }> {
  if (itens.length === 0) throw new PedidoDarfInvalido("Informe ao menos uma chave de documento fiscal.");
  if (itens.length > MAX_ITENS_RAD) {
    throw new PedidoDarfInvalido(`No máximo ${MAX_ITENS_RAD} documentos por pedido.`);
  }
  const vistas = new Set<string>();
  return itens.map((item) => {
    const chave = item.chaveDFE.replace(/\s/g, "");
    if (!/^[0-9A-Za-z]{20,100}$/.test(chave)) {
      throw new PedidoDarfInvalido(`Chave de documento fiscal inválida: ${chave.slice(0, 60) || "(vazia)"}.`);
    }
    if (vistas.has(chave)) throw new PedidoDarfInvalido(`Chave repetida no pedido: ${chave}.`);
    vistas.add(chave);
    const valor = parcial(item.opcao, item.valorParcialCents);
    return {
      chaveDFE: chave,
      opcaoPagamento: item.opcao,
      ...(valor !== undefined ? { valorDarfParcial: valor } : {}),
    };
  });
}

export type ResultadoDarf = {
  cdRetorno: string;
  gerado: boolean;
  chavePix: string | null;
  codigoBarras: string | null;
  linkPdf: string | null;
  dataMaxima: string | null;
  principalCents: number | null;
  multaCents: number | null;
  jurosCents: number | null;
  totalCents: number | null;
  mensagem: string | null;
  dadosInvalidos: string[];
  /** Chave da nota, quando a Receita a devolve junto (RAD com várias notas). */
  chaveDFE: string | null;
};

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function texto(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}
function valor(v: unknown): number | null {
  return v === null || v === undefined ? null : reaisParaCentavos(v);
}

function lerUm(o: Record<string, unknown>): ResultadoDarf {
  const darf = obj(o["darf"]);
  const info = obj(o["informacoesPagamento"]);
  const cd = texto(o["cdRetorno"]) ?? texto(o["codigoErro"]) ?? "SEM_CODIGO";
  const gerado = cd === "DARF_GERADO" && Boolean(texto(darf["codigoBarras"]) ?? texto(darf["chavePIX"]));
  return {
    cdRetorno: cd,
    gerado,
    chavePix: texto(darf["chavePIX"]),
    codigoBarras: texto(darf["codigoBarras"]),
    linkPdf: texto(darf["linkDarfPDF"]),
    dataMaxima: texto(info["dataMaximaPagamento"]),
    principalCents: valor(info["valorDarfPrincipal"]),
    multaCents: valor(info["valorDarfMulta"]),
    jurosCents: valor(info["valorDarfJuros"]),
    totalCents: valor(info["valorDarfTotal"]),
    mensagem: texto(o["mensagem"]) ?? texto(o["mensagemErro"]),
    dadosInvalidos: Array.isArray(o["dadosInvalidos"])
      ? (o["dadosInvalidos"] as unknown[]).map((x) => String(x)).slice(0, 20)
      : [],
    chaveDFE: texto(o["chaveDFE"]),
  };
}

/**
 * A documentação mostra um OBJETO de resposta mesmo quando o pedido do RAD é
 * uma lista de notas. Não sabemos ainda se várias notas viram um DARF só ou
 * um por nota — por isso aceitamos as duas formas: objeto (um resultado) ou
 * lista (um por item). Resposta que não é nenhuma das duas vira um resultado
 * de erro, nunca um DARF "gerado".
 */
export function lerRespostaDarf(corpo: unknown): ResultadoDarf[] {
  if (Array.isArray(corpo)) {
    const itens = corpo.map((x) => lerUm(obj(x)));
    return itens.length > 0 ? itens : [lerUm({ cdRetorno: "RESPOSTA_VAZIA" })];
  }
  const o = obj(corpo);
  for (const chave of ["resultados", "darfs", "itens"]) {
    if (Array.isArray(o[chave])) return lerRespostaDarf(o[chave]);
  }
  return [lerUm(o)];
}
