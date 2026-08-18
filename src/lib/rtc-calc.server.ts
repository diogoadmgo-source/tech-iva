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

const CALC_PATH = "/api/calculadora/calcular";
const VALIDATE_PATH = "/api/assistente/validar";
const TIMEOUT_MS = 20_000;

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
  municipio_destino?: string | undefined;
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
      fetch(`${url}/api/health`, { method: "GET", signal }),
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
        headers: { "Content-Type": "application/json" },
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
    throw new EngineUnavailableError(
      "error",
      `A calculadora oficial respondeu com erro (HTTP ${res.status}).`,
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

  const payload = {
    dataFatoGerador: inputs.data_fato_gerador,
    baseCalculo: inputs.base_cents / 100,
    cst: inputs.cst,
    cClassTrib: inputs.cclasstrib,
    ...(inputs.ncm ? { ncm: inputs.ncm } : {}),
    ...(inputs.nbs ? { nbs: inputs.nbs } : {}),
    ufOrigem: inputs.uf_origem,
    ufDestino: inputs.uf_destino,
    ...(inputs.municipio_destino ? { municipioDestino: inputs.municipio_destino } : {}),
    quantidade: 1,
  };

  const raw = await postJson(CALC_PATH, payload);
  return normalizeCalc(raw, inputs.base_cents);
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

function tribute(node: Record<string, unknown> | null): Tribute {
  if (!node) return { valor_cents: 0, aliquota_pct: null, reducao_pct: null };
  return {
    valor_cents: cents(num(node["valor"], node["tributo"], node["vTrib"], node["value"])),
    aliquota_pct: num(node["aliquota"], node["pAliq"], node["rate"]),
    reducao_pct: num(node["reducao"], node["pRedAliq"], node["reducaoAliquota"]),
  };
}

function normalizeCalc(raw: Record<string, unknown>, baseCents: number): CalcResult {
  const root = pick(raw, "resultado", "result", "calculo") ?? raw;
  const cbs = tribute(pick(root, "cbs", "CBS"));
  const ibsNode = pick(root, "ibs", "IBS");
  const ibsEstadual = tribute(
    pick(root, "ibsEstadual", "ibsUF") ?? (ibsNode ? pick(ibsNode, "estadual", "uf") : null),
  );
  const ibsMunicipal = tribute(
    pick(root, "ibsMunicipal", "ibsMun") ??
      (ibsNode ? pick(ibsNode, "municipal", "municipio") : null),
  );
  const seletivo = tribute(pick(root, "is", "IS", "impostoSeletivo"));

  const passosRaw = (root["memoriaCalculo"] ??
    root["memoria"] ??
    root["memory"] ??
    root["passos"]) as unknown;
  const passosArray = Array.isArray(passosRaw)
    ? passosRaw
    : passosRaw && typeof passosRaw === "object"
      ? ((passosRaw as Record<string, unknown>)["passos"] as unknown[]) ?? []
      : [];

  const passos: CalcStepOut[] = (passosArray as Record<string, unknown>[]).map((p, i) => {
    const valor = num(p["valor"], p["valorCents"], p["value"]);
    const aliquota = num(p["aliquota"], p["pAliq"]);
    const reducao = num(p["reducao"], p["pRedAliq"]);
    const baseLegal = p["baseLegal"] ?? p["base_legal"] ?? p["fundamentacao"] ?? p["norma"];
    const descricao = p["descricao"] ?? p["detalhe"] ?? p["mensagem"];
    return {
      passo: String(p["passo"] ?? p["nome"] ?? p["etapa"] ?? `Passo ${i + 1}`),
      ...(typeof descricao === "string" ? { descricao } : {}),
      ...(valor !== null ? { valor_cents: cents(valor) } : {}),
      ...(aliquota !== null ? { aliquota_pct: aliquota } : {}),
      ...(reducao !== null ? { reducao_pct: reducao } : {}),
      ...(typeof baseLegal === "string" ? { base_legal: baseLegal } : {}),
    };
  });

  const tributoTotal =
    cents(num(root["totalTributos"], root["tributoTotal"])) ||
    cbs.valor_cents + ibsEstadual.valor_cents + ibsMunicipal.valor_cents + seletivo.valor_cents;

  const totalOperacao =
    cents(num(root["totalOperacao"], root["valorTotal"])) || baseCents + tributoTotal;

  const version = root["versaoCalculadora"] ?? root["versao"] ?? raw["versao"] ?? raw["version"];

  return {
    source: "official",
    calc_version: typeof version === "string" ? version : null,
    base_cents: cents(num(root["baseCalculo"])) || baseCents,
    cbs,
    ibs_estadual: ibsEstadual,
    ibs_municipal: ibsMunicipal,
    imposto_seletivo: seletivo,
    tributo_total_cents: tributoTotal,
    total_operacao_cents: totalOperacao,
    memory: {
      versao: typeof version === "string" ? version : null,
      passos,
      base_legal:
        typeof root["baseLegal"] === "string" ? (root["baseLegal"] as string) : null,
    },
  };
}

/* ------------------------------------------------------------ validação */

export async function validateXml(filename: string, xml: string): Promise<XmlValidationResult> {
  const local = readXmlHeader(xml);
  if (!baseUrl() && devStubAllowed()) return devStubValidate(filename, xml, local);

  const raw = await postJson(VALIDATE_PATH, { arquivo: filename, xml });
  const root = pick(raw, "resultado", "result") ?? raw;

  const issuesRaw = (root["inconsistencias"] ??
    root["erros"] ??
    root["issues"] ??
    root["ocorrencias"]) as unknown;
  const issues: XmlIssue[] = (Array.isArray(issuesRaw) ? issuesRaw : []).map((i) => {
    const o = i as Record<string, unknown>;
    return {
      codigo: String(o["codigo"] ?? o["code"] ?? "sem_codigo"),
      descricao: str(o["descricao"] ?? o["mensagem"] ?? o["message"]),
      item: num(o["item"], o["nItem"], o["linha"]),
      cst: str(o["cst"] ?? o["CST"]),
      cclasstrib: str(o["cclasstrib"] ?? o["cClassTrib"]),
      severidade: str(o["severidade"] ?? o["severity"] ?? o["nivel"]),
    };
  });

  const validoRaw = root["valido"] ?? root["valid"] ?? root["conforme"];
  const valido = typeof validoRaw === "boolean" ? validoRaw : issues.length === 0;
  const version = root["versaoCalculadora"] ?? root["versao"] ?? raw["versao"];

  return {
    source: "official",
    valido,
    filename,
    access_key: str(root["chaveAcesso"] ?? root["chNFe"]) ?? local.accessKey,
    modelo: str(root["modelo"] ?? root["mod"]) ?? local.modelo,
    total_itens: num(root["totalItens"], root["qtdItens"]) ?? local.totalItens,
    inconsistencias: issues,
    calc_version: typeof version === "string" ? version : null,
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
