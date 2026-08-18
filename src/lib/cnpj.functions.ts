import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * cnpj-fetch — consulta o provedor externo de CNPJ e grava no cache global
 * (cnpj_registry) com service role. O cliente nunca fala com o provedor.
 */

const INPUT = z
  .object({
    cnpj: z.string().optional(),
    cnpjs: z.array(z.string()).max(200).optional(),
  })
  .refine((v) => Boolean(v.cnpj) || (v.cnpjs?.length ?? 0) > 0, {
    message: "Informe cnpj ou cnpjs",
  });

export const fetchCnpj = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => INPUT.parse(input))
  .handler(async ({ data }) => {
    const { fetchCnpjBatch, providerName } = await import("@/lib/cnpj.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const list = [...(data.cnpjs ?? []), ...(data.cnpj ? [data.cnpj] : [])]
      .map((raw) => raw.replace(/\D/g, ""))
      .filter((digits) => digits.length === 14);

    const unique = [...new Set(list)];
    if (unique.length === 0) {
      return { provider: providerName(), results: [], ok: 0, notFound: 0, errors: 0 };
    }

    const results = await fetchCnpjBatch(unique, async (payload) => {
      const { error } = await supabaseAdmin.rpc("cnpj_registry_upsert", {
        p: payload as never,
      });
      if (error) throw new Error(error.message);
    });

    return {
      provider: providerName(),
      results,
      ok: results.filter((r) => r.status === "ok").length,
      notFound: results.filter((r) => r.status === "not_found").length,
      errors: results.filter((r) => r.status === "error").length,
    };
  });
