import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

import { EventName, verifyWebhook, type PaddleEnv } from "@/lib/paddle.server";

let cached: ReturnType<typeof createClient> | null = null;
function db() {
  if (!cached) {
    cached = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return cached;
}

type Any = Record<string, any>;

async function planForPrice(priceId: string): Promise<string | null> {
  const { data, error } = await db().rpc("plan_for_price", { p_price_id: priceId });
  if (error) {
    console.error("[payments] plan_for_price falhou:", error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

async function upsertSubscription(data: Any, env: PaddleEnv) {
  const item = (data.items ?? [])[0] as Any | undefined;
  const priceId = item?.price?.import_meta?.external_id as string | undefined;
  const productId = item?.product?.import_meta?.external_id as string | undefined;
  if (!priceId || !productId) {
    console.warn("[payments] evento ignorado: missing importMeta.externalId", {
      rawPriceId: item?.price?.id,
      rawProductId: item?.product?.id,
    });
    return;
  }

  const tenantId = data.custom_data?.tenantId as string | undefined;
  const buyerId = (data.custom_data?.userId as string | undefined) ?? null;
  const planId = await planForPrice(priceId);

  const period = data.current_billing_period as Any | undefined;
  const patch: Any = {
    paddle_subscription_id: data.id,
    paddle_customer_id: data.customer_id,
    paddle_price_id: priceId,
    paddle_product_id: productId,
    status: data.status,
    current_period_start: period?.starts_at ?? null,
    current_period_end: period?.ends_at ?? null,
    cancel_at_period_end: data.scheduled_change?.action === "cancel",
    environment: env,
  };
  if (planId) patch.plan_id = planId;
  if (buyerId) patch.buyer_id = buyerId;

  const { data: existing } = await db()
    .from("subscriptions")
    .select("id")
    .eq("paddle_subscription_id", data.id)
    .maybeSingle();

  if (existing) {
    const { error } = await db().from("subscriptions").update(patch).eq("id", existing.id as string);
    if (error) throw new Error(error.message);
    return;
  }

  if (!tenantId) {
    console.warn("[payments] assinatura sem tenantId em custom_data:", data.id);
    return;
  }
  if (!planId) {
    console.warn("[payments] preço sem plano interno correspondente:", priceId);
    return;
  }

  // Encerra a assinatura manual anterior do tenant para não duplicar vigência.
  await db()
    .from("subscriptions")
    .update({ status: "canceled" })
    .eq("tenant_id", tenantId)
    .is("paddle_subscription_id", null)
    .in("status", ["active", "trialing", "past_due"]);

  const { error } = await db()
    .from("subscriptions")
    .insert({ ...patch, tenant_id: tenantId, started_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

async function markStatus(data: Any, env: PaddleEnv, status: string) {
  const { error } = await db()
    .from("subscriptions")
    .update({ status, updated_at: undefined })
    .eq("paddle_subscription_id", data.id)
    .eq("environment", env);
  if (error) throw new Error(error.message);
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const env = (url.searchParams.get("env") === "live" ? "live" : "sandbox") as PaddleEnv;
        try {
          const event = await verifyWebhook(request, env);
          switch (event.event_type) {
            case EventName.SubscriptionCreated:
            case EventName.SubscriptionUpdated:
              await upsertSubscription(event.data as Any, env);
              break;
            case EventName.SubscriptionCanceled:
              await markStatus(event.data as Any, env, "canceled");
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
