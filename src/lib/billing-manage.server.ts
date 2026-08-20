/**
 * Regras server-only da gestão de assinatura (upgrade, downgrade, cancelamento).
 * Nunca importar em código de navegador.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import type { PaddleEnv } from "@/lib/paddle.server";

type Client = SupabaseClient<Database>;

export type BillingContext = {
  rowId: string;
  tenantId: string;
  subscriptionId: string;
  environment: PaddleEnv;
};

/**
 * Carrega a assinatura ativa do provedor para o tenant, já validando permissão.
 * A regra de quem administra vem do banco (can_admin), nunca do front.
 */
export async function loadBillingContext(
  supabase: Client,
  tenantId: string,
): Promise<BillingContext> {
  const { data: allowed, error: permError } = await supabase.rpc("can_admin", {
    p_tenant: tenantId,
  });
  if (permError) throw new Error(permError.message);
  if (!allowed) throw new Error("Seu papel nesta organização não permite gerenciar a assinatura.");

  const { data, error } = await supabase
    .from("subscriptions")
    .select("id, tenant_id, paddle_subscription_id, environment, started_at")
    .eq("tenant_id", tenantId)
    .not("paddle_subscription_id", "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.paddle_subscription_id) {
    throw new Error("Esta organização ainda não tem assinatura no provedor de pagamento.");
  }

  return {
    rowId: data.id,
    tenantId: data.tenant_id,
    subscriptionId: data.paddle_subscription_id,
    environment: data.environment === "live" ? "live" : "sandbox",
  };
}

/** Timing da cobrança: upgrade cobra proporcional agora, downgrade vale no próximo ciclo. */
export function prorationMode(timing: "immediately" | "next_billing_period"): string {
  return timing === "immediately" ? "prorated_immediately" : "prorated_next_billing_period";
}

/** Converte o id humano do catálogo (pro_monthly) no id interno do provedor. */
export async function paddlePriceId(env: PaddleEnv, externalId: string): Promise<string> {
  const { gatewayFetch } = await import("@/lib/paddle.server");
  const response = await gatewayFetch(
    env,
    `/prices?external_id=${encodeURIComponent(externalId)}`,
  );
  const payload = (await response.json()) as { data?: { id: string }[] };
  const id = payload.data?.[0]?.id;
  if (!id) throw new Error(`Preço ${externalId} não encontrado no provedor.`);
  return id;
}

type PaddleItem = {
  price?: { id?: string; import_meta?: { external_id?: string | null } | null };
  product?: { import_meta?: { external_id?: string | null } | null };
};

/**
 * Reflete no banco o estado devolvido pelo provedor, para a tela responder na hora
 * sem depender da chegada do webhook (que continua sendo a fonte final).
 */
export async function syncFromPaddle(
  ctx: BillingContext,
  sub: Record<string, unknown>,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const items = (sub["items"] as PaddleItem[] | undefined) ?? [];
  const priceExternal = items[0]?.price?.import_meta?.external_id ?? null;
  const productExternal = items[0]?.product?.import_meta?.external_id ?? null;
  const period = sub["current_billing_period"] as
    | { starts_at?: string | null; ends_at?: string | null }
    | null
    | undefined;
  const scheduled = sub["scheduled_change"] as { action?: string } | null | undefined;
  const status = (sub["status"] as string | undefined) ?? null;

  const patch: Record<string, unknown> = {
    cancel_at_period_end: scheduled?.action === "cancel",
    current_period_start: period?.starts_at ?? null,
    current_period_end: period?.ends_at ?? null,
  };
  if (status) patch["status"] = status;
  if (priceExternal) patch["paddle_price_id"] = priceExternal;
  if (productExternal) patch["paddle_product_id"] = productExternal;

  if (priceExternal) {
    const { data: planId } = await supabaseAdmin.rpc("plan_for_price", {
      p_price_id: priceExternal,
    });
    if (planId) patch["plan_id"] = planId;
  }

  const { error } = await supabaseAdmin
    .from("subscriptions")
    .update(patch as never)
    .eq("id", ctx.rowId);
  if (error) throw new Error(error.message);
}

/** Trilha de auditoria da ação de faturamento, no escopo do tenant. */
export async function audit(
  supabase: Client,
  tenantId: string,
  action: string,
  entityId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await supabase.rpc("log_audit", {
    p_tenant: tenantId,
    p_action: action,
    p_entity: "subscriptions",
    p_entity_id: entityId,
    p_before: null,
    p_after: payload as never,
  });
}
