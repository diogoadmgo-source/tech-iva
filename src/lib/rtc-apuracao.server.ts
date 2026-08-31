/**
 * APURAÇÃO DA CBS — passos 1 e 3 do fluxo, agora DENTRO do aplicativo.
 *
 * O fluxo da Receita tem três passos:
 *   1. POST solicitação (leva `urlRetorno`)  -> este arquivo
 *   2. a Receita chama nosso webhook com {tiqueteSolicitacao, tiqueteDownload}
 *      -> src/routes/api/public/rtc.apuracao.$ref.tsx
 *   3. GET/POST download do JSON usando o tíquete e ingestão -> este arquivo
 *
 * Falamos DIRETO com a API da Receita (apuracao-cbs v1), sem proxy no meio:
 * OAuth client_credentials no /token e Bearer nas duas chamadas. O endereço vem
 * de RTC_API_URL (produção por padrão) e o prefixo de RTC_API_PREFIX (`rtc` ou
 * `prr-rtc` na produção restrita).

 *
 * REGRA DO PROJETO PRESERVADA: nenhum valor fiscal é produzido aqui. Este módulo
 * só transporta e grava o que a Receita devolveu. Motor fora do ar => erro
 * explícito, nunca número estimado.
 */

import { sealSecret, unsealSecret } from "@/lib/credentials.server";

const TIMEOUT_MS = 45_000;

export type GatewayUnavailableReason = "not_configured" | "no_credential" | "unreachable" | "error";

export class ApuracaoGatewayError extends Error {
  constructor(
    public readonly reason: GatewayUnavailableReason,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApuracaoGatewayError";
  }
}

function validHttpBaseUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return raw.trim().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * Endereço da API da Receita. Produção por padrão; a variável de ambiente
 * permite apontar para Produção Restrita (/prr-rtc) ou Homologação
 * (h-gateway.receitaintegra.serpro.gov.br). Valores que não são URL HTTP(S)
 * são ignorados — já bloquearam a integração uma vez.
 */
const RECEITA_PROD = "https://api.receitafederal.gov.br";

function apiBase(): string | null {
  return (
    validHttpBaseUrl(process.env["RTC_API_URL"]) ??
    validHttpBaseUrl(process.env["RTC_APURACAO_URL"]) ??
    RECEITA_PROD
  );
}

function tokenUrl(): string | null {
  const explicito = validHttpBaseUrl(process.env["RTC_TOKEN_URL"]);
  if (explicito) return explicito;
  const base = apiBase();
  return base ? `${base}/token` : null;
}

/** `rtc` em produção/homologação; `prr-rtc` na produção restrita. */
function apiPrefix(): string {
  const raw = (process.env["RTC_API_PREFIX"] ?? "rtc").trim().replace(/^\/+|\/+$/g, "");
  return /^[a-z0-9-]+$/.test(raw) ? raw : "rtc";
}



function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fn(controller.signal).finally(() => clearTimeout(timer));
}

type AdminClient = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

type Credential = { id: string; apiKey: string };

/**
 * Credencial de acesso à API (provider `rtc`, kind `api_key`). O material é
 * `<CLIENT_ID>:<CLIENT_SECRET>` selado em envelope no bucket privado — nunca
 * volta ao navegador e nunca vai para log.
 */
async function loadApiKey(admin: AdminClient, tenantId: string): Promise<Credential> {
  const { data, error } = await admin
    .from("integration_credentials")
    .select("id, secret_ref, status")
    .eq("tenant_id", tenantId)
    .in("provider", ["rtc_cbs", "rtc"])
    .eq("kind", "api_key")
    .neq("status", "revogada")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.secret_ref) {
    throw new ApuracaoGatewayError(
      "no_credential",
      "Nenhuma chave de API do RTC cadastrada para esta empresa. Cadastre em Integrações.",
    );
  }

  const { SECRETS_BUCKET } = await import("@/lib/credentials.server");
  const file = await admin.storage.from(SECRETS_BUCKET).download(data.secret_ref);
  if (file.error || !file.data) {
    throw new ApuracaoGatewayError("no_credential", "Não foi possível ler a chave de API cadastrada.");
  }
  const raw = new Uint8Array(await file.data.arrayBuffer());
  const plain = new TextDecoder().decode(await unsealSecret(raw));
  return { id: data.id as string, apiKey: plain.trim() };
}

