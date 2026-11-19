import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Tela "DARF e recolhimentos": consultas v2 (débitos, pagamentos,
 * recolhimentos) e geração de DARF. A permissão é do banco: `in_scope` para
 * consultar, `rtc_pode_emitir_darf` para gerar DARF.
 */

type Rpc = { rpc: (fn: never, args: never) => Promise<{ data: unknown; error: { message: string } | null }> };

async function assertScope(supabase: Rpc, tenantId: string) {
  const { data, error } = await supabase.rpc("in_scope" as never, { p_tenant: tenantId } as never);
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("forbidden");
}

async function assertDarf(supabase: Rpc, tenantId: string) {
  const { data, error } = await supabase.rpc("rtc_pode_emitir_darf" as never, { p_tenant: tenantId } as never);
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Seu papel não permite gerar DARF. Peça ao dono ou ao financeiro da empresa.");
}

function requestOrigin(): string {
  const request = getRequest();
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const RECURSO = z.enum(["debitos", "pagamentos", "recolhimentos"]);

/** Abre uma consulta v2 (gasta 1 das 4 do dia daquela API). */
export const cbsV2Abrir = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ tenantId: z.string().uuid(), recurso: RECURSO }).parse(input))
  .handler(async ({ data, context }) => {
    const { abrirSolicitacaoV2 } = await import("@/lib/rtc-apuracao.server");
    await assertScope(context.supabase as never, data.tenantId);
    return abrirSolicitacaoV2(data.tenantId, data.recurso, requestOrigin());
  });

const OPCAO = z.enum(["PAGAMENTO_TOTAL", "PAGAMENTO_PARCIAL"]);
const CENTAVOS = z.number().int().positive().max(1_000_000_000_000).nullable().optional();

export const cbsDarfPcont = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        tenantId: z.string().uuid(),
        pa: z.string().regex(/^(\d{4}-\d{2}|\d{2}\/\d{4})$/),
        opcao: OPCAO,
        valorParcialCents: CENTAVOS,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { gerarDarfPcont } = await import("@/lib/rtc-darf.server");
    await assertDarf(context.supabase as never, data.tenantId);
    return gerarDarfPcont(data.tenantId, String(context.userId), data);
  });

export const cbsDarfRad = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        tenantId: z.string().uuid(),
        itens: z
          .array(z.object({ chaveDFE: z.string().min(20).max(120), opcao: OPCAO, valorParcialCents: CENTAVOS }))
          .min(1)
          .max(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { gerarDarfRad } = await import("@/lib/rtc-darf.server");
    await assertDarf(context.supabase as never, data.tenantId);
    return gerarDarfRad(data.tenantId, String(context.userId), data.itens);
  });

export const cbsDarfPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ tenantId: z.string().uuid(), darfId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { baixarPdfDarf } = await import("@/lib/rtc-darf.server");
    await assertScope(context.supabase as never, data.tenantId);
    return baixarPdfDarf(data.tenantId, data.darfId);
  });

/** Quem está vendo pode gerar DARF? Só para a tela esconder o botão. */
export const cbsPodeEmitirDarf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ tenantId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as never as Rpc;
    const { data: pode } = await supabase.rpc("rtc_pode_emitir_darf" as never, { p_tenant: data.tenantId } as never);
    return { pode: pode === true };
  });
