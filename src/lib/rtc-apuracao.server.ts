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

function basicAuth(credential: string): string {
  const bytes = new TextEncoder().encode(credential);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
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

/** Troca a credencial pelo access_token. Falha aqui NÃO consome cota de apuração. */
async function accessToken(credential: string): Promise<string> {
  const url = tokenUrl();
  if (!url) {
    throw new ApuracaoGatewayError(
      "not_configured",
      "Ambiente sem endereço da API da Receita configurado (RTC_API_URL).",
    );
  }
  let res: Response;
  try {
    res = await withTimeout((signal) =>
      fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth(credential)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal,
      }),
    );
  } catch (error) {
    throw transporte(error, "token");
  }
  const text = await res.text();
  if (!res.ok) {
    console.error("[rtc-apuracao] token recusado", { status: res.status });
    throw new ApuracaoGatewayError(
      "no_credential",
      res.status === 401 || res.status === 403
        ? "A Receita recusou a credencial cadastrada (client_id/client_secret). Consulta não realizada."
        : `Não foi possível obter o token de acesso da Receita (HTTP ${res.status}).`,
    );
  }
  let token: string | undefined;
  try {
    token = (JSON.parse(text) as { access_token?: string }).access_token;
  } catch {
    token = undefined;
  }
  if (!token) {
    throw new ApuracaoGatewayError("error", "A Receita devolveu um token inesperado.");
  }
  return token;
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
): Promise<Record<string, unknown>> {
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
  const body = corpoJson(await res.text());
  if (res.status !== 201 && !res.ok) throw erroDaReceita(res.status, body);
  return body ?? {};
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
    const token = await accessToken(credential.apiKey);
    tokenRef = await guardarToken(admin, tenantId, row.id, token);
    const resposta = await solicitarNaReceita(cnpj, urlRetorno, token);

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
    const err = e as ApuracaoGatewayError;
    await logUse(admin, credential.id, "apuracao.solicitar", false, err.message);
    await marcarErro(admin, row.id, err.message);
    await apagarToken(admin, row.id, tokenRef);
    await estornarCota(admin, cnpj, err.reason);
    return { ok: false, motivo: err.message, reason: err.reason ?? "error" };
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
        const novo = await accessToken(credential.apiKey);
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
      const err = e as ApuracaoGatewayError & { diag?: DownloadDiag };
      await gravarDiag(admin, apuracaoId, err.diag ?? diag);
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