/**
 * Fluxo oficial (Manual RTC / apuracao-cbs v1):
 *   POST {base}/token                              -> access_token (client_credentials)
 *   POST {base}/rtc/apuracao-cbs/v1/{cnpj8}        -> 201 { tiquete }   (2 chamadas/dia)
 *   GET  {base}/rtc/download/v1/{tiqueteDownload}  -> 200 JSON do extrato (1 acesso por tíquete)
 * A credencial do contribuinte é <CLIENT_ID>:<CLIENT_SECRET> e vira Basic no
 * endpoint de token. Nem a credencial nem o token vão para log.
 */

function base64(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Formas de autenticar no /token aceitas por servidores OAuth. A Receita não
 * documenta qual usa — o manual só diz "[user] clientID e clientSecret" — e
 * `invalid_client` chega igual nas três. Como o /token NÃO consome a cota de 2
 * consultas por dia (o limite é dos endpoints de apuração), sai mais barato
 * tentar em ordem do que adivinhar.
 *
 *  - `basic`     cabeçalho Basic com id:secret cru. É o mais comum.
 *  - `basic_rfc` idem, mas com id e secret escapados antes do base64, como
 *                manda a RFC 6749 §2.3.1. Muda o resultado quando o secret tem
 *                `+`, `/`, `=` ou `%` — e aí o modo cru falha com invalid_client.
 *  - `corpo`     credenciais como campos do formulário, sem cabeçalho.
 */
const MODOS_AUTH = ["basic", "basic_rfc", "corpo"] as const;
export type ModoAuth = (typeof MODOS_AUTH)[number];

/** Escape de formulário exigido pela RFC 6749 antes do base64. */
function escapeForm(valor: string): string {
  return encodeURIComponent(valor).replace(/%20/g, "+");
}

function requisicaoToken(
  credential: string,
  modo: ModoAuth,
): { headers: Record<string, string>; body: string } {
  const corte = credential.indexOf(":");
  const id = corte >= 0 ? credential.slice(0, corte) : credential;
  const secret = corte >= 0 ? credential.slice(corte + 1) : "";
  const form = new URLSearchParams({ grant_type: "client_credentials" });

  if (modo === "corpo") {
    form.set("client_id", id);
    form.set("client_secret", secret);
    return {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    };
  }

  const par = modo === "basic_rfc" ? `${escapeForm(id)}:${escapeForm(secret)}` : credential;
  return {
    headers: {
      Authorization: `Basic ${base64(par)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  };
}

/**
 * Descreve o FORMATO do material guardado sem revelar nada dele. Serve para
 * separar "a chave está errada" de "a chave está com a forma errada" — por
 * exemplo, colada sem o `:`, ou com quebra de linha vinda de um copiar/colar.
 */
export type FormatoCredencial = {
  separadores: number;
  tam_id: number;
  tam_secret: number;
  precisa_escape: boolean;
  tem_espaco_ou_quebra: boolean;
};

function formatoCredencial(credential: string): FormatoCredencial {
  const corte = credential.indexOf(":");
  const id = corte >= 0 ? credential.slice(0, corte) : credential;
  const secret = corte >= 0 ? credential.slice(corte + 1) : "";
  return {
    separadores: (credential.match(/:/g) ?? []).length,
    tam_id: id.length,
    tam_secret: secret.length,
    precisa_escape: /[+/=%&\s]/.test(id) || /[+/=%&\s]/.test(secret),
    tem_espaco_ou_quebra: /\s/.test(credential),
  };
}

function transporte(error: unknown, etapa: string): ApuracaoGatewayError {
  const category =
    error instanceof DOMException && error.name === "AbortError"
      ? "timeout"
      : error instanceof TypeError
        ? "network"
        : "unknown";
  console.error("[rtc-apuracao] falha de transporte", { etapa, category });
  return new ApuracaoGatewayError(
    "unreachable",
    "Não foi possível falar com o serviço de apuração da Receita.",
  );
}

/**
 * Diagnóstico das chamadas que antecedem o download (token e solicitação).
 * Existe pelo mesmo motivo do `DownloadDiag`: uma recusa precisa ser explicada
 * sem gastar outra consulta da cota diária. Guardado em `rtc_apuracao.chamada_diag`.
 *
 * O recorte do corpo só é preenchido em FALHA — a resposta de sucesso do token
 * contém o próprio access_token e nunca pode ser persistida nem logada.
 */
export type ChamadaDiag = {
  etapa: "token" | "solicitar";
  status: number | null;
  ok: boolean;
  headers: Record<string, string>;
  corpo_recorte?: string;
  /** Modo de autenticação que produziu esta resposta (só na etapa do token). */
  modo_auth?: ModoAuth;
  /** Resultado de cada modo tentado, para o erro dizer o que já foi descartado. */
  tentativas?: Array<{ modo: ModoAuth; status: number | null; erro?: string }>;
  formato_credencial?: FormatoCredencial;
  em: string;
};

/** Erro que carrega o diagnóstico da etapa em que morreu. */
type ErroComDiag = ApuracaoGatewayError & { chamada?: ChamadaDiag };

function comDiag(err: ApuracaoGatewayError, chamada: ChamadaDiag): ErroComDiag {
  const e = err as ErroComDiag;
  e.chamada = chamada;
  return e;
}

/** Troca a credencial pelo access_token. Falha aqui NÃO consome cota de apuração. */
async function accessToken(credential: string): Promise<{ token: string; diag: ChamadaDiag }> {
  const url = tokenUrl();
  if (!url) {
    throw new ApuracaoGatewayError(
      "not_configured",
      "Ambiente sem endereço da API da Receita configurado (RTC_API_URL).",
    );
  }

  // `RTC_TOKEN_AUTH` fixa o modo quando ele já for conhecido; sem ela, tenta os
  // três em ordem. Só a falha de AUTENTICAÇÃO faz cair para o próximo — erro de
  // rede ou 5xx aborta na hora, para não repetir chamada sem sentido.
  const fixado = (process.env["RTC_TOKEN_AUTH"] ?? "").trim() as ModoAuth;
  const modos = MODOS_AUTH.includes(fixado) ? [fixado] : [...MODOS_AUTH];

  const tentativas: Array<{ modo: ModoAuth; status: number | null; erro?: string }> = [];
  let ultimo: { diag: ChamadaDiag; erro: ApuracaoGatewayError } | null = null;

  for (const modo of modos) {
    const { headers, body } = requisicaoToken(credential, modo);
    let res: Response;
    try {
      res = await withTimeout((signal) => fetch(url, { method: "POST", headers, body, signal }));
    } catch (error) {
      throw transporte(error, "token");
    }
    const text = await res.text();
    const diag: ChamadaDiag = {
      etapa: "token",
      status: res.status,
      ok: res.ok,
      headers: headersDiag(res),
      modo_auth: modo,
      formato_credencial: formatoCredencial(credential),
      em: new Date().toISOString(),
    };

    if (res.ok) {
      let token: string | undefined;
      try {
        token = (JSON.parse(text) as { access_token?: string }).access_token;
      } catch {
        token = undefined;
      }
      if (token) {
        // Sucesso: NUNCA guardar o corpo — ele contém o próprio access_token.
        tentativas.push({ modo, status: res.status });
        diag.tentativas = tentativas;
        console.info("[rtc-apuracao] token obtido", { modo });
        return { token, diag };
      }
      // 200 sem access_token: o corpo não traz token para vazar e é a única
      // pista de que o formato da resposta mudou.
      diag.corpo_recorte = text.slice(0, 1000);
      diag.tentativas = tentativas;
      throw comDiag(
        new ApuracaoGatewayError("error", "A Receita devolveu um token inesperado."),
        diag,
      );
    }

    // O corpo do erro é o que distingue "credencial vencida" de "pedido mal
    // formado" — os dois chegam como 4xx e sem isto viram o mesmo "HTTP 400".
    diag.corpo_recorte = text.slice(0, 1000);
    const detalhe = (corpoJson(text)?.["error"] as string | undefined) ?? `HTTP ${res.status}`;
    tentativas.push({ modo, status: res.status, erro: detalhe });
    console.error("[rtc-apuracao] token recusado", { modo, status: res.status, detalhe });

    const autenticacao = res.status === 400 || res.status === 401 || res.status === 403;
    const erro = new ApuracaoGatewayError(
      "no_credential",
      autenticacao
        ? "A Receita recusou a credencial cadastrada (client_id/client_secret). Consulta não realizada."
        : `Não foi possível obter o token de acesso da Receita (HTTP ${res.status}).`,
    );
    ultimo = { diag, erro };
    if (!autenticacao) break;
  }

  const final = ultimo as { diag: ChamadaDiag; erro: ApuracaoGatewayError };
  final.diag.tentativas = tentativas;
  throw comDiag(final.erro, final.diag);
}

function corpoJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = text ? JSON.parse(text) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function erroDaReceita(status: number, body: Record<string, unknown> | null): ApuracaoGatewayError {
  const detalhe =
    (body?.["mensagemErro"] as string | undefined) ??
    (body?.["mensagem"] as string | undefined) ??
    (body?.["message"] as string | undefined) ??
    `HTTP ${status}`;
  return new ApuracaoGatewayError("error", `A Receita recusou a chamada: ${detalhe}`, status);
}

/** Passo 1: solicita a apuração de débitos da CBS informando o webhook de retorno. */
async function solicitarNaReceita(
  cnpj: string,
  urlRetorno: string,
  token: string,
): Promise<{ body: Record<string, unknown>; diag: ChamadaDiag }> {
  const base = apiBase();
  if (!base) {
    throw new ApuracaoGatewayError(
      "not_configured",
      "Ambiente sem endereço da API da Receita configurado (RTC_API_URL).",
    );
  }
  // O endpoint filtra pelo CNPJ básico (8 dígitos, com zeros à esquerda).
  const cnpj8 = cnpj.replace(/\D/g, "").slice(0, 8).padStart(8, "0");
  let res: Response;
  try {
    res = await withTimeout((signal) =>
      fetch(`${base}/${apiPrefix()}/apuracao-cbs/v1/${cnpj8}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ urlRetorno }),
        signal,
      }),
    );
  } catch (error) {
    throw transporte(error, "solicitar");
  }
  const text = await res.text();
  const body = corpoJson(text);
  // Esta é a chamada que consome a cota: o corpo fica guardado em sucesso e em
  // falha, porque repetir para descobrir o motivo custa uma das 2 do dia.
  const diag: ChamadaDiag = {
    etapa: "solicitar",
    status: res.status,
    ok: res.ok,
    headers: headersDiag(res),
    corpo_recorte: text.slice(0, 1000),
    em: new Date().toISOString(),
  };
  if (res.status !== 201 && !res.ok) throw comDiag(erroDaReceita(res.status, body), diag);
  return { body: body ?? {}, diag };
}

