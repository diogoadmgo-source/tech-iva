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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin.auth.admin.mfa.listFactors({
      userId: context.userId,
    });
    if (error) throw error;

    const pending = (data?.factors ?? []).filter((factor) => factor.status !== "verified");
    for (const factor of pending) {
      await supabaseAdmin.auth.admin.mfa.deleteFactor({
        id: factor.id,
        userId: context.userId,
      });
    }
    return { removed: pending.length };
  });
