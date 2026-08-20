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

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function upsertSubscription(sub: PaddleSubscription, env: PaddleEnv) {
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

  const { data: existing, error: findError } = await db
    .from("subscriptions")
    .select("id")
    .eq("paddle_subscription_id", sub.id)
    .maybeSingle();
  if (findError) throw new Error(findError.message);

  if (existing) {
    const { error } = await db.from("subscriptions").update(patch).eq("id", existing.id);
    if (error) throw new Error(error.message);
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
}

async function markCanceled(sub: PaddleSubscription, env: PaddleEnv) {
  const db = await admin();
  const { error } = await db
    .from("subscriptions")
    .update({ status: "canceled" })
    .eq("paddle_subscription_id", sub.id)
    .eq("environment", env);
  if (error) throw new Error(error.message);
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const env: PaddleEnv = url.searchParams.get("env") === "live" ? "live" : "sandbox";
        try {
          const event = await verifyWebhook(request, env);
          const data = event.data as PaddleSubscription;
          switch (event.event_type) {
            case EventName.SubscriptionCreated:
            case EventName.SubscriptionUpdated:
              await upsertSubscription(data, env);
              break;
            case EventName.SubscriptionCanceled:
              await markCanceled(data, env);
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
