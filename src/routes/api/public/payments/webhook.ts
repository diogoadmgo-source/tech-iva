import { createFileRoute } from "@tanstack/react-router";

import { EventName, verifyWebhook, type PaddleEnv } from "@/lib/paddle.server";

type PaddleItem = {
  price?: { id?: string; import_meta?: { external_id?: string | null } | null };
  product?: { id?: string; import_meta?: { external_id?: string | null } | null };
};

type PaddleSubscription = {
  id: string;
  status: string;
  customer_id?: string;
  items?: PaddleItem[];
  custom_data?: { tenantId?: string; userId?: string } | null;
  current_billing_period?: { starts_at?: string | null; ends_at?: string | null } | null;
  scheduled_change?: { action?: string } | null;
};

type PaddleTransaction = {
  id: string;
  status?: string;
  subscription_id?: string | null;
  custom_data?: { tenantId?: string; userId?: string } | null;
  details?: { totals?: { grand_total?: string; currency_code?: string } | null } | null;
};

type SubscriptionRow = {
  id: string;
  tenant_id: string;
  status: string;
  plan_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Guarda o evento; devolve false quando já foi processado antes (reenvio do provedor). */
async function claimEvent(
  eventId: string,
  eventType: string,
  env: PaddleEnv,
  subscriptionId: string | null,
  tenantId: string | null,
) {
  const db = await admin();
  const { error } = await db.from("billing_webhook_events").insert({
    event_id: eventId,
    event_type: eventType,
    environment: env,
    subscription_id: subscriptionId,
    tenant_id: tenantId,
  });
  if (!error) return true;
  if (error.code === "23505" || /duplicate key/i.test(error.message)) return false;
  throw new Error(error.message);
}

async function audit(
  tenantId: string | null,
  action: string,
  entityId: string,
  before: unknown,
  after: unknown,
) {
  const db = await admin();
  const { error } = await db.rpc("log_billing_event", {
    p_tenant: tenantId,
    p_action: action,
    p_entity_id: entityId,
    p_before: (before ?? null) as never,
    p_after: (after ?? null) as never,
  });
  // A auditoria é prova: se falhar, o evento precisa ser reenviado pelo provedor.
  if (error) throw new Error(`auditoria falhou: ${error.message}`);
}

async function currentRow(subscriptionId: string, env: PaddleEnv) {
  const db = await admin();
  const { data, error } = await db
    .from("subscriptions")
    .select("id, tenant_id, status, plan_id, current_period_end, cancel_at_period_end")
    .eq("paddle_subscription_id", subscriptionId)
    .eq("environment", env)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as SubscriptionRow | null;
}

async function upsertSubscription(sub: PaddleSubscription, env: PaddleEnv, action: string) {
  const db = await admin();
  const item = sub.items?.[0];
  const priceId = item?.price?.import_meta?.external_id ?? null;
  const productId = item?.product?.import_meta?.external_id ?? null;
  if (!priceId || !productId) {
    console.warn("[payments] evento ignorado: falta importMeta.externalId", {
      rawPriceId: item?.price?.id,
      rawProductId: item?.product?.id,
    });
    return;
  }

  const period = sub.current_billing_period ?? null;
  const patch = {
    paddle_subscription_id: sub.id,
    paddle_customer_id: sub.customer_id ?? null,
    paddle_price_id: priceId,
    paddle_product_id: productId,
    status: sub.status,
    current_period_start: period?.starts_at ?? null,
    current_period_end: period?.ends_at ?? null,
    cancel_at_period_end: sub.scheduled_change?.action === "cancel",
    environment: env,
  };

  const existing = await currentRow(sub.id, env);

  if (existing) {
    const { error } = await db.from("subscriptions").update(patch).eq("id", existing.id);
    if (error) throw new Error(error.message);
    await audit(existing.tenant_id, action, sub.id, existing, patch);
    return;
  }

  const tenantId = sub.custom_data?.tenantId ?? null;
  if (!tenantId) {
    console.warn("[payments] assinatura sem tenantId em customData:", sub.id);
    return;
  }

  const { data: planId, error: planError } = await db.rpc("plan_for_price", {
    p_price_id: priceId,
  });
  if (planError) throw new Error(planError.message);
  if (!planId) {
    console.warn("[payments] preço sem plano interno correspondente:", priceId);
    return;
  }

  // Encerra a assinatura manual anterior do tenant para não haver duas vigentes.
  await db
    .from("subscriptions")
    .update({ status: "canceled" })
    .eq("tenant_id", tenantId)
    .is("paddle_subscription_id", null)
    .in("status", ["active", "trialing", "past_due"]);

  const { error } = await db.from("subscriptions").insert({
    ...patch,
    tenant_id: tenantId,
    plan_id: planId,
    started_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  await audit(tenantId, action, sub.id, null, { ...patch, tenant_id: tenantId, plan_id: planId });
}

async function markCanceled(sub: PaddleSubscription, env: PaddleEnv) {
  const db = await admin();
  const existing = await currentRow(sub.id, env);
  const { error } = await db
    .from("subscriptions")
    .update({ status: "canceled", cancel_at_period_end: false })
    .eq("paddle_subscription_id", sub.id)
    .eq("environment", env);
  if (error) throw new Error(error.message);
  await audit(existing?.tenant_id ?? sub.custom_data?.tenantId ?? null, "subscription.canceled", sub.id, existing, {
    status: "canceled",
  });
}

async function auditTransaction(tx: PaddleTransaction, env: PaddleEnv, action: string) {
  const subscriptionId = tx.subscription_id ?? null;
  const existing = subscriptionId ? await currentRow(subscriptionId, env) : null;
  await audit(existing?.tenant_id ?? tx.custom_data?.tenantId ?? null, action, subscriptionId ?? tx.id, null, {
    transaction_id: tx.id,
    subscription_id: subscriptionId,
    status: tx.status ?? null,
    amount: tx.details?.totals?.grand_total ?? null,
    currency: tx.details?.totals?.currency_code ?? null,
    environment: env,
  });
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const env: PaddleEnv = url.searchParams.get("env") === "live" ? "live" : "sandbox";
        try {
          const event = await verifyWebhook(request, env);
          const raw = event.data as Record<string, unknown>;
          const eventId =
            (event as unknown as { event_id?: string }).event_id ??
            (event as unknown as { notification_id?: string }).notification_id ??
            null;
          const isTransaction = event.event_type.startsWith("transaction.");
          const sub = raw as unknown as PaddleSubscription;
          const tx = raw as unknown as PaddleTransaction;
          const subscriptionId = isTransaction ? (tx.subscription_id ?? null) : (sub.id ?? null);
          const tenantHint = (raw["custom_data"] as { tenantId?: string } | null)?.tenantId ?? null;

          if (eventId) {
            const fresh = await claimEvent(eventId, event.event_type, env, subscriptionId, tenantHint);
            if (!fresh) return Response.json({ received: true, duplicate: true });
          }

          switch (event.event_type) {
            case EventName.SubscriptionCreated:
              await upsertSubscription(sub, env, "subscription.created");
              break;
            case EventName.SubscriptionUpdated:
              await upsertSubscription(sub, env, "subscription.updated");
              break;
            case EventName.SubscriptionCanceled:
              await markCanceled(sub, env);
              break;
            case EventName.TransactionCompleted:
              await auditTransaction(tx, env, "payment.completed");
              break;
            case EventName.TransactionPaymentFailed:
              await auditTransaction(tx, env, "payment.failed");
              break;
            default:
              console.log("[payments] evento sem tratamento:", event.event_type);
          }
          return Response.json({ received: true });
        } catch (e) {
          console.error("[payments] erro no webhook:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
