import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Leitura pública de uma simulação compartilhada por token (a calculadora
 * oficial tem o mesmo conceito de URL compartilhável). Devolve apenas os
 * campos da simulação — nenhum dado do tenant ou do usuário.
 */
export const getSharedSimulation = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ token: z.string().trim().min(10).max(120) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("calc_simulations")
      .select("nome, inputs, results, memory, calc_version, created_at")
      .eq("share_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row ?? null;
  });