/**
 * Diagnóstico técnico da resposta de download. Guardado no banco para que uma
 * falha possa ser explicada sem gastar outra consulta da cota diária. Não
 * carrega credencial nem token — só metadados da resposta.
 */
export type DownloadDiag = {
  status: number | null;
  ok: boolean;
  caminho_token: "guardado" | "novo";
  headers: Record<string, string>;
  corpo_recorte?: string;
  em: string;
};

/** Cabeçalhos úteis para diagnóstico (nunca a nossa Authorization). */
const HEADERS_DIAG = [
  "content-type",
  "content-length",
  "date",
  "x-request-id",
  "x-correlation-id",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "retry-after",
  "www-authenticate",
];

function headersDiag(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of HEADERS_DIAG) {
    const value = res.headers.get(name);
    if (value) out[name] = value.slice(0, 200);
  }
  return out;
}

/** Passo 3: baixa o JSON do extrato. Um único acesso por tíquete. */
async function baixarNaReceita(
  tiquete: string,
  token: string,
  caminhoToken: "guardado" | "novo",
): Promise<{ body: Record<string, unknown>; diag: DownloadDiag }> {
  const base = apiBase();
  if (!base) {
    throw new ApuracaoGatewayError(
      "not_configured",
      "Ambiente sem endereço da API da Receita configurado (RTC_API_URL).",
    );
  }
  let res: Response;
  try {
    res = await withTimeout((signal) =>
      fetch(`${base}/${apiPrefix()}/download/v1/${encodeURIComponent(tiquete)}`, {
        method: "GET",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        signal,
      }),
    );
  } catch (error) {
    throw transporte(error, "download");
  }
  const text = await res.text();
  const body = corpoJson(text);
  const diag: DownloadDiag = {
    status: res.status,
    ok: res.ok,
    caminho_token: caminhoToken,
    headers: headersDiag(res),
    em: new Date().toISOString(),
  };
  if (!res.ok) {
    // Recorte do corpo de erro: é o que explica a recusa sem gastar cota.
    diag.corpo_recorte = text.slice(0, 1000);
    const err = erroDaReceita(res.status, body) as ApuracaoGatewayError & { diag?: DownloadDiag };
    err.diag = diag;
    throw err;
  }
  if (!body) {
    diag.corpo_recorte = text.slice(0, 1000);
    const err = new ApuracaoGatewayError(
      "error",
      "A Receita devolveu um corpo inesperado.",
    ) as ApuracaoGatewayError & { diag?: DownloadDiag };
    err.diag = diag;
    throw err;
  }
  return { body, diag };
}

