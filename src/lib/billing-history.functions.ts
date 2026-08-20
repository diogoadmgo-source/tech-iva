import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Faturas emitidas pelo provedor de pagamento para todas as empresas do escopo.
 * O escopo vem do banco (RLS + hierarquia), nunca de parâmetro do front.
 */
export const listScopeInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId: string }) => {
    if (!input?.tenantId) throw new Error("tenantId é obrigatório.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { scopeSubscriptions, fetchInvoices } = await import("@/lib/billing-history.server");

    const subs = await scopeSubscriptions(context.supabase, data.tenantId);
    if (subs.length === 0) return { invoices: [], indisponivel: false as boolean, motivo: null as string | null };

    try {
      const batches = await Promise.all(
        subs
          .slice(0, 25)
          .map((s) => fetchInvoices(s.env, s.subscriptionId, s.tenantId, s.tenantName)),
      );
      const invoices = batches
        .flat()
        .sort((a, b) => (b.billedAt ?? "").localeCompare(a.billedAt ?? ""));
      return { invoices, indisponivel: false as boolean, motivo: null as string | null };
    } catch (e) {
      // Provedor fora do ar não pode derrubar a tela: o histórico de eventos continua servindo.
      console.error("[billing-history] falha ao listar faturas:", e);
      return {
        invoices: [],
        indisponivel: true as boolean,
        motivo: "Não foi possível consultar as faturas no provedor de pagamento agora.",
      };
    }
  });
