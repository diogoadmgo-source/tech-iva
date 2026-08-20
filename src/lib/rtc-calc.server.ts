/**
 * Adaptador do COMPONENTE OFICIAL da Receita (Calculadora / Assistente RTC).
 *
 * Manual Plataforma CBS (RFB, maio/2026): não existe API pública hospedada de
 * cálculo. O motor é o componente offline (Docker/JAR Java 21) rodando na NOSSA
 * infraestrutura, expondo API local — por padrão http://localhost:8080/api,
 * configurável em RTC_CALC_URL.
 *
 * REGRA DURA: nenhum número pode chegar à tela sem vir do motor oficial. Quando
 * o container não está no ar, este adaptador LANÇA EngineUnavailableError e a
 * interface mostra "Calculadora não disponível" — nunca um valor estimado.
 *
 * Modo degradado (RTC_CALC_DEV_STUB=1) existe apenas para desenvolvimento e é
 * PROIBIDO em produção: é bloqueado quando NODE_ENV === 'production', e o que
 * ele devolve vem marcado com source='dev-stub' para a tela gritar que aquele
 * número não é oficial.
 */

/**
 * CONTRATO REAL — conferido no código-fonte oficial (codigo-fonte-backend.zip,
 * br.gov.serpro.rtc.api.controller.*), idêntico ao adaptador de fluxa-services:
 *   POST /api/calculadora/regime-geral   { id, versao, dhFatoGerador, municipio(IBGE,@NotNull), uf, itens[] }
 *   POST /api/calculadora/xml/validate?tipo=nfe|nfce|cte|...&subtipo=grupo|nota   (XML → boolean)
 *   GET  /api/calculadora/dados-abertos/versao → { versaoApp, versaoDb, dataVersaoDb, ambiente }
 * Identidade da regra: `${versaoApp}-db${versaoDb}` (ex.: 1.3.0-dbV0042) = rule_versions.calc_version.
 */
const CALC_PATH = "/api/calculadora/regime-geral";
const VALIDATE_PATH = "/api/calculadora/xml/validate";
const VERSION_PATH = "/api/calculadora/dados-abertos/versao";
const TIMEOUT_MS = 20_000;
/** Chave do proxy Caddy na frente do motor (produção). Vazio em dev local. */
const API_KEY = process.env["RTC_CALC_API_KEY"] ?? "";
const authHeaders = (): Record<string, string> => (API_KEY ? { "X-Api-Key": API_KEY } : {});
/** Local padrão quando a tela não informa o município (art. 11 LC 214/25): Goiânia. */
const DEFAULT_MUNICIPIO = process.env["RTC_DEFAULT_MUNICIPIO"] ?? "5208707";

export type EngineUnavailableReason = "not_configured" | "unreachable" | "error";

