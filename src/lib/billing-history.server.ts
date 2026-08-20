/**
 * Regras server-only do histórico de faturas.
 * Nunca importar em código de navegador.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import type { PaddleEnv } from "@/lib/paddle.server";

type Client = SupabaseClient<Database>;

export type InvoiceRow = {
  id: string;
  tenantId: string;
  tenantName: string;
  subscriptionId: string;
  invoiceNumber: string | null;
  billedAt: string | null;
  status: string;
  /** valor em centavos da moeda da cobrança */
  amountCents: number;
  currency: string;
  environment: PaddleEnv;
};

type PaddleTransaction = {
  id: string;
  status?: string;
  invoice_number?: string | null;
  billed_at?: string | null;
  created_at?: string | null;
  details?: { totals?: { grand_total?: string | null; currency_code?: string | null } | null } | null;
};

type ScopeRow = {
  tenant_id: string;
  tenant_name: string;
  paddle_subscription_id: string | null;
  environment: string | null;
};

/** Assinaturas do provedor dentro do escopo do tenant (RLS já limita o que aparece). */
export async function scopeSubscriptions(supabase: Client, tenantId: string) {
  const { data, error } = await supabase.rpc("billing_subscriptions_scope", {
    p_tenant: tenantId,
  });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as ScopeRow[];
  const seen = new Set<string>();
  const out: { tenantId: string; tenantName: string; subscriptionId: string; env: PaddleEnv }[] = [];
  for (const row of rows) {
    if (!row.paddle_subscription_id || seen.has(row.paddle_subscription_id)) continue;
    seen.add(row.paddle_subscription_id);
    out.push({
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      subscriptionId: row.paddle_subscription_id,
      env: row.environment === "live" ? "live" : "sandbox",
    });
  }
  return out;
}

/** Faturas de uma assinatura, do provedor de pagamento. */
export async function fetchInvoices(
  env: PaddleEnv,
  subscriptionId: string,
  tenantId: string,
  tenantName: string,
  limit = 20,
): Promise<InvoiceRow[]> {
  const { gatewayFetch } = await import("@/lib/paddle.server");
  const response = await gatewayFetch(
    env,
    `/transactions?subscription_id=${encodeURIComponent(subscriptionId)}&per_page=${limit}&order_by=billed_at[DESC]`,
  );
  const payload = (await response.json()) as { data?: PaddleTransaction[] };

  return (payload.data ?? []).map((tx) => ({
    id: tx.id,
    tenantId,
    tenantName,
    subscriptionId,
    invoiceNumber: tx.invoice_number ?? null,
    billedAt: tx.billed_at ?? tx.created_at ?? null,
    status: tx.status ?? "unknown",
    amountCents: Number(tx.details?.totals?.grand_total ?? "0") || 0,
    currency: tx.details?.totals?.currency_code ?? "BRL",
    environment: env,
  }));
}
