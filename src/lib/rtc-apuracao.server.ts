/**
 * APURAÇÃO DA CBS — passos 1 e 3 do fluxo, agora DENTRO do aplicativo.
 *
 * O fluxo da Receita tem três passos:
 *   1. POST solicitação (leva `urlRetorno`)  -> este arquivo
 *   2. a Receita chama nosso webhook com {tiqueteSolicitacao, tiqueteDownload}
 *      -> src/routes/api/public/rtc.apuracao.$ref.tsx
 *   3. GET/POST download do JSON usando o tíquete e ingestão -> este arquivo
 *
 * Falamos DIRETO com a API da Receita, sem proxy no meio: OAuth
 * client_credentials no /token e Bearer nas duas chamadas. O endereço vem de
 * RTC_API_URL (produção por padrão) e o prefixo de RTC_API_PREFIX (`rtc` ou
 * `prr-rtc` na produção restrita).
 *
 * As duas versões convivem enquanto a Receita não encerrar a antiga:
 *   v1 `POST /{prefixo}/apuracao-cbs/v1/{cnpj8}`, 2 aberturas por dia;
 *   v2 `POST /apuracao-cbs[-prr]/v2/{recurso}/{cnpj8}`, 4 por dia, com o
 *      recurso no endereço e acompanhamento pela consulta de situação.

 *
 * REGRA DO PROJETO PRESERVADA: nenhum valor fiscal é produzido aqui. Este módulo
 * só transporta e grava o que a Receita devolveu. Motor fora do ar => erro
 * explícito, nunca número estimado.
 */

import { sealSecret, unsealSecret } from "@/lib/credentials.server";
import { lerAbertura } from "@/lib/rtc-v2/abertura";
import { urlRecurso, urlSituacao, type Ambiente, type Recurso } from "@/lib/rtc-v2/enderecos";
import { lerRetorno, type Retorno } from "@/lib/rtc-v2/retorno";
import { urlAssinadaUtilizavel } from "@/lib/rtc-v2/validade";
import { versaoDaAbertura } from "@/lib/rtc-v2/versao";

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

/** `RTC_API_PREFIX` valia na v1; na v2 vira a escolha do caminho. */
function ambienteAtual(): Ambiente {
  const raw = (process.env["RTC_API_PREFIX"] ?? "").trim();
  return raw.startsWith("prr") ? "restrita" : "producao";
}

/**
 * ESTE É O INTERRUPTOR DA V2. A v2 entra no ar em outubro/2026; até lá, tudo
 * segue pela v1. Ligar é `RTC_API_VERSAO=2` no ambiente — só isso, sem mexer
 * em código.
 *
 * O padrão é desligado de propósito: enquanto a Receita não abrir a v2, um
 * pedido no endereço novo volta com erro E queima uma das consultas do dia. O
 * risco é assimétrico, então o silêncio significa v1.
 *
 * Quem decide de fato, pedido a pedido, é `versaoDaAbertura` — porque mesmo com
 * a v2 ligada, competência fechada continua na v1.
 */
function v2Ligada(): boolean {
  return (process.env["RTC_API_VERSAO"] ?? "").trim() === "2";
}

