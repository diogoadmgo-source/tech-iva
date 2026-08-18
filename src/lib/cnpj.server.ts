/**
 * Provedor externo de CNPJ (base pública da Receita Federal).
 *
 * Provedor padrão: opencnpj.org — sem chave, republicação mensal da base pública.
 * A URL e a chave ficam em variáveis de ambiente (CNPJ_API_URL / CNPJ_API_KEY) para
 * trocar de provedor (cnpja open, self-host do ZIP da Receita) sem mexer no código.
 *
 * Regra de ouro: se o provedor não devolver o indicador de Simples/MEI, gravamos
 * null — o regime vira 'desconhecido' e a tela trata. Nunca inventamos o valor.
 */

const DEFAULT_URL = "https://api.opencnpj.org/{cnpj}";

/** Máximo de 3 requisições por segundo (provedor gratuito ~50 req/s por IP; ficamos folgados). */
const MAX_PER_SECOND = 3;
const MIN_INTERVAL_MS = Math.ceil(1000 / MAX_PER_SECOND);
const MAX_ATTEMPTS = 3;

export type CnpjFetchStatus = "ok" | "not_found" | "error";

export type CnpjFetchResult = {
  cnpj: string;
  status: CnpjFetchStatus;
  razao_social?: string | null;
  regime_hint?: "mei" | "simples" | "presumido" | "desconhecido";
  message?: string;
};

export type RegistryPayload = Record<string, unknown>;

function endpoint(cnpj: string): string {
  const template = process.env["CNPJ_API_URL"] || DEFAULT_URL;
  return template.includes("{cnpj}") ? template.replace("{cnpj}", cnpj) : `${template.replace(/\/$/, "")}/${cnpj}`;
}

