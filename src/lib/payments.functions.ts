import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Resolve o id humano do preço (starter_monthly) no id interno do Paddle (pri_...). */
export const resolvePaddlePrice = createServerFn({ method: "GET" })
  .inputValidator((data: { priceId: string; environment: "sandbox" | "live" }) =>
    z
      .object({
        priceId: z.string().min(1),
        environment: z.enum(["sandbox", "live"]),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { gatewayFetch } = await import("@/lib/paddle.server");
    const response = await gatewayFetch(
      data.environment,
      `/prices?external_id=${encodeURIComponent(data.priceId)}`,
    );
    const result = (await response.json()) as { data?: { id: string }[] };
    const id = result.data?.[0]?.id;
    if (!id) throw new Error(`Preço ${data.priceId} não encontrado no provedor.`);
    return id;
  });

/**
 * Portal do cliente (cancelar, trocar cartão, ver faturas).
 * Só quem administra o tenant pode abrir — a checagem é do banco (can_admin).
 */
export const openBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { tenantId: string }) =>
    z.object({ tenantId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: allowed, error: permError } = await context.supabase.rpc("can_admin", {
      p_tenant: data.tenantId,
    });
    if (permError) throw new Error(permError.message);
    if (!allowed) throw new Error("Seu papel nesta organização não permite gerenciar a assinatura.");

    const { data: rows, error } = await context.supabase
      .from("subscriptions")
      .select("paddle_subscription_id, paddle_customer_id, environment, started_at")
      .eq("tenant_id", data.tenantId)
      .not("paddle_customer_id", "is", null)
      .order("started_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);

    const sub = (rows ?? [])[0] as
      | {
          paddle_subscription_id: string | null;
          paddle_customer_id: string | null;
          environment: string;
        }
      | undefined;
    if (!sub?.paddle_customer_id) {
      throw new Error("Esta organização ainda não tem assinatura paga no provedor.");
    }

    const { gatewayFetch } = await import("@/lib/paddle.server");
    const response = await gatewayFetch(
      sub.environment === "live" ? "live" : "sandbox",
      `/customers/${sub.paddle_customer_id}/portal-sessions`,
      {
        method: "POST",
        body: JSON.stringify({
          subscription_ids: sub.paddle_subscription_id ? [sub.paddle_subscription_id] : [],
        }),
      },
    );

    const payload = (await response.json()) as {
      data?: {
        urls?: {
          general?: { overview?: string };
          subscriptions?: { cancel_subscription?: string; update_subscription_payment_method?: string }[];
        };
      };
    };
    const url = payload.data?.urls?.general?.overview;
    if (!url) throw new Error("O provedor não devolveu o endereço do portal.");
    return { url };
  });
