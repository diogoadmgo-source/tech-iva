import { supabase } from "@/integrations/supabase/client";
import { currentAal, roleRequiresMfa } from "@/lib/auth";

/**
 * Para onde mandar o usuário depois de autenticar:
 * - /mfa  quando ele tem papel platform_* / channel_admin e a sessão está em aal1
 *         (gate do documento 01 §1.4: o front bloqueia rotas de admin se aal < aal2)
 * - /select-tenant  caso contrário
 */
export async function resolvePostLoginRoute(): Promise<"/mfa" | "/select-tenant"> {
  const { data: userData } = await supabase.auth.getUser();
  const { data: memberships } = await supabase
    .from("memberships")
    .select("role")
    .eq("user_id", userData.user?.id ?? "");
  const needsMfa = (memberships ?? []).some((m) => roleRequiresMfa(m.role));
  if (!needsMfa) return "/select-tenant";
  const aal = await currentAal();
  return aal === "aal2" ? "/select-tenant" : "/mfa";
}