function headers(): Record<string, string> {
  const key = process.env["CNPJ_API_KEY"];
  return {
    accept: "application/json",
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fila serial com intervalo mínimo entre chamadas + backoff exponencial em 429/5xx. */
export async function fetchCnpjBatch(
  cnpjs: string[],
  onEach?: (payload: RegistryPayload) => Promise<void>,
): Promise<CnpjFetchResult[]> {
  const out: CnpjFetchResult[] = [];
  let previous = 0;

  for (const cnpj of cnpjs) {
    const wait = previous + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    previous = Date.now();

    const result = await fetchOne(cnpj);
    if (result.payload && onEach) {
      try {
        await onEach(result.payload);
      } catch (error) {
        out.push({
          cnpj,
          status: "error",
          message: error instanceof Error ? error.message : "falha ao gravar no cache",
        });
        continue;
      }
    }
    out.push(result.result);
  }

  return out;
}

async function fetchOne(
  cnpj: string,
): Promise<{ result: CnpjFetchResult; payload?: RegistryPayload }> {
  let lastMessage = "falha desconhecida";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(endpoint(cnpj), { headers: headers() });

      if (response.status === 404) {
        return {
          result: { cnpj, status: "not_found", message: "CNPJ não encontrado na base pública" },
        };
      }

      if (response.status === 429 || response.status >= 500) {
        lastMessage = `provedor respondeu ${response.status}`;
        await sleep(MIN_INTERVAL_MS * 2 ** attempt);
        continue;
      }

      if (!response.ok) {
        return { result: { cnpj, status: "error", message: `provedor respondeu ${response.status}` } };
      }

      const raw = (await response.json()) as Record<string, unknown>;
      if (typeof raw["error"] === "string") {
        return { result: { cnpj, status: "not_found", message: String(raw["error"]) } };
      }

      const payload = normalize(cnpj, raw);
      const simples = payload["simples_optante"] as boolean | null;
      const mei = payload["mei_optante"] as boolean | null;
      return {
        result: {
          cnpj,
          status: "ok",
          razao_social: (payload["razao_social"] as string | null) ?? null,
          regime_hint: mei ? "mei" : simples ? "simples" : simples === false ? "presumido" : "desconhecido",
        },
        payload,
      };
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : "erro de rede";
      await sleep(MIN_INTERVAL_MS * 2 ** attempt);
    }
  }

  return { result: { cnpj, status: "error", message: lastMessage } };
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function date(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : null;
}

/** "N"/"S" -> boolean; qualquer outra coisa -> null (não inventar). */
function flag(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const raw = str(value)?.toUpperCase();
  if (raw === "S" || raw === "SIM" || raw === "TRUE") return true;
  if (raw === "N" || raw === "NAO" || raw === "NÃO" || raw === "FALSE") return false;
  return null;
}

function moneyCents(value: unknown): number | null {
  const raw = str(value);
  if (raw === null) {
    return typeof value === "number" ? Math.round(value * 100) : null;
  }
  // "120000000000,00" (pt-BR) ou "120000000000.00"
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

/** Normaliza a resposta do provedor para o jsonb esperado por cnpj_registry_upsert. */
export function normalize(cnpj: string, raw: Record<string, unknown>): RegistryPayload {
  const cnaes = Array.isArray(raw["cnaes"]) ? (raw["cnaes"] as Array<Record<string, unknown>>) : [];
  const principal = cnaes.find((c) => c["is_principal"] === true);
  const secundarios = cnaes
    .filter((c) => c["is_principal"] !== true)
    .map((c) => ({ codigo: str(c["codigo"]), descricao: str(c["descricao"]) }));
  const phones = Array.isArray(raw["telefones"])
    ? (raw["telefones"] as Array<Record<string, unknown>>).filter((t) => t["is_fax"] !== true)
    : [];
  const phone = phones[0];

  const simples = flag(raw["opcao_simples"] ?? raw["simples_optante"] ?? (raw["simples"] as Record<string, unknown> | undefined)?.["optante"]);
  const mei = flag(raw["opcao_mei"] ?? raw["mei_optante"] ?? (raw["mei"] as Record<string, unknown> | undefined)?.["optante"]);

  return {
    cnpj,
    razao_social: str(raw["razao_social"]) ?? str(raw["nome"]),
    nome_fantasia: str(raw["nome_fantasia"]) ?? str(raw["fantasia"]),
    situacao: str(raw["situacao_cadastral"]) ?? str(raw["situacao"]),
    situacao_data: date(raw["data_situacao_cadastral"]),
    abertura: date(raw["data_inicio_atividade"] ?? raw["abertura"]),
    natureza_juridica: str(raw["natureza_juridica"]),
    porte: str(raw["porte_empresa"]) ?? str(raw["porte"]),
    capital_social_cents: moneyCents(raw["capital_social"]),
    cnae_principal: str(principal?.["codigo"]) ?? str(raw["cnae_principal"]),
    cnae_principal_desc: str(principal?.["descricao"]) ?? str(raw["cnae_principal_desc"]),
    cnae_secundarios: secundarios,
    uf: str(raw["uf"]),
    municipio: str(raw["municipio"]),
    bairro: str(raw["bairro"]),
    logradouro: [str(raw["tipo_logradouro"]), str(raw["logradouro"])].filter(Boolean).join(" ") || null,
    numero: str(raw["numero"]),
    complemento: str(raw["complemento"]),
    cep: str(raw["cep"]),
    email: str(raw["email"]),
    telefone: phone ? [str(phone["ddd"]), str(phone["numero"])].filter(Boolean).join(" ") : str(raw["telefone"]),
    simples_optante: simples,
    // O provedor devolve datas-sentinela mesmo para quem não é optante: só guardamos
    // a data quando a opção é afirmativa, para não sugerir adesão inexistente.
    simples_desde: simples === true ? date(raw["data_opcao_simples"]) : null,
    simples_ate: simples === false ? date(raw["data_exclusao_simples"]) : null,
    mei_optante: mei,
    mei_desde: mei === true ? date(raw["data_opcao_mei"]) : null,
    matriz: typeof raw["matriz_filial"] === "string" ? raw["matriz_filial"] === "Matriz" : flag(raw["matriz"]),
    source: providerName(),
    raw,
  };
}

export function providerName(): string {
  const url = process.env["CNPJ_API_URL"] || DEFAULT_URL;
  try {
    return new URL(url.replace("{cnpj}", "0")).hostname;
  } catch {
    return "publica";
  }
}
