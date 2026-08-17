import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Remove fatores TOTP pendentes (não verificados) do próprio usuário.
 * Necessário porque listFactors() no cliente só devolve fatores verificados,
 * e o GoTrue recusa um novo enroll enquanto existir um pendente.
 */
export const purgePendingMfaFactors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const url = process.env["SUPABASE_URL"]!;
    const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    const base = `${url}/auth/v1/admin/users/${context.userId}/factors`;

    const listResponse = await fetch(base, { headers });
    if (!listResponse.ok) {
      throw new Error(`admin factors list falhou: ${listResponse.status}`);
    }
    const payload = (await listResponse.json()) as
      | Array<{ id: string; status: string }>
      | { factors?: Array<{ id: string; status: string }> };
    const factors = Array.isArray(payload) ? payload : (payload.factors ?? []);

    let removed = 0;
    for (const factor of factors) {
      if (factor.status === "verified") continue;
      const deleteResponse = await fetch(`${base}/${factor.id}`, {
        method: "DELETE",
        headers,
      });
      if (deleteResponse.ok) removed += 1;
    }
    return { removed };
  });
