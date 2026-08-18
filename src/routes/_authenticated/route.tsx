import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { currentAal, roleRequiresMfa } from "@/lib/auth";

/**
 * Gate de rota (documento 01 §1.4):
 * 1. sem sessão → /login
 * 2. usuário com papel platform_* ou channel_admin e sessão em aal1 → /mfa
 *    (o banco reforça o mesmo com enforce_mfa() → "MFA required")
 *
 * ssr: false porque a sessão do Supabase vive no localStorage.
 *
 * Performance: o beforeLoad roda a CADA navegação. Sem cache, cada clique
 * pagava um getUser + select em memberships + getAuthenticatorAssuranceLevel
 * antes de montar a tela. Guardamos o resultado por usuário durante 5 min.
 */
const GATE_TTL = 5 * 60_000;
let gateCache: { userId: string; roles: string[]; checkedAt: number } | null = null;

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // getSession lê do storage local (sem round-trip); só valida no servidor
    // quando não há sessão em cache.
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user ?? null;
    if (!user) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }

    const cached =
      gateCache && gateCache.userId === user.id && Date.now() - gateCache.checkedAt < GATE_TTL
        ? gateCache
        : null;

    if (cached) return { user, roles: cached.roles };

    const { data: memberships } = await supabase
      .from("memberships")
      .select("role")
      .eq("user_id", user.id);
    const roles = (memberships ?? []).map((m) => m.role);
    const needsMfa = roles.some(roleRequiresMfa);

    if (needsMfa) {
      const aal = await currentAal();
      if (aal !== "aal2") {
        throw redirect({ to: "/mfa", search: { redirect: location.href } });
      }
    }

    gateCache = { userId: user.id, roles, checkedAt: Date.now() };
    return { user, roles };
  },
  component: () => <Outlet />,
});