export class EngineUnavailableError extends Error {
  reason: EngineUnavailableReason;
  constructor(reason: EngineUnavailableReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

export type EngineSource = "official" | "dev-stub";

export type CalcInputs = {
  cst: string;
  cclasstrib: string;
  ncm?: string | undefined;
  nbs?: string | undefined;
  base_cents: number;
  uf_origem: string;
  uf_destino: string;
  /** Nome do município (só exibição). */
  municipio_destino?: string | undefined;
  /** Código IBGE de 7 dígitos — é o que o motor exige (@NotNull). */
  municipio_codigo?: string | undefined;
  data_fato_gerador: string;
  descricao?: string | undefined;
};

export type Tribute = {
  valor_cents: number;
  aliquota_pct: number | null;
  reducao_pct: number | null;
};

export type CalcStepOut = {
  passo: string;
  descricao?: string | undefined;
  valor_cents?: number | undefined;
  aliquota_pct?: number | undefined;
  reducao_pct?: number | undefined;
  base_legal?: string | undefined;
};

export type CalcResult = {
  source: EngineSource;
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

export type XmlIssue = {
  codigo: string;
  descricao: string | null;
  item: number | null;
  cst: string | null;
  cclasstrib: string | null;
  severidade: string | null;
};

export type XmlValidationResult = {
  source: EngineSource;
  valido: boolean;
  filename: string;
  access_key: string | null;
  modelo: string | null;
  total_itens: number | null;
  inconsistencias: XmlIssue[];
  calc_version: string | null;
};

/* --------------------------------------------------------------- estado */

function baseUrl(): string | null {
  const raw = process.env["RTC_CALC_URL"];
  if (!raw || !raw.trim()) return null;
  return raw.trim().replace(/\/+$/, "");
}

function devStubAllowed(): boolean {
  if (process.env["NODE_ENV"] === "production") return false; // proibido em produção
  return process.env["RTC_CALC_DEV_STUB"] === "1";
}

export type EngineStatus = {
  available: boolean;
  configured: boolean;
  reason: EngineUnavailableReason | null;
  dev_stub: boolean;
  calc_version: string | null;
  checked_at: string;
};

/** Health-check do componente. Não devolve nenhum valor calculado. */
export async function engineStatus(): Promise<EngineStatus> {
  const at = new Date().toISOString();
  const url = baseUrl();
  const stub = devStubAllowed();
  if (!url) {
    return {
      available: stub,
      configured: false,
      reason: stub ? null : "not_configured",
      dev_stub: stub,
      calc_version: stub ? "dev-stub" : null,
      checked_at: at,
    };
  }
  try {
    const res = await withTimeout((signal) =>
      fetch(`${url}${VERSION_PATH}`, { method: "GET", headers: authHeaders(), signal }),
    );
    const version = await readVersion(res);
    return {
      available: res.ok,
      configured: true,
      reason: res.ok ? null : "error",
      dev_stub: false,
      calc_version: version,
      checked_at: at,
    };
  } catch {
    return {
      available: stub,
      configured: true,
      reason: stub ? null : "unreachable",
      dev_stub: stub,
      calc_version: null,
      checked_at: at,
    };
  }
}

async function readVersion(res: Response): Promise<string | null> {
  try {
    const body = (await res.clone().json()) as Record<string, unknown>;
    const app = body["versaoApp"], db = body["versaoDb"];
    if (typeof app === "string" && typeof db === "string") return `${app}-db${db}`;
    const v = body["versao"] ?? body["version"] ?? body["calc_version"];
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fn(controller.signal).finally(() => clearTimeout(timer));
}

async function postJson(path: string, body: unknown): Promise<Record<string, unknown>> {
  const url = baseUrl();
  if (!url) {
    throw new EngineUnavailableError(
      "not_configured",
      "Calculadora oficial não configurada neste ambiente.",
    );
  }
  let res: Response;
  try {
    res = await withTimeout((signal) =>
      fetch(`${url}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
        signal,
      }),
    );
  } catch {
    throw new EngineUnavailableError(
      "unreachable",
      "Não foi possível falar com a calculadora oficial.",
    );
  }
  if (!res.ok) {
    // RFC 7807: { type, title, status, detail } — ex.: "NCM de código X não encontrada para a data Y"
    let detail = "";
    try { const p = (await res.json()) as Record<string, unknown>; detail = String(p["detail"] ?? p["title"] ?? ""); } catch { /* sem corpo */ }
    throw new EngineUnavailableError(
      "error",
      detail ? `A calculadora oficial recusou a operação: ${detail}` : `A calculadora oficial respondeu com erro (HTTP ${res.status}).`,
    );
  }
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    throw new EngineUnavailableError("error", "Resposta inválida da calculadora oficial.");
  }
}

/* ------------------------------------------------------------- cálculo */

export async function calculate(inputs: CalcInputs): Promise<CalcResult> {
  if (!baseUrl() && devStubAllowed()) return devStubCalc(inputs);

  const municipio = /^\d{7}$/.test(inputs.municipio_codigo ?? "") ? inputs.municipio_codigo! : DEFAULT_MUNICIPIO;
  const payload = {
    id: cryptoRandomId(),
    versao: "1.0.0",
    dhFatoGerador: `${inputs.data_fato_gerador}T12:00:00-03:00`,
    dataHoraEmissao: `${inputs.data_fato_gerador}T12:00:00-03:00`,  // legado (@Deprecated no OperacaoInput)
    uf: inputs.uf_destino,
    municipio: Number(municipio),
    itens: [{
      numero: 1,
      ...(inputs.ncm ? { ncm: inputs.ncm } : {}),
      ...(inputs.nbs ? { nbs: inputs.nbs } : {}),
      cst: inputs.cst,
      cClassTrib: inputs.cclasstrib,
      baseCalculo: Math.round(inputs.base_cents) / 100,
      quantidade: 1,
      unidade: "UN",
    }],
  };

  const raw = await postJson(CALC_PATH, payload);
  return normalizeCalc(raw, inputs.base_cents, municipio !== inputs.municipio_codigo);
}

function cryptoRandomId(): string {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

function num(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
    if (typeof c === "string" && c.trim() && Number.isFinite(Number(c))) return Number(c);
  }
  return null;
}

/** Reais -> centavos, sem inventar valor: ausente continua ausente (0 explícito). */
function cents(value: number | null): number {
  return value === null ? 0 : Math.round(value * 100);
}

function pick(obj: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | null {
  for (const k of keys) {
    const v = obj[k];
    if (v && typeof v === "object") return v as Record<string, unknown>;
  }
  return null;
}

/** Um tributo do grupo gIBSCBS: { pX, vX, gRed?{pRedAliq,pAliqEfet}, memoriaCalculo }. */
function tribute(node: Record<string, unknown> | null, pKey: string, vKey: string): Tribute {
  if (!node) return { valor_cents: 0, aliquota_pct: null, reducao_pct: null };
  const red = pick(node, "gRed");
  return {
    valor_cents: cents(num(node[vKey])),
    aliquota_pct: num(node[pKey]),
    reducao_pct: red ? num(red["pRedAliq"]) : null,
  };
}

function normalizeCalc(raw: Record<string, unknown>, baseCents: number, municipioPadrao: boolean): CalcResult {
  const objetos = Array.isArray(raw["objetos"]) ? (raw["objetos"] as Record<string, unknown>[]) : [];
  const obj = objetos[0] ?? {};
  const tribCalc = pick(obj, "tribCalc") ?? {};
  const ibscbs = pick(tribCalc, "IBSCBS") ?? {};
  const g = pick(ibscbs, "gIBSCBS") ?? {};
  const gUF = pick(g, "gIBSUF"), gMun = pick(g, "gIBSMun"), gCBS = pick(g, "gCBS");
  const isNode = pick(tribCalc, "IS");

  const cbs = tribute(gCBS, "pCBS", "vCBS");
  const ibsEstadual = tribute(gUF, "pIBSUF", "vIBSUF");
  const ibsMunicipal = tribute(gMun, "pIBSMun", "vIBSMun");
  const seletivo = tribute(isNode, "pIS", "vIS");

  // A memória oficial vem como uma frase por tributo. Viram "passos" para a tela,
  // com a alíquota efetiva quando há redução (gRed.pAliqEfet).
  const passos: CalcStepOut[] = [];
  const pushStep = (nome: string, node: Record<string, unknown> | null, t: Tribute) => {
    if (!node) return;
    const red = pick(node, "gRed");
    const efet = red ? num(red["pAliqEfet"]) : null;
    const memoria = node["memoriaCalculo"];
    passos.push({
      passo: nome,
      ...(typeof memoria === "string" ? { descricao: memoria } : {}),
      valor_cents: t.valor_cents,
      ...(t.aliquota_pct !== null ? { aliquota_pct: efet ?? t.aliquota_pct } : {}),
      ...(t.reducao_pct !== null ? { reducao_pct: t.reducao_pct } : {}),
    });
  };
  pushStep("CBS", gCBS, cbs);
  pushStep("IBS estadual", gUF, ibsEstadual);
  pushStep("IBS municipal", gMun, ibsMunicipal);
  pushStep("Imposto Seletivo", isNode, seletivo);
  if (municipioPadrao) {
    passos.push({ passo: "Local da operação",
      descricao: `Município não informado na tela; usado o padrão IBGE ${DEFAULT_MUNICIPIO} (art. 11 LC 214/25). O IBS municipal pode variar.` });
  }

  const tributoTotal = cbs.valor_cents + ibsEstadual.valor_cents + ibsMunicipal.valor_cents + seletivo.valor_cents;
  const vBC = cents(num(g["vBC"])) || baseCents;
  // base legal: primeira frase da memória (o motor embute o enquadramento — ex.: "Art. 132")
  const firstMem = [gCBS, gUF, gMun].map((n) => n && n["memoriaCalculo"]).find((m) => typeof m === "string") as string | undefined;
  const baseLegal = firstMem ? (firstMem.match(/enquadramento legal em ([^,]+)/)?.[1] ?? null) : null;

  return {
    source: "official",
    calc_version: null,            // preenchido pelo chamador via engineStatus (dados-abertos/versao)
    base_cents: vBC,
    cbs,
    ibs_estadual: ibsEstadual,
    ibs_municipal: ibsMunicipal,
    imposto_seletivo: seletivo,
    tributo_total_cents: tributoTotal,
    total_operacao_cents: vBC + tributoTotal,
    memory: { versao: null, passos, base_legal: baseLegal },
  };
}

/* ------------------------------------------------------------ validação */

/** modelo do DF-e → TipoDocumento do XMLController. */
function tipoDocumento(modelo: string | null, xml: string): string {
  switch (modelo) {
    case "55": return "nfe";
    case "65": return "nfce";
    case "57": return "cte";
    case "63": return "bpe";
    case "66": return "nf3e";
    default:
      if (/<infNFSe|<DPS\b|<NFSe\b/.test(xml)) return "nfse";
      if (/<infCTeSimp/.test(xml)) return "cte-simplificado";
      if (/<infBPeTM/.test(xml)) return "bpe-tm";
      return "nfe";
  }
}

export async function validateXml(filename: string, xml: string): Promise<XmlValidationResult> {
  const local = readXmlHeader(xml);
  if (!baseUrl() && devStubAllowed()) return devStubValidate(filename, xml, local);

  const url = baseUrl();
  if (!url) throw new EngineUnavailableError("not_configured", "Calculadora oficial não configurada neste ambiente.");

  // subtipo: "nota" quando é o documento inteiro, "grupo" quando é só o bloco IBSCBS/IS
  const subtipo = /<(infNFe|infCte|infBPe|infNF3e|infNFSe|NFe|CTe|BPe|NF3e)\b/.test(xml) ? "nota" : "grupo";
  const tipo = tipoDocumento(local.modelo, xml);
  const q = new URLSearchParams({ tipo, subtipo });

  let res: Response;
  try {
    res = await withTimeout((signal) =>
      fetch(`${url}${VALIDATE_PATH}?${q}`, {
        method: "POST", headers: { "Content-Type": "application/xml", ...authHeaders() }, body: xml, signal,
      }),
    );
  } catch {
    throw new EngineUnavailableError("unreachable", "Não foi possível falar com a calculadora oficial.");
  }
  const text = await res.text();
  const issues: XmlIssue[] = [];
  let valido = false;
  if (res.ok) {
    valido = text.trim() === "true";
    if (!valido) issues.push({ codigo: "xml_invalido", descricao: "O Assistente Validador oficial reprovou o XML.", item: null, cst: null, cclasstrib: null, severidade: "erro" });
  } else {
    let detail = text.slice(0, 500), codigo = `http_${res.status}`;
    try { const p = JSON.parse(text) as Record<string, unknown>; detail = String(p["detail"] ?? p["title"] ?? detail); codigo = String(p["type"] ?? codigo).split("/").pop() ?? codigo; } catch { /* texto */ }
    issues.push({ codigo, descricao: detail, item: null, cst: null, cclasstrib: null, severidade: "erro" });
  }

  return {
    source: "official",
    valido,
    filename,
    access_key: local.accessKey,
    modelo: local.modelo,
    total_itens: local.totalItens,
    inconsistencias: issues,
    calc_version: null,
  };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Metadados lidos do próprio XML (não são cálculo — só identificação). */
export function readXmlHeader(xml: string): {
  accessKey: string | null;
  modelo: string | null;
  totalItens: number | null;
} {
  const id = /\bId="?(?:NFe|NFS|CTe)?(\d{44})"?/.exec(xml) ?? /<chNFe>(\d{44})<\/chNFe>/.exec(xml);
  const accessKey = id?.[1] ?? null;
  const mod = /<mod>(\d{2})<\/mod>/.exec(xml)?.[1] ?? (accessKey ? accessKey.slice(20, 22) : null);
  const items = xml.match(/<det\b/g)?.length ?? null;
  return { accessKey, modelo: mod, totalItens: items };
}

/* --------------------------------------- modo degradado (só desenvolvimento) */

function devStubCalc(inputs: CalcInputs): CalcResult {
  const zero: Tribute = { valor_cents: 0, aliquota_pct: null, reducao_pct: null };
  return {
    source: "dev-stub",
    calc_version: "dev-stub",
    base_cents: inputs.base_cents,
    cbs: zero,
    ibs_estadual: zero,
    ibs_municipal: zero,
    imposto_seletivo: zero,
    tributo_total_cents: 0,
    total_operacao_cents: inputs.base_cents,
    memory: {
      versao: "dev-stub",
      passos: [
        {
          passo: "Modo de desenvolvimento",
          descricao:
            "Motor oficial ausente. Nenhum tributo foi calculado — os valores exibidos são zero de propósito.",
        },
      ],
      base_legal: null,
    },
  };
}

function devStubValidate(
  filename: string,
  _xml: string,
  local: { accessKey: string | null; modelo: string | null; totalItens: number | null },
): XmlValidationResult {
  return {
    source: "dev-stub",
    valido: true,
    filename,
    access_key: local.accessKey,
    modelo: local.modelo,
    total_itens: local.totalItens,
    inconsistencias: [],
    calc_version: "dev-stub",
  };
}
