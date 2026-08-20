/**
 * Acesso server-only ao Paddle através do gateway de conectores da Lovable.
 * Nunca importar deste arquivo em código de navegador.
 */

import { createHmac, timingSafeEqual } from "crypto";

export type PaddleEnv = "sandbox" | "live";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/paddle";

function connectionKey(env: PaddleEnv): string {
  const key =
    env === "sandbox" ? process.env["PADDLE_SANDBOX_API_KEY"] : process.env["PADDLE_LIVE_API_KEY"];
  if (!key) throw new Error(`Credencial do Paddle (${env}) não configurada.`);
  return key;
}

function webhookSecret(env: PaddleEnv): string {
  const secret =
    env === "sandbox"
      ? process.env["PAYMENTS_SANDBOX_WEBHOOK_SECRET"]
      : process.env["PAYMENTS_LIVE_WEBHOOK_SECRET"];
  if (!secret) throw new Error(`Segredo de webhook (${env}) não configurado.`);
  return secret;
}

export async function gatewayFetch(
  env: PaddleEnv,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  if (!lovableKey) throw new Error("LOVABLE_API_KEY não configurada.");

  const response = await fetch(`${GATEWAY_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": connectionKey(env),
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Paddle respondeu ${response.status}: ${body.slice(0, 400)}`);
  }
  return response;
}

/** Nomes de evento usados pelo handler de webhook. */
export const EventName = {
  SubscriptionCreated: "subscription.created",
  SubscriptionUpdated: "subscription.updated",
  SubscriptionCanceled: "subscription.canceled",
  TransactionCompleted: "transaction.completed",
  TransactionPaymentFailed: "transaction.payment_failed",
} as const;

export type PaddleEvent = {
  event_type: string;
  data: Record<string, unknown>;
};

/**
 * Valida a assinatura HMAC do webhook (header Paddle-Signature: ts=...;h1=...).
 * Lança se a assinatura não confere ou se o evento é antigo (replay).
 */
export async function verifyWebhook(request: Request, env: PaddleEnv): Promise<PaddleEvent> {
  const header = request.headers.get("paddle-signature");
  if (!header) throw new Error("Assinatura ausente.");

  const parts = new Map<string, string>();
  for (const chunk of header.split(";")) {
    const [k, v] = chunk.split("=");
    if (k && v) parts.set(k.trim(), v.trim());
  }
  const ts = parts.get("ts");
  const h1 = parts.get("h1");
  if (!ts || !h1) throw new Error("Assinatura mal formada.");

  const skew = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(skew) || skew > 300) throw new Error("Assinatura expirada.");

  const body = await request.text();
  const expected = createHmac("sha256", webhookSecret(env)).update(`${ts}:${body}`).digest("hex");
  const got = Buffer.from(h1);
  const exp = Buffer.from(expected);
  if (got.length !== exp.length || !timingSafeEqual(got, exp)) {
    throw new Error("Assinatura inválida.");
  }

  return JSON.parse(body) as PaddleEvent;
}
