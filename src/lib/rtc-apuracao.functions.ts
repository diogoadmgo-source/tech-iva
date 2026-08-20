import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Apuração da CBS orquestrada pelo aplicativo (sem worker externo).
 * A permissão é do banco: `in_scope` garante que o usuário alcança a empresa.
 */

const SOLICITAR = z.object({
  tenantId: z.string().uuid(),
  competencia: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
});

async function assertScope(
  supabase: { rpc: (fn: never, args: never) => Promise<{ data: unknown; error: { message: string } | null }> },
  tenantId: string,
) {
  const { data, error } = await supabase.rpc("in_scope" as never, { p_tenant: tenantId } as never);
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("forbidden");
}

/** Origem pública deste ambiente, para compor a URL de retorno do webhook. */
function requestOrigin(): string {
  const request = getRequest();
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = forwardedHost ?? url.host;
  const proto = forwardedProto ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export const apuracaoSolicitar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SOLICITAR.parse(input))
  .handler(async ({ data, context }) => {
    const { solicitarApuracao } = await import("@/lib/rtc-apuracao.server");
    await assertScope(context.supabase as never, data.tenantId);
    const competencia = data.competencia.length === 7 ? `${data.competencia}-01` : data.competencia;
    return solicitarApuracao(data.tenantId, competencia, requestOrigin());
  });

/** Recuperação manual: baixa e grava tíquetes que ficaram para trás. */
export const apuracaoProcessarPendentes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ tenantId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { processarPendentes } = await import("@/lib/rtc-apuracao.server");
    await assertScope(context.supabase as never, data.tenantId);
    const results = await processarPendentes(data.tenantId);
    return {
      processadas: results.filter((r) => r.ok).length,
      falhas: results.filter((r) => !r.ok).map((r) => ("motivo" in r ? r.motivo : "")),
    };
  });

export const apuracaoGatewayStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { gatewayConfigured } = await import("@/lib/rtc-apuracao.server");
    return { configured: gatewayConfigured() };
  });