/** Sem endereço não há chamada: erro explícito, nunca uma URL montada no escuro. */
function baseObrigatoria(): string {
  const base = apiBase();
  if (!base) {
    throw new ApuracaoGatewayError(
      "not_configured",
      "Ambiente sem endereço da API da Receita configurado (RTC_API_URL).",
    );
  }
  return base;
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

/**
 * Passo 1, comum às duas versões: POST de abertura com a `urlRetorno` no corpo
 * e o Bearer no cabeçalho. Só o endereço muda entre v1 e v2 — por isso ele
 * chega pronto, montado por quem sabe a versão.
 */
async function postSolicitacao(
  url: string,
  urlRetorno: string,
  token: string,
): Promise<{ body: Record<string, unknown>; diag: ChamadaDiag }> {
  let res: Response;
  try {
    res = await withTimeout((signal) =>
      fetch(url, {
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
  // falha, porque repetir para descobrir o motivo custa uma das chamadas do dia.
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

/** Passo 1 (v1): solicita a apuração de débitos da CBS no endereço antigo. */
async function solicitarNaReceita(
  cnpj: string,
  urlRetorno: string,
  token: string,
): Promise<{ body: Record<string, unknown>; diag: ChamadaDiag }> {
  // O endpoint filtra pelo CNPJ básico (8 dígitos, com zeros à esquerda).
  const cnpj8 = cnpj.replace(/\D/g, "").slice(0, 8).padStart(8, "0");
  return postSolicitacao(
    `${baseObrigatoria()}/${apiPrefix()}/apuracao-cbs/v1/${cnpj8}`,
    urlRetorno,
    token,
  );
}

/**
 * Passo 1 (v2): o recurso passou a fazer parte do endereço, e o ambiente também
 * (`apuracao-cbs` / `apuracao-cbs-prr`). O endereço é montado por `urlRecurso`,
 * que é função pura e testada — remontar na mão aqui já mandou pedido para o
 * ambiente errado uma vez, e cada erro desses queima uma das 4 chamadas do dia.
 *
 * Exportada porque é a fronteira com a Receita: o teste do servidor de mentira
 * prova aqui o endereço, o corpo e o cabeçalho, sem precisar de banco.
 */
export async function abrirNaReceitaV2(
  cnpj: string,
  recurso: Recurso,
  urlRetorno: string,
  token: string,
): Promise<{ body: Record<string, unknown>; diag: ChamadaDiag }> {
  return postSolicitacao(
    urlRecurso(baseObrigatoria(), ambienteAtual(), recurso, cnpj),
    urlRetorno,
    token,
  );
}

/**
 * Diagnóstico técnico da resposta de download. Guardado no banco para que uma
 * falha possa ser explicada sem gastar outra consulta da cota diária. Não
 * carrega credencial nem token — só metadados da resposta.
 */
export type DownloadDiag = {
  status: number | null;
  ok: boolean;
  caminho_token: "guardado" | "novo" | "sem_token";
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

/**
 * Faz o GET de download e monta o `DownloadDiag`. Compartilhado pelos dois
 * caminhos de download (v1 por tíquete+Bearer, v2 por URL pré-assinada) —
 * a única diferença real entre eles é o header e o rótulo do `caminho_token`.
 */
async function executarDownload(
  url: string,
  headers: Record<string, string>,
  caminhoToken: DownloadDiag["caminho_token"],
): Promise<{ body: Record<string, unknown>; diag: DownloadDiag }> {
  let res: Response;
  try {
    res = await withTimeout((signal) => fetch(url, { method: "GET", headers, signal }));
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
  if (!res.ok || !body) {
    // Recorte do corpo de erro: é o que explica a recusa sem gastar cota. Na
    // v2 a URL é a credencial — o recorte é sempre do corpo de resposta da
    // Receita, nunca da URL chamada.
    diag.corpo_recorte = text.slice(0, 1000);
    const err = (res.ok
      ? new ApuracaoGatewayError("error", "A Receita devolveu um corpo inesperado.")
      : erroDaReceita(res.status, body)) as ApuracaoGatewayError & { diag?: DownloadDiag };
    err.diag = diag;
    throw err;
  }
  return { body, diag };
}

/** Passo 3 (v1): baixa o JSON do extrato pelo tíquete. Um único acesso por tíquete. */
async function baixarNaReceita(
  tiquete: string,
  token: string,
  caminhoToken: "guardado" | "novo",
): Promise<{ body: Record<string, unknown>; diag: DownloadDiag }> {
  return executarDownload(
    `${baseObrigatoria()}/${apiPrefix()}/download/v1/${encodeURIComponent(tiquete)}`,
    { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    caminhoToken,
  );
}

/**
 * Passo 3 (v2): a URL já carrega a autorização, então vai SEM o nosso Bearer.
 * Mandar o Authorization junto de uma URL pré-assinada faz alguns provedores
 * recusarem a requisição. Por isso o diag registra `"sem_token"` — não existe
 * token guardado nem novo neste caminho.
 */
async function baixarPorUrlAssinada(
  url: string,
): Promise<{ body: Record<string, unknown>; diag: DownloadDiag }> {
  return executarDownload(url, {}, "sem_token");
}

/**
 * Acompanha a solicitação sem depender do webhook. Este endereço NÃO entra no
 * limite de 4 chamadas por dia — o limite é do endpoint de abertura. É o
 * caminho principal de recuperação quando o retorno não chega.
 */
export async function consultarSituacao(
  tiquete: string,
  token: string,
): Promise<{ estado: string; retorno: Retorno }> {
  const url = urlSituacao(baseObrigatoria(), ambienteAtual(), tiquete);
  let res: Response;
  try {
    res = await withTimeout((signal) =>
      fetch(url, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        signal,
      }),
    );
  } catch (error) {
    throw transporte(error, "situacao");
  }
  const body = corpoJson(await res.text());
  if (!res.ok) throw erroDaReceita(res.status, body);
  const estado = String((body?.["estado"] as string | undefined) ?? "DESCONHECIDO");
  return { estado, retorno: lerRetorno(body) };
}

/**
 * Escreve UMA tentativa no diagnóstico da apuração, pela RPC da 0230.
 *
 * A RPC faz três coisas numa transação só: acrescenta a entrada ao `historico`
 * (lista append-only, 50 últimas) e atualiza `download_diag` ou a chave
 * correspondente de `chamada_diag` com a MESMA entrada. É isso que conserta o
 * incidente de 15/09: antes, reprocessar apagava o diagnóstico da tentativa
 * anterior, e a falha original — a que explicava a perda do tíquete — sumia.
 *
 * Também acaba com o SELECT+UPDATE que havia aqui: eram duas idas ao banco, e
 * duas tentativas simultâneas se sobrescreviam.
 *
 * Devolve `false` quando a escrita não passou — inclusive quando o banco ainda
 * não tem a 0230. Quem chama decide o que fazer; nunca lança, porque perder o
 * diagnóstico não pode derrubar o fluxo que estava sendo diagnosticado.
 */
async function registrarDiag(
  admin: AdminClient,
  apuracaoId: string,
  destino: "download" | "chamada",
  chave: string,
  entrada: Record<string, unknown>,
): Promise<boolean> {
  try {
    const { error } = await rpc(admin)("rtc_apuracao_registrar_diag", {
      p_id: apuracaoId,
      p_destino: destino,
      p_chave: chave,
      p_entrada: entrada,
    });
    if (error) {
      console.warn("[rtc-apuracao] historico nao gravado", {
        apuracao: apuracaoId,
        chave,
        erro: error.message,
      });
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[rtc-apuracao] historico nao gravado", {
      apuracao: apuracaoId,
      chave,
      erro: (e as Error).message,
    });
    return false;
  }
}

/**
 * Acumula o diagnóstico das etapas anteriores ao download em `chamada_diag`,
 * sob a chave da etapa, e no `historico`.
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
  if (await registrarDiag(admin, apuracaoId, "chamada", diag.etapa, diag)) return;
  // Banco ainda sem a 0230: mantém o comportamento antigo — só a última
  // tentativa de cada etapa, sem histórico. Remover quando a 0230 estiver
  // aplicada em todos os ambientes.
  const { data } = await table(admin, "rtc_apuracao")
    .select("chamada_diag")
    .eq("id", apuracaoId)
    .maybeSingle();
  const atual = (data?.chamada_diag ?? {}) as Record<string, unknown>;
  await table(admin, "rtc_apuracao")
    .update({ chamada_diag: { ...atual, [diag.etapa]: diag } })
    .eq("id", apuracaoId);
}

type NivelNota = "info" | "aviso" | "erro";

/**
 * Registro NOSSO — não é resposta da Receita — guardado junto do diagnóstico da
 * apuração, sob uma chave própria. Existe para os casos em que a linha segue
 * viva sabendo menos do que parece: escrita que falhou, resposta que veio
 * incompleta. Sem isto, some sem deixar rastro.
 *
 * Nunca lança e nunca decide o fluxo: se nem esta escrita passar, resta o
 * console. E nunca recebe a URL assinada — é segredo de 48 h.
 */
async function registrarNota(
  admin: AdminClient,
  apuracaoId: string,
  chave: string,
  nivel: NivelNota,
  dados: Record<string, unknown>,
) {
  const linha = { apuracao: apuracaoId, nota: chave, ...dados };
  if (nivel === "erro") console.error("[rtc-apuracao]", linha);
  else if (nivel === "aviso") console.warn("[rtc-apuracao]", linha);
  else console.info("[rtc-apuracao]", linha);
  const nota = { nivel, em: new Date().toISOString(), ...dados };
  try {
    if (await registrarDiag(admin, apuracaoId, "chamada", chave, nota)) return;
    // Banco ainda sem a 0230 — ver gravarChamada.
    const { data } = await table(admin, "rtc_apuracao")
      .select("chamada_diag")
      .eq("id", apuracaoId)
      .maybeSingle();
    const atual = (data?.chamada_diag ?? {}) as Record<string, unknown>;
    await table(admin, "rtc_apuracao")
      .update({ chamada_diag: { ...atual, [chave]: nota } })
      .eq("id", apuracaoId);
  } catch (e) {
    console.error("[rtc-apuracao] falha ao registrar nota", {
      apuracao: apuracaoId,
      nota: chave,
      erro: (e as Error).message,
    });
  }
}

/**
 * Diagnóstico do download. Vai para o `historico` e para `download_diag`.
 * Era aqui que a sobrescrita mais doía: o download é o passo que perde o
 * tíquete, e o motivo da primeira falha é o que decide se vale tentar de novo.
 */
async function gravarDiag(admin: AdminClient, apuracaoId: string, diag: DownloadDiag | undefined) {
  if (!diag) return;
  console.info("[rtc-apuracao] download", {
    apuracao: apuracaoId,
    status: diag.status,
    ok: diag.ok,
    caminho_token: diag.caminho_token,
  });
  if (await registrarDiag(admin, apuracaoId, "download", "download", diag)) return;
  // Banco ainda sem a 0230 — ver gravarChamada.
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
 * O que separa a abertura v1 da v2: o recurso pedido e a versão da API. Tudo o
 * mais — cota, segredo do webhook, token, diagnóstico, estorno em falha — é o
 * mesmo caminho, e continua sendo um só código.
 */
type OpcoesAbertura = { recurso: Recurso; apiVersao: 1 | 2 };

/**
 * Registra a solicitação (debita cota, gera o segredo do webhook) e chama a
 * Receita já com a URL de retorno deste ambiente. Se a chamada externa falhar,
 * a linha vira `erro` na hora — nada fica em "solicitada" para sempre.
 */
async function abrirSolicitacao(
  tenantId: string,
  competencia: string,
  origin: string,
  origem: string,
  opcoes: OpcoesAbertura,
): Promise<SolicitarResult> {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

  const { data, error } = await rpc(admin)("rtc_apuracao_solicitar", {
    p_tenant: tenantId,
    p_competencia: competencia,
    p_origem: origem,
    p_recurso: opcoes.recurso,
    p_api_versao: opcoes.apiVersao,
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
    const { body: resposta, diag: diagSolicitar } =
      opcoes.apiVersao === 2
        ? await abrirNaReceitaV2(cnpj, opcoes.recurso, urlRetorno, token)
        : await solicitarNaReceita(cnpj, urlRetorno, token);
    await gravarChamada(admin, row.id, diagSolicitar);

    await logUse(admin, credential.id, "apuracao.solicitar", true);

    // O 201 da v2 traz `tiqueteSolicitacao` e `tEASegundos`: é o que permite
    // acompanhar pela consulta de situação sem depender do webhook chegar.
    //
    // Só a v2 grava, e o `if` é explícito de propósito: o que a v1 devolve no
    // 201 não foi verificado, e uma linha v1 com `tiquete_solicitacao` entraria
    // na fila de acompanhamento da v2 — consultada no endereço v2 com um
    // tíquete v1 e condenada ao erro de prazo. A fila também filtra por
    // `api_versao`; as duas guardas dizem a mesma intenção de dois lados.
    if (opcoes.apiVersao === 2) {
      const abertura = lerAbertura(resposta);
      const marcas: Record<string, unknown> = {};
      if (abertura.tiquete) marcas["tiquete_solicitacao"] = abertura.tiquete;
      if (abertura.teaSegundos !== null) marcas["tea_segundos"] = abertura.teaSegundos;

      let erroMarcas: string | null = null;
      if (Object.keys(marcas).length > 0) {
        const marcado = await table(admin, "rtc_apuracao").update(marcas).eq("id", row.id);
        // NÃO lança: a solicitação já foi aberta e a chamada do dia já foi gasta
        // na Receita — morrer aqui jogaria fora o que já foi feito. Fica
        // registrado, e o webhook segue como caminho de retorno.
        if (marcado.error) erroMarcas = String(marcado.error.message);
      }

      // Registra a distinção que o 201 sozinho não mostra: com o tíquete
      // gravado dá para acompanhar pela consulta de situação; sem ele (201 sem
      // `tiqueteSolicitacao`, ou escrita falhada) só resta esperar o webhook.
      const podeAcompanhar = Boolean(abertura.tiquete) && erroMarcas === null;
      await registrarNota(admin, row.id, "abertura_v2", podeAcompanhar ? "info" : "aviso", {
        acompanhamento: podeAcompanhar ? "situacao" : "so_webhook",
        tiquete_solicitacao: abertura.tiquete ? "recebido" : "ausente",
        tea_segundos: abertura.teaSegundos,
        ...(erroMarcas ? { erro_gravacao: erroMarcas } : {}),
      });
    }

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

/**
 * Abertura de débitos pedida pela tela. É o ÚNICO ponto que escolhe a versão da
 * API — de propósito: espalhar essa decisão é como se manda pedido para o
 * endereço errado, e cada erro desses custa uma consulta do dia.
 *
 * A escolha em si é `versaoDaAbertura`, função pura e testada. Resumo da regra:
 * v1 enquanto a v2 não estiver ligada, e v1 também para competência fechada,
 * que a v2 não atende. A v1 segue viva enquanto a Receita não encerrá-la.
 *
 * Na v2 a competência pedida é ignorada: lá a janela é incremental e a linha é
 * gravada no mês corrente. Por isso `versaoDaAbertura` só devolve 2 quando a
 * competência pedida JÁ é o mês corrente — nunca há troca silenciosa de período.
 */
export async function solicitarApuracao(
  tenantId: string,
  competencia: string,
  origin: string,
  origem = "manual",
): Promise<SolicitarResult> {
  const corrente = competenciaCorrente();
  const versao = versaoDaAbertura(competencia, corrente, v2Ligada());
  if (versao === 2) {
    return abrirSolicitacao(tenantId, corrente, origin, origem, {
      recurso: "debitos",
      apiVersao: 2,
    });
  }
  return abrirSolicitacao(tenantId, competencia, origin, origem, {
    recurso: "debitos",
    apiVersao: 1,
  });
}

/**
 * Competência da abertura v2. A v2 não recebe competência: a janela é
 * incremental (8 dias) e, na primeira consulta, volta ao dia 1º do mês
 * corrente. A linha é gravada nessa competência — no fuso de São Paulo, não no
 * do servidor, senão na virada do mês três horas de UTC gravam o mês errado.
 */
function competenciaCorrente(): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const ano = partes.find((p) => p.type === "year")?.value ?? "0000";
  const mes = partes.find((p) => p.type === "month")?.value ?? "01";
  return `${ano}-${mes}-01`;
}

/**
 * Abertura na v2, por recurso. Cada recurso (`debitos`, `creditos`,
 * `pagamentos`, `recolhimentos`) é uma solicitação própria e consome uma das 4
 * chamadas do dia — a cota é do endpoint de abertura, não do recurso.
 *
 * O acompanhamento não depende do webhook: o `tiqueteSolicitacao` do 201 fica
 * gravado na linha e `processarPendentes` segue por ele pela consulta de
 * situação, respeitando o `tea_segundos` também guardado aqui.
 */
export async function abrirSolicitacaoV2(
  tenantId: string,
  recurso: Recurso,
  origin: string,
  origem = "manual",
): Promise<SolicitarResult> {
  return abrirSolicitacao(tenantId, competenciaCorrente(), origin, origem, {
    recurso,
    apiVersao: 2,
  });
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
    .select(
      "id, tenant_id, competencia, status, solicitado_em, tiquete_download, access_token_ref, payload, url_assinada, url_assinada_expira_em",
    )
    .eq("id", apuracaoId)
    .maybeSingle();
  if (error) return { ok: false, id: apuracaoId, motivo: error.message };
  if (!row) return { ok: false, id: apuracaoId, motivo: "Apuração inexistente." };
  if (row.status === "disponivel") return { ok: true, id: apuracaoId, debitos: 0 };
  if (!row.tiquete_download && !row.payload && !row.url_assinada) {
    return { ok: false, id: apuracaoId, motivo: "Tíquete de download ainda não recebido." };
  }

  // v2: a linha já veio com URL pré-assinada e ela ainda não expirou (48 h) —
  // baixa direto por ela, sem token nosso. Passado o prazo, cai no caminho v1
  // (se houver tiquete_download) para não travar uma apuração já vencida.
  //
  // `urlAssinadaExpiraEm` é opcional no retorno da Receita: ausente, ele NÃO
  // invalida a URL — vale o piso `solicitado_em + 48 h` (ver rtc-v2/validade).
  const urlAssinada = row.url_assinada as string | null;
  const urlAssinadaValida = urlAssinadaUtilizavel({
    url: urlAssinada,
    expiraEm: row.url_assinada_expira_em as string | null,
    solicitadoEm: row.solicitado_em as string | null,
    agora: Date.now(),
  });

  // O download é identificado só pelo tíquete (um acesso por tíquete) e exige
  // apenas um Bearer válido — o manual não vincula o tíquete ao token da
  // solicitação. Como o token de client_credentials expira (~1h) e o fluxo é
  // assíncrono, o token guardado pode estar vencido quando o webhook chega.
  // Por isso: sem token guardado OU 401 no download, pega token novo e tenta
  // UMA vez. O download não consome cota de solicitação.

  let payload = row.payload as Record<string, unknown> | null;
  if (!payload && urlAssinadaValida) {
    try {
      const resultado = await baixarPorUrlAssinada(urlAssinada as string);
      payload = resultado.body;
      await gravarDiag(admin, apuracaoId, resultado.diag);
      // Um único download: persiste o JSON bruto ANTES de parsear, como no v1.
      const saved = await table(admin, "rtc_apuracao")
        .update({ payload, download_em: new Date().toISOString() })
        .eq("id", apuracaoId);
      if (saved.error) throw new Error(saved.error.message);
    } catch (e) {
      const err = e as ApuracaoGatewayError & { diag?: DownloadDiag };
      await gravarDiag(admin, apuracaoId, err.diag);
      await marcarErro(admin, apuracaoId, `Download da apuração: ${err.message}`);
      return { ok: false, id: apuracaoId, motivo: err.message };
    }
  } else if (!payload && !row.tiquete_download) {
    // Não há por onde baixar: erro explícito — nunca um número estimado. A
    // mensagem separa os dois casos, porque "expirada" só é verdade quando
    // havia URL e o prazo dela passou.
    const motivo = urlAssinada
      ? "URL assinada expirada e nenhum tíquete de download disponível."
      : "Sem URL assinada e sem tíquete de download: nada a baixar.";
    await marcarErro(admin, apuracaoId, motivo);
    return { ok: false, id: apuracaoId, motivo };
  } else if (!payload) {
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

type LinhaAguardandoSituacao = {
  id: string;
  tenant_id: string;
  solicitado_em: string;
  tiquete_solicitacao: string;
  /** Coluna da Tarefa 4 — pode nem existir ainda (ver `select("*")` abaixo). */
  tea_segundos?: number | null;
};

/**
 * Acompanha, pela consulta de situação, uma linha `solicitada` que já tem
 * `tiquete_solicitacao` mas ainda não recebeu o webhook (sem `url_assinada`).
 * Não depende do nosso endereço ser alcançável pela Receita — é o caminho
 * principal de recuperação quando o retorno se perde.
 *
 * Espaçamento: `tea_segundos` (tempo estimado de atendimento, da resposta da
 * abertura) evita consultar antes da hora — chamada garantidamente inútil.
 * A coluna só existe a partir da Tarefa 4; ausente ou nula é lida como zero,
 * ou seja, sem espaçamento.
 */
async function acompanharSituacao(
  admin: AdminClient,
  row: LinhaAguardandoSituacao,
): Promise<ProcessarResult | null> {
  const teaSegundos = Number(row.tea_segundos ?? 0);
  const esperaAte =
    new Date(row.solicitado_em).getTime() + (Number.isFinite(teaSegundos) ? teaSegundos : 0) * 1000;
  if (Date.now() < esperaAte) return null;

  let credential: Credential;
  try {
    credential = await loadApiKey(admin, row.tenant_id);
  } catch {
    return null; // sem credencial agora: tenta de novo na próxima rodada
  }

  let estado: string;
  let retorno: Retorno;
  try {
    const { token } = await accessToken(credential.apiKey);
    ({ estado, retorno } = await consultarSituacao(row.tiquete_solicitacao, token));
  } catch (e) {
    console.error("[rtc-apuracao] falha ao consultar situação", {
      apuracao: row.id,
      erro: (e as Error).message,
    });
    return null; // falha de transporte: não marca erro na linha, tenta de novo depois
  }

  if (estado === "CONCLUIDA") {
    if (retorno.tipo !== "url") {
      // Concluída sem URL assinada: não há o que baixar e esperar não muda
      // isso. Erro na hora, dizendo o que veio — cair no ramo de espera lá
      // embaixo trocaria este motivo pelo de 240 minutos, que descreve um
      // problema que não é este.
      // Quando o corpo traz um erro, ele é o motivo — melhor que "retorno erro".
      const detalhe =
        retorno.tipo === "erro"
          ? (retorno.mensagem ?? retorno.codigo ?? "sem detalhe")
          : `retorno ${retorno.tipo}`;
      const motivo = `A Receita concluiu a solicitação sem URL assinada (${detalhe}).`;
      await registrarNota(admin, row.id, "situacao_concluida_sem_url", "erro", {
        retorno: retorno.tipo,
        estado,
      });
      await marcarErro(admin, row.id, motivo);
      return { ok: false, id: row.id, motivo };
    }

    const gravado = await table(admin, "rtc_apuracao")
      .update({ url_assinada: retorno.url, url_assinada_expira_em: retorno.expiraEm })
      .eq("id", row.id);
    if (gravado.error) {
      // A URL não ficou gravada. Seguir para `processarApuracao` — que relê a
      // linha do banco — faria a apuração morrer dizendo que não há URL nem
      // tíquete, que é a falha errada: a Receita entregou, nós é que não
      // guardamos. A linha fica como está (`solicitada`) e a próxima rodada
      // consulta a situação de novo: a consulta não gasta a cota de abertura e
      // a URL continua lá do lado da Receita.
      const motivo = `Falha ao gravar a URL assinada da apuração: ${gravado.error.message}`;
      await registrarNota(admin, row.id, "gravacao_url_assinada", "erro", {
        erro: String(gravado.error.message),
      });
      return { ok: false, id: row.id, motivo };
    }
    return processarApuracao(row.id);
  }

  if (estado === "ERRO") {
    const motivo =
      retorno.tipo === "erro"
        ? (retorno.mensagem ?? retorno.codigo ?? "a Receita não informou o motivo")
        : "a Receita sinalizou erro sem detalhe";
    await marcarErro(admin, row.id, `A Receita recusou a apuração: ${motivo}`);
    return { ok: false, id: row.id, motivo };
  }

  // PENDENTE / EM_PROCESSAMENTO / estado desconhecido: nada a fazer ainda,
  // salvo o prazo de processamento da Receita (240 min) já ter estourado — sem
  // isto a linha fica pendente para sempre.
  const PRAZO_MS = 240 * 60 * 1000;
  const idade = Date.now() - new Date(row.solicitado_em).getTime();
  if (idade > PRAZO_MS) {
    const motivo = "A Receita passou dos 240 minutos de processamento.";
    await marcarErro(admin, row.id, motivo);
    return { ok: false, id: row.id, motivo };
  }
  return null;
}

/** Fila de recuperação: tíquetes recebidos que ainda não foram baixados. */
export async function processarPendentes(tenantId?: string): Promise<ProcessarResult[]> {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const out: ProcessarResult[] = [];

  // v2: acompanha pela consulta de situação as linhas que ainda não receberam
  // o webhook.
  //
  // O filtro por `api_versao` é o que segura esta fila do lado da v2: sem ele,
  // uma linha v1 aberta e ainda sem webhook entraria aqui e seria consultada no
  // endereço v2 com um tíquete v1 — mexendo em v1 que já roda em produção. A
  // abertura só marca `tiquete_solicitacao` na v2; este filtro é a outra metade
  // da mesma guarda. A coluna vem da 0226, junto com `tea_segundos` e com a
  // assinatura nova de `rtc_apuracao_solicitar` que a abertura (v1 inclusive)
  // já exige — se a 0226 não estiver aplicada, nada deste arquivo funciona.
  let aguardandoQuery = table(admin, "rtc_apuracao")
    .select("*")
    .eq("status", "solicitada")
    .eq("api_versao", 2)
    .not("tiquete_solicitacao", "is", null)
    .is("url_assinada", null);
  if (tenantId) aguardandoQuery = aguardandoQuery.eq("tenant_id", tenantId);
  const { data: aguardando, error: erroAguardando } = await aguardandoQuery;
  if (erroAguardando) throw new Error(erroAguardando.message);
  for (const row of (aguardando ?? []) as LinhaAguardandoSituacao[]) {
    const resultado = await acompanharSituacao(admin, row);
    if (resultado) out.push(resultado);
  }

  const { data, error } = await rpc(admin)("rtc_apuracao_pendentes_download", {});
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as Array<{ id: string; tenant_id: string }>).filter(
    (row) => !tenantId || row.tenant_id === tenantId,
  );
  for (const r of rows) out.push(await processarApuracao(r.id));
  return out;
}

export function gatewayConfigured(): boolean {
  return apiBase() !== null;
}

