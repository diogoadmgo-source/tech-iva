import { supabase } from "@/integrations/supabase/client";
import { currentAal, roleRequiresMfa } from "@/lib/auth";

/**
 * Para onde mandar o usuário depois de autenticar:
 * - /mfa  quando ele tem papel platform_* / channel_admin e a sessão está em aal1
 *         (gate do documento 01 §1.4: o front bloqueia rotas de admin se aal < aal2)
 * - /t/<platform>  quando ele é membro do tenant raiz (N0): o admin da plataforma
 *                  entra direto no console global, sem escolher organização
 * - /select-tenant  nos demais casos (usuário com um ou mais tenants abaixo da raiz)
 */
export async function resolvePostLoginRoute(): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? "";

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, tenant_id, tenants!inner(id, kind, level)")
    .eq("user_id", userId);

  const rows = memberships ?? [];
  const needsMfa = rows.some((m) => roleRequiresMfa(m.role));

  if (needsMfa) {
    const aal = await currentAal();
    if (aal !== "aal2") return "/mfa";
  }

  const root = rows.find((m) => m.tenants?.kind === "platform");
  if (root?.tenants?.id) return `/t/${root.tenants.id}`;

  return "/select-tenant";
}
