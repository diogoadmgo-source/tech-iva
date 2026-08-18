import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * rtc-calculate / rtc-validate — falam com o componente OFICIAL da Receita
 * rodando na nossa infraestrutura (RTC_CALC_URL). Nenhum número é produzido
 * aqui: se o motor não responde, devolvemos {available:false} e a tela mostra
 * "Calculadora não disponível". Nunca um valor estimado.
 */

const CALC_INPUT = z.object({
  tenantId: z.string().uuid(),
  cst: z.string().trim().min(1).max(4),
  cclasstrib: z.string().trim().min(1).max(8),
  ncm: z.string().trim().max(12).optional(),
  nbs: z.string().trim().max(12).optional(),
  base_cents: z.number().int().min(1).max(1_000_000_000_00),
  uf_origem: z.string().trim().length(2),
  uf_destino: z.string().trim().length(2),
  municipio_destino: z.string().trim().max(80).optional(),
  data_fato_gerador: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  descricao: z.string().trim().max(200).optional(),
});

const VALIDATE_INPUT = z.object({
  tenantId: z.string().uuid(),
  files: z
    .array(
      z.object({
        filename: z.string().trim().min(1).max(200),
        // XML em texto; limite defensivo de ~4 MB por arquivo
        xml: z.string().min(20).max(4_000_000),
      }),
    )
    .min(1)
    .max(25),
});

/** Papéis com acesso de leitura ao tenant já são garantidos por in_scope nas RPCs. */
async function assertScope(
  supabase: { rpc: (fn: never, args: never) => Promise<{ data: unknown; error: { message: string } | null }> },
  tenantId: string,
) {
  const { data, error } = await supabase.rpc("in_scope" as never, { p_tenant: tenantId } as never);
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("forbidden");
}

/** Estado do motor, para a tela decidir entre calcular e avisar indisponível. */
export const rtcEngineStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { engineStatus } = await import("@/lib/rtc-calc.server");
    return engineStatus();
  });

export const rtcCalculate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CALC_INPUT.parse(input))
  .handler(async ({ data, context }) => {
    const { calculate, EngineUnavailableError } = await import("@/lib/rtc-calc.server");
    await assertScope(context.supabase as never, data.tenantId);
    try {
      const result = await calculate({
        cst: data.cst,
        cclasstrib: data.cclasstrib,
        ncm: data.ncm,
        nbs: data.nbs,
        base_cents: data.base_cents,
        uf_origem: data.uf_origem.toUpperCase(),
        uf_destino: data.uf_destino.toUpperCase(),
        municipio_destino: data.municipio_destino,
        data_fato_gerador: data.data_fato_gerador,
        descricao: data.descricao,
      });
      return { available: true as const, result };
    } catch (error) {
      if (error instanceof EngineUnavailableError) {
        return { available: false as const, reason: error.reason, message: error.message };
      }
      throw error;
    }
  });

export const rtcValidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => VALIDATE_INPUT.parse(input))
  .handler(async ({ data, context }) => {
    const { validateXml, EngineUnavailableError } = await import("@/lib/rtc-calc.server");
    await assertScope(context.supabase as never, data.tenantId);

    const results: Array<
      | { filename: string; ok: true; validation: Awaited<ReturnType<typeof validateXml>>; id: string | null }
      | { filename: string; ok: false; message: string }
    > = [];

    for (const file of data.files) {
      try {
        const validation = await validateXml(file.filename, file.xml);
        // save_xml_validation roda com o client do usuário (in_scope) e, quando
        // inválido, já cria o alerta 'inconsistent_item'.
        const { data: id, error } = await context.supabase.rpc("save_xml_validation" as never, {
          p_tenant: data.tenantId,
          p_filename: validation.filename,
          p_access_key: validation.access_key,
          p_modelo: validation.modelo,
          p_valido: validation.valido,
          p_inconsistencias: validation.inconsistencias,
          p_total_itens: validation.total_itens,
          p_calc_version: validation.calc_version,
        } as never);
        if (error) throw new Error(error.message);
        results.push({
          filename: file.filename,
          ok: true,
          validation,
          id: typeof id === "string" ? id : null,
        });
      } catch (error) {
        if (error instanceof EngineUnavailableError) {
          return { available: false as const, reason: error.reason, message: error.message };
        }
        results.push({
          filename: file.filename,
          ok: false,
          message: error instanceof Error ? error.message : "Falha ao validar o arquivo.",
        });
      }
    }

    return { available: true as const, results };
  });