/**
 * Acumula o diagnóstico das etapas anteriores ao download em `chamada_diag`,
 * sob a chave da etapa. Escreve por merge para o diagnóstico da solicitação não
 * apagar o do token quando as duas rodam na mesma tentativa.
 */
async function gravarChamada(
  admin: AdminClient,
  apuracaoId: string,
  diag: ChamadaDiag | undefined,
) {
  if (!diag) return;
  console.info("[rtc-apuracao] chamada", {
    apuracao: apuracaoId,
    etapa: diag.etapa,
    status: diag.status,
    ok: diag.ok,
  });
  const { data } = await table(admin, "rtc_apuracao")
    .select("chamada_diag")
    .eq("id", apuracaoId)
    .maybeSingle();
  const atual = (data?.chamada_diag ?? {}) as Record<string, unknown>;
  await table(admin, "rtc_apuracao")
    .update({ chamada_diag: { ...atual, [diag.etapa]: diag } })
    .eq("id", apuracaoId);
}

async function gravarDiag(admin: AdminClient, apuracaoId: string, diag: DownloadDiag | undefined) {
  if (!diag) return;
  console.info("[rtc-apuracao] download", {
    apuracao: apuracaoId,
    status: diag.status,
    ok: diag.ok,
    caminho_token: diag.caminho_token,
  });
  await table(admin, "rtc_apuracao").update({ download_diag: diag }).eq("id", apuracaoId);
}


