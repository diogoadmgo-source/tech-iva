import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const tenantInput = z.object({ tenantId: z.string().uuid() });

const changeInput = tenantInput.extend({
  /** id humano do preço no catálogo (ex.: pro_monthly) */
  priceId: z.string().min(1),
  /** cobrança imediata proporcional (upgrade) ou no próximo ciclo (downgrade) */
  timing: z.enum(["immediately", "next_billing_period"]),
});

const cancelInput = tenantInput.extend({
  effectiveFrom: z.enum(["immediately", "next_billing_period"]),
});

export type ProrationPreview = {
  /** total a pagar agora (centavos) — negativo significa crédito */
  amountDueNow: number;
  currency: string;
  /** total do próximo ciclo (centavos) */
  nextBillingAmount: number | null;
  nextBilledAt: string | null;
};

/** Prévia da troca de plano: quanto entra ou sai agora e no próximo ciclo. */
export const previewPlanChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.input<typeof changeInput>) => changeInput.parse(data))
  .handler(async ({ data, context }): Promise<ProrationPreview> => {
    const { loadBillingContext, paddlePriceId, prorationMode } = await import(
      "@/lib/billing-manage.server"
    );
    const ctx = await loadBillingContext(context.supabase, data.tenantId);
    const priceId = await paddlePriceId(ctx.environment, data.priceId);

    const { gatewayFetch } = await import("@/lib/paddle.server");
    const response = await gatewayFetch(
      ctx.environment,
      `/subscriptions/${ctx.subscriptionId}/preview`,
      {
        method: "PATCH",
        body: JSON.stringify({
          items: [{ price_id: priceId, quantity: 1 }],
          proration_billing_mode: prorationMode(data.timing),
        }),
      },
    );

    const payload = (await response.json()) as {
      data?: {
        currency_code?: string;
        immediate_transaction?: { details?: { totals?: { grand_total?: string } } };
        next_transaction?: { details?: { totals?: { grand_total?: string } } };
        next_billed_at?: string | null;
      };
    };
    const body = payload.data ?? {};
    const toCents = (value?: string) => (value ? Number(value) : 0);

    return {
      amountDueNow: toCents(body.immediate_transaction?.details?.totals?.grand_total),
      currency: body.currency_code ?? "BRL",
      nextBillingAmount: body.next_transaction
        ? toCents(body.next_transaction.details?.totals?.grand_total)
        : null,
      nextBilledAt: body.next_billed_at ?? null,
    };
  });

/** Aplica upgrade ou downgrade de plano sem sair do app. */
export const changePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.input<typeof changeInput>) => changeInput.parse(data))
  .handler(async ({ data, context }) => {
    const { loadBillingContext, paddlePriceId, prorationMode, syncFromPaddle, audit } = await import(
      "@/lib/billing-manage.server"
    );
    const ctx = await loadBillingContext(context.supabase, data.tenantId);
    const priceId = await paddlePriceId(ctx.environment, data.priceId);

    const { gatewayFetch } = await import("@/lib/paddle.server");
    const response = await gatewayFetch(ctx.environment, `/subscriptions/${ctx.subscriptionId}`, {
      method: "PATCH",
      body: JSON.stringify({
        items: [{ price_id: priceId, quantity: 1 }],
        proration_billing_mode: prorationMode(data.timing),
      }),
    });
    const payload = (await response.json()) as { data?: Record<string, unknown> };

    await syncFromPaddle(ctx, payload.data ?? {});
    await audit(context.supabase, data.tenantId, "subscription.plan_changed", ctx.rowId, {
      price_id: data.priceId,
      timing: data.timing,
    });
    return { ok: true as const };
  });

/** Cancela a assinatura (agora ou no fim do período já pago). */
export const cancelSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.input<typeof cancelInput>) => cancelInput.parse(data))
  .handler(async ({ data, context }) => {
    const { loadBillingContext, syncFromPaddle, audit } = await import(
      "@/lib/billing-manage.server"
    );
    const ctx = await loadBillingContext(context.supabase, data.tenantId);

    const { gatewayFetch } = await import("@/lib/paddle.server");
    const response = await gatewayFetch(
      ctx.environment,
      `/subscriptions/${ctx.subscriptionId}/cancel`,
      { method: "POST", body: JSON.stringify({ effective_from: data.effectiveFrom }) },
    );
    const payload = (await response.json()) as { data?: Record<string, unknown> };

    await syncFromPaddle(ctx, payload.data ?? {});
    await audit(context.supabase, data.tenantId, "subscription.canceled", ctx.rowId, {
      effective_from: data.effectiveFrom,
    });
    return { ok: true as const };
  });

/** Desfaz um cancelamento agendado, mantendo a renovação automática. */
export const resumeSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.input<typeof tenantInput>) => tenantInput.parse(data))
  .handler(async ({ data, context }) => {
    const { loadBillingContext, syncFromPaddle, audit } = await import(
      "@/lib/billing-manage.server"
    );
    const ctx = await loadBillingContext(context.supabase, data.tenantId);

    const { gatewayFetch } = await import("@/lib/paddle.server");
    const response = await gatewayFetch(ctx.environment, `/subscriptions/${ctx.subscriptionId}`, {
      method: "PATCH",
      body: JSON.stringify({ scheduled_change: null }),
    });
    const payload = (await response.json()) as { data?: Record<string, unknown> };

    await syncFromPaddle(ctx, payload.data ?? {});
    await audit(context.supabase, data.tenantId, "subscription.resumed", ctx.rowId, {});
    return { ok: true as const };
  });
