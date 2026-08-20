/**
 * APURAÇÃO DA CBS — passos 1 e 3 do fluxo, agora DENTRO do aplicativo.
 *
 * O fluxo da Receita tem três passos:
 *   1. POST solicitação (leva `urlRetorno`)  -> este arquivo
 *   2. a Receita chama nosso webhook com {tiqueteSolicitacao, tiqueteDownload}
 *      -> src/routes/api/public/rtc.apuracao.$ref.tsx
 *   3. GET/POST download do JSON usando o tíquete e ingestão -> este arquivo
 *
 * Por que o app e não um worker externo: os passos 1 e 3 são HTTP + JSON e não
 * precisam guardar estado. O único motivo para existir máquina fora era o TLS
 * mútuo com certificado — que continua no componente oficial hospedado na nossa
 * infra (RTC_APURACAO_URL / RTC_CALC_URL), usado aqui como PROXY de transporte.
 * O aplicativo passou a ser o orquestrador: nada fica pendurado esperando um
 * processo externo rodar.
 *
 * REGRA DO PROJETO PRESERVADA: nenhum valor fiscal é produzido aqui. Este módulo
 * só transporta e grava o que a Receita devolveu. Motor fora do ar => erro
 * explícito, nunca número estimado.
 */

import { unsealSecret } from "@/lib/credentials.server";

const TIMEOUT_MS = 45_000;

export type GatewayUnavailableReason = "not_configured" | "no_credential" | "unreachable" | "error";

export class ApuracaoGatewayError extends Error {
  constructor(
    public readonly reason: GatewayUnavailableReason,
    message: string,
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

function baseUrl(): string | null {
  // Uma variável antiga ou preenchida incorretamente não pode bloquear o
  // gateway compartilhado válido. A URL dedicada continua tendo prioridade
  // quando é uma URL HTTP(S) real; caso contrário, usamos RTC_CALC_URL.
  return (
    validHttpBaseUrl(process.env["RTC_APURACAO_URL"]) ??
    validHttpBaseUrl(process.env["RTC_CALC_URL"])
  );
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

async function callGateway(
  path: string,
  body: Record<string, unknown>,
  apiKey: string,
): Promise<Record<string, unknown>> {
  const url = baseUrl();
  if (!url) {
    throw new ApuracaoGatewayError(
      "not_configured",
      "Integração de apuração não configurada neste ambiente (RTC_APURACAO_URL).",
    );
  }
  // Dois segredos DIFERENTES e não intercambiáveis:
  //  - X-Api-Key: chave do proxy que protege o serviço na nossa infra
  //    (RTC_APURACAO_API_KEY, caindo para RTC_CALC_API_KEY no gateway compartilhado).
  //    Mandar a credencial do contribuinte aqui devolvia HTTP 401 do proxy.
  //  - X-Rtc-Credential: credencial do contribuinte (<CLIENT_ID>:<CLIENT_SECRET>)
  //    que o serviço usa para falar com a Receita. Nenhuma das duas vai para log.
  const proxyKey = process.env["RTC_APURACAO_API_KEY"] ?? process.env["RTC_CALC_API_KEY"] ?? "";
  let res: Response;
  try {
    res = await withTimeout((signal) =>
      fetch(`${url}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(proxyKey ? { "X-Api-Key": proxyKey } : {}),
          "X-Rtc-Credential": apiKey,
        },
        body: JSON.stringify(body),
        signal,
      }),
    );
  } catch (error) {
    const category =
      error instanceof DOMException && error.name === "AbortError"
        ? "timeout"
        : error instanceof TypeError
          ? "network"
          : "unknown";
    console.error("[rtc-apuracao] falha de transporte", { path, category });
    throw new ApuracaoGatewayError(
      "unreachable",
      "Não foi possível falar com o serviço de apuração da Receita.",
    );
  }
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    // 404/501: o destino configurado não expõe apuração (é só a calculadora).
    // Isso é falha de configuração nossa — a Receita nem foi consultada, então
    // não pode ser tratado como erro dela nem consumir cota.
    if (res.status === 404 || res.status === 501) {
      console.error("[rtc-apuracao] endpoint ausente no destino configurado", { path, status: res.status });
      throw new ApuracaoGatewayError(
        "not_configured",
        "O serviço configurado neste ambiente não expõe a apuração da Receita (RTC_APURACAO_URL aponta para a calculadora). Consulta não realizada.",
      );
    }
    if (res.status === 401 || res.status === 403) {
      console.error("[rtc-apuracao] destino recusou a autenticação", { path, status: res.status });
      throw new ApuracaoGatewayError(
        "not_configured",
        "O serviço de apuração recusou a autenticação do ambiente (chave do proxy inválida). Consulta não realizada.",
      );
    }
    const detail =
      (parsed as { mensagem?: string; message?: string } | null)?.mensagem ??
      (parsed as { message?: string } | null)?.message ??
      `HTTP ${res.status}`;
    throw new ApuracaoGatewayError("error", `A Receita recusou a chamada: ${detail}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApuracaoGatewayError("error", "A Receita devolveu um corpo inesperado.");
  }

  return parsed as Record<string, unknown>;
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

  try {
    const resposta = await callGateway(
      "/api/apuracao/solicitar",
      {
        cnpj,
        competencia: competencia.slice(0, 7).replace("-", ""),
        urlRetorno,
      },
      credential.apiKey,
    );
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
    .select("id, tenant_id, competencia, status, tiquete_download")
    .eq("id", apuracaoId)
    .maybeSingle();
  if (error) return { ok: false, id: apuracaoId, motivo: error.message };
  if (!row) return { ok: false, id: apuracaoId, motivo: "Apuração inexistente." };
  if (row.status === "disponivel") return { ok: true, id: apuracaoId, debitos: 0 };
  if (!row.tiquete_download) {
    return { ok: false, id: apuracaoId, motivo: "Tíquete de download ainda não recebido." };
  }

  const { data: tenant } = await table(admin, "tenants")
    .select("cnpj")
    .eq("id", row.tenant_id)
    .maybeSingle();
  const cnpj = String(tenant?.cnpj ?? "").replace(/\D/g, "");

  let credential: Credential;
  try {
    credential = await loadApiKey(admin, row.tenant_id as string);
  } catch (e) {
    const err = e as ApuracaoGatewayError;
    await marcarErro(admin, apuracaoId, err.message);
    return { ok: false, id: apuracaoId, motivo: err.message };
  }

  let payload: Record<string, unknown>;
  try {
    payload = await callGateway(
      "/api/apuracao/download",
      { cnpj, tiquete: row.tiquete_download, competencia: String(row.competencia).slice(0, 7).replace("-", "") },
      credential.apiKey,
    );
    await logUse(admin, credential.id, "apuracao.download", true);
  } catch (e) {
    const err = e as ApuracaoGatewayError;
    await logUse(admin, credential.id, "apuracao.download", false, err.message);
    await marcarErro(admin, apuracaoId, err.message);
    return { ok: false, id: apuracaoId, motivo: err.message };
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
export async function processarPendentes(): Promise<ProcessarResult[]> {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await rpc(admin)("rtc_apuracao_pendentes_download", {});
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: string }>;
  const out: ProcessarResult[] = [];
  for (const r of rows) out.push(await processarApuracao(r.id));
  return out;
}

export function gatewayConfigured(): boolean {
  return apiBase() !== null;
}

