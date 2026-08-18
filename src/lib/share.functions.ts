import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Leitura pública de uma simulação compartilhada por token.
 *
 * O papel `anon` NÃO tem privilégio nenhum no banco (migration 0140) — e isso é
 * proposital: nenhuma leitura pública passa pela chave anon. Esta função roda no
 * servidor com service role e projeta SOMENTE os campos do cálculo. Nada de
 * tenant_id, razão social, CNPJ, created_by ou qualquer coisa que identifique
 * quem calculou: uma simulação compartilhada mostra o cálculo, não o cliente.
 *
 * O link vale 90 dias (share_expires_at). Token vencido devolve null, e a tela
 * mostra "link expirado" — mesmo comportamento de token inexistente, para não
 * revelar se aquele token já existiu.
 */
export const getSharedSimulation = createServerFn({ method: "GET" })
  .inputValidator((input) =>
    z
      .object({ token: z.string().trim().regex(/^[0-9a-f]{32}$/, "token inválido") })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("calc_simulations")
      // projeção mínima: sem tenant_id, sem created_by, sem nome da empresa
      .select("inputs, results, memory, calc_version, created_at, share_expires_at")
      .eq("share_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    if (row.share_expires_at && new Date(row.share_expires_at).getTime() <= Date.now()) {
      return null;
    }
    const { share_expires_at: _expires, ...publicPayload } = row;
    return publicPayload;
  });