async function logUse(
  admin: AdminClient,
  credentialId: string,
  finalidade: string,
  sucesso: boolean,
  detalhe?: string,
) {
  await rpc(admin)("log_credential_use", {
    p_credential: credentialId,
    p_finalidade: finalidade,
    p_sucesso: sucesso,
    p_worker: "app",
    p_detalhe: detalhe ?? null,
  });
}

/**
 * IMPORTANTE: nunca destacar `admin.rpc` / `admin.from` da instância — o cliente
 * é um Proxy e o método perde o `this` (erro "Cannot read properties of
 * undefined (reading 'rest')"). Sempre chamar através do objeto.
 */
const rpc =
  (admin: AdminClient) =>
  (fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> =>
    (admin.rpc as unknown as (f: string, a: Record<string, unknown>) => any).call(admin, fn, args);

const table = (admin: AdminClient, name: string): any =>
  (admin.from as unknown as (t: string) => any).call(admin, name);

async function marcarErro(admin: AdminClient, id: string, motivo: string) {
  await table(admin, "rtc_apuracao")
    .update({ status: "erro", erro: motivo.slice(0, 400) })
    .eq("id", id);
}

function tokenPath(tenantId: string, apuracaoId: string): string {
  return `secrets/${tenantId}/rtc-session/${apuracaoId}.enc`;
}

async function guardarToken(
  admin: AdminClient,
  tenantId: string,
  apuracaoId: string,
  token: string,
): Promise<string> {
  const { SECRETS_BUCKET } = await import("@/lib/credentials.server");
  const ref = tokenPath(tenantId, apuracaoId);
  const blob = await sealSecret(token);
  const stored = await admin.storage.from(SECRETS_BUCKET).upload(ref, blob, {
    contentType: "application/octet-stream",
    upsert: true,
  });
  if (stored.error) throw new Error(stored.error.message);
  const saved = await table(admin, "rtc_apuracao").update({ access_token_ref: ref }).eq("id", apuracaoId);
  if (saved.error) {
    await admin.storage.from(SECRETS_BUCKET).remove([ref]);
    throw new Error(saved.error.message);
  }
  return ref;
}

async function lerToken(admin: AdminClient, ref: string): Promise<string> {
  const { SECRETS_BUCKET } = await import("@/lib/credentials.server");
  const file = await admin.storage.from(SECRETS_BUCKET).download(ref);
  if (file.error || !file.data) throw new Error("Token temporário da solicitação não encontrado.");
  const raw = new Uint8Array(await file.data.arrayBuffer());
  return new TextDecoder().decode(await unsealSecret(raw));
}

async function apagarToken(admin: AdminClient, apuracaoId: string, ref: string | null | undefined) {
  if (!ref) return;
  const { SECRETS_BUCKET } = await import("@/lib/credentials.server");
  await admin.storage.from(SECRETS_BUCKET).remove([ref]);
  await table(admin, "rtc_apuracao").update({ access_token_ref: null }).eq("id", apuracaoId);
}

/**
 * Só existe consulta quando a Receita responde — erro ou sucesso. Se a tentativa
 * morreu antes disso (sem credencial, ambiente não configurado, serviço fora do
 * ar), a cota diária é devolvida: o contador da Receita também não contou.
 */
function consumiuCotaDaReceita(reason: GatewayUnavailableReason | undefined): boolean {
  return reason === "error";
}

async function estornarCota(admin: AdminClient, cnpj: string, reason?: GatewayUnavailableReason) {
  if (consumiuCotaDaReceita(reason)) return;
  await rpc(admin)("rtc_quota_estornar", { p_cnpj: cnpj, p_kind: "solicitacao" });
}

/* ------------------------------------------------------------ passo 1 */

export type SolicitarResult =
  | { ok: true; id: string; competencia: string }
  | { ok: false; motivo: string; reason?: GatewayUnavailableReason };

/**
 * Registra a solicitação (debita cota, gera o segredo do webhook) e chama a
 * Receita já com a URL de retorno deste ambiente. Se a chamada externa falhar,
 * a linha vira `erro` na hora — nada fica em "solicitada" para sempre.
 */
export async function solicitarApuracao(
  tenantId: string,
  competencia: string,
  origin: string,
  origem = "manual",
): Promise<SolicitarResult> {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

  const { data, error } = await rpc(admin)("rtc_apuracao_solicitar", {
    p_tenant: tenantId,
    p_competencia: competencia,
    p_origem: origem,
  });
  if (error) return { ok: false, motivo: error.message };

  const row = (data ?? {}) as {
    ok?: boolean;
    motivo?: string;
    id?: string;
    webhook_ref?: string;
    cnpj8?: string;
  };
  if (!row.ok || !row.id || !row.webhook_ref) {
    return { ok: false, motivo: row.motivo ?? "Não foi possível registrar a solicitação." };
  }

  const { data: tenant } = await table(admin, "tenants")
    .select("cnpj")
    .eq("id", tenantId)
    .maybeSingle();
  const cnpj = String(tenant?.cnpj ?? "").replace(/\D/g, "");

  let credential: Credential;
  try {
    credential = await loadApiKey(admin, tenantId);
  } catch (e) {
    const err = e as ApuracaoGatewayError;
    await marcarErro(admin, row.id, err.message);
    // Falha de credencial: a Receita nem foi chamada — devolve a cota.
    await estornarCota(admin, cnpj, err.reason ?? "no_credential");
    return { ok: false, motivo: err.message, reason: err.reason ?? "error" };
  }

  const urlRetorno = `${origin.replace(/\/+$/, "")}/api/public/rtc/apuracao/${row.webhook_ref}`;
  let tokenRef: string | null = null;

  try {
    // O download pertence à mesma solicitação OAuth. Guardamos o access token
    // cifrado antes do POST para o webhook nunca chegar antes desse vínculo.
    const { token, diag: diagToken } = await accessToken(credential.apiKey);
    await gravarChamada(admin, row.id, diagToken);
    tokenRef = await guardarToken(admin, tenantId, row.id, token);
    const { body: resposta, diag: diagSolicitar } = await solicitarNaReceita(
      cnpj,
      urlRetorno,
      token,
    );
    await gravarChamada(admin, row.id, diagSolicitar);

    await logUse(admin, credential.id, "apuracao.solicitar", true);

    // Alguns ambientes devolvem o tíquete já na resposta; se vier, adianta o passo 2.
    const tiquete =
      (resposta["tiqueteDownload"] as string | undefined) ??
      (resposta["tiquete"] as string | undefined);
    if (tiquete) {
      await rpc(admin)("rtc_apuracao_receber_tiquete", {
        p_ref: row.webhook_ref,
        p_payload: resposta,
      });
      void processarApuracao(row.id).catch(() => undefined);
    }
    return { ok: true, id: row.id, competencia };
  } catch (e) {
    const err = e as ErroComDiag;
    // Grava o diagnóstico ANTES de marcar o erro: é ele que explica a recusa
    // sem custar outra consulta da cota diária.
    await gravarChamada(admin, row.id, err.chamada);
    await logUse(admin, credential.id, "apuracao.solicitar", false, err.message);
    await marcarErro(admin, row.id, err.message);
    await apagarToken(admin, row.id, tokenRef);
    await estornarCota(admin, cnpj, err.reason);
    return { ok: false, motivo: err.message, reason: err.reason ?? "error" };
  }
}

export type TesteCredencialResult = {
  ok: boolean;
  status: number | null;
  mensagem: string;
  headers?: Record<string, string>;
  corpo_recorte?: string;
  modo_auth?: ModoAuth;
  tentativas?: Array<{ modo: ModoAuth; status: number | null; erro?: string }>;
  formato_credencial?: FormatoCredencial;
  em: string;
};

const MODO_LABEL: Record<ModoAuth, string> = {
  basic: "credenciais no cabeçalho",
  basic_rfc: "credenciais no cabeçalho, com escape",
  corpo: "credenciais no corpo",
};

/**
 * Prova a credencial rodando SÓ o passo 1 (token). Não cria apuração, não
 * debita cota e não chama o endpoint de apuração — o limite de 2 consultas por
 * dia é dos endpoints de apuração, não do /token. Serve para descobrir por que
 * o acesso é recusado antes de gastar uma das duas.
 *
 * Nunca devolve o access_token: em sucesso, só confirma que ele veio.
 */
export async function testarCredencial(tenantId: string): Promise<TesteCredencialResult> {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const em = new Date().toISOString();

  let credential: Credential;
  try {
    credential = await loadApiKey(admin, tenantId);
  } catch (e) {
    const err = e as ApuracaoGatewayError;
    return { ok: false, status: null, mensagem: err.message, em };
  }

  try {
    const { diag } = await accessToken(credential.apiKey);
    await logUse(
      admin,
      credential.id,
      "apuracao.token_teste",
      true,
      `modo=${diag.modo_auth ?? "?"}`,
    );
    const como = diag.modo_auth ? ` Funcionou com ${MODO_LABEL[diag.modo_auth]}.` : "";
    return {
      ok: true,
      status: 200,
      mensagem: `Credencial aceita pela Receita. O acesso foi obtido e vale por 1 hora.${como}`,
      ...(diag.modo_auth ? { modo_auth: diag.modo_auth } : {}),
      ...(diag.tentativas ? { tentativas: diag.tentativas } : {}),
      em,
    };
  } catch (e) {
    const err = e as ErroComDiag;
    await logUse(admin, credential.id, "apuracao.token_teste", false, err.message);
    // `exactOptionalPropertyTypes`: campo ausente e campo com valor vazio não
    // são a mesma coisa aqui — só inclui o que existe.
    return {
      ok: false,
      status: err.chamada?.status ?? null,
      mensagem: err.message,
      ...(err.chamada?.headers ? { headers: err.chamada.headers } : {}),
      ...(err.chamada?.corpo_recorte ? { corpo_recorte: err.chamada.corpo_recorte } : {}),
      ...(err.chamada?.tentativas ? { tentativas: err.chamada.tentativas } : {}),
      ...(err.chamada?.formato_credencial
        ? { formato_credencial: err.chamada.formato_credencial }
        : {}),
      em,
    };
  }
}

/* ------------------------------------------------------------ passo 3 */

export type ProcessarResult =
  | { ok: true; id: string; debitos: number }
  | { ok: false; id: string; motivo: string };

/** Baixa o JSON com o tíquete e chama a ingestão. Idempotente por apuração. */
export async function processarApuracao(apuracaoId: string): Promise<ProcessarResult> {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

  const { data: row, error } = await table(admin, "rtc_apuracao")
    .select("id, tenant_id, competencia, status, tiquete_download, access_token_ref, payload")
    .eq("id", apuracaoId)
    .maybeSingle();
  if (error) return { ok: false, id: apuracaoId, motivo: error.message };
  if (!row) return { ok: false, id: apuracaoId, motivo: "Apuração inexistente." };
  if (row.status === "disponivel") return { ok: true, id: apuracaoId, debitos: 0 };
  if (!row.tiquete_download && !row.payload) {
    return { ok: false, id: apuracaoId, motivo: "Tíquete de download ainda não recebido." };
  }

  // O download é identificado só pelo tíquete (um acesso por tíquete) e exige
  // apenas um Bearer válido — o manual não vincula o tíquete ao token da
  // solicitação. Como o token de client_credentials expira (~1h) e o fluxo é
  // assíncrono, o token guardado pode estar vencido quando o webhook chega.
  // Por isso: sem token guardado OU 401 no download, pega token novo e tenta
  // UMA vez. O download não consome cota de solicitação.

  let payload = row.payload as Record<string, unknown> | null;
  if (!payload) {
    let credential: Credential;
    try {
      credential = await loadApiKey(admin, row.tenant_id as string);
    } catch (e) {
      const err = e as ApuracaoGatewayError;
      await marcarErro(admin, apuracaoId, err.message);
      return { ok: false, id: apuracaoId, motivo: err.message };
    }

    const tiquete = String(row.tiquete_download);
    let diag: DownloadDiag | undefined;
    try {
      let resultado: { body: Record<string, unknown>; diag: DownloadDiag } | null = null;

      if (row.access_token_ref) {
        try {
          const guardado = await lerToken(admin, row.access_token_ref as string);
          resultado = await baixarNaReceita(tiquete, guardado, "guardado");
        } catch (e) {
          const err = e as ApuracaoGatewayError & { diag?: DownloadDiag };
          diag = err.diag;
          const expirado = err.status === 401 || err.status === 403;
          // Só o 401/403 justifica um token novo. Outros erros (429, 5xx) são
          // do serviço e repetir não ajuda.
          if (!expirado) throw err;
          console.info("[rtc-apuracao] token guardado recusado, tentando token novo", {
            apuracao: apuracaoId,
            status: err.status,
          });
        }
      }

      if (!resultado) {
        const { token: novo, diag: diagToken } = await accessToken(credential.apiKey);
        await gravarChamada(admin, apuracaoId, diagToken);
        resultado = await baixarNaReceita(tiquete, novo, "novo");
      }

      payload = resultado.body;
      diag = resultado.diag;
      await gravarDiag(admin, apuracaoId, diag);
      await logUse(
        admin,
        credential.id,
        "apuracao.download",
        true,
        `token=${diag.caminho_token}`,
      );
      // O tíquete só permite um download: persiste o JSON bruto ANTES de parsear.
      const saved = await table(admin, "rtc_apuracao")
        .update({ payload, download_em: new Date().toISOString() })
        .eq("id", apuracaoId);
      if (saved.error) throw new Error(saved.error.message);
      await apagarToken(admin, apuracaoId, row.access_token_ref as string | null);
    } catch (e) {
      const err = e as ApuracaoGatewayError & { diag?: DownloadDiag; chamada?: ChamadaDiag };
      await gravarDiag(admin, apuracaoId, err.diag ?? diag);
      // A renovação do acesso acontece dentro deste mesmo try: se foi ela que
      // falhou, o motivo está em `chamada`, não em `diag`.
      await gravarChamada(admin, apuracaoId, err.chamada);
      await logUse(admin, credential.id, "apuracao.download", false, err.message);
      await marcarErro(admin, apuracaoId, `Download da apuração: ${err.message}`);
      return { ok: false, id: apuracaoId, motivo: err.message };
    }
  }

  const { data: ingested, error: ingestError } = await rpc(admin)("rtc_apuracao_ingest_json", {
    p_apuracao: apuracaoId,
    p_json: payload,
  });
  if (ingestError) {
    await marcarErro(admin, apuracaoId, `Falha ao gravar a apuração: ${ingestError.message}`);
    return { ok: false, id: apuracaoId, motivo: ingestError.message };
  }

  const debitos = Number((ingested as { debitos?: number } | null)?.debitos ?? 0);
  return { ok: true, id: apuracaoId, debitos };
}

/** Fila de recuperação: tíquetes recebidos que ainda não foram baixados. */
export async function processarPendentes(tenantId?: string): Promise<ProcessarResult[]> {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await rpc(admin)("rtc_apuracao_pendentes_download", {});
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as Array<{ id: string; tenant_id: string }>).filter(
    (row) => !tenantId || row.tenant_id === tenantId,
  );
  const out: ProcessarResult[] = [];
  for (const r of rows) out.push(await processarApuracao(r.id));
  return out;
}

export function gatewayConfigured(): boolean {
  return apiBase() !== null;
}

