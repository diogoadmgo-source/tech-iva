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
 */
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }

    const { data: memberships } = await supabase.from("memberships").select("role");
    const roles = (memberships ?? []).map((m) => m.role);
    const needsMfa = roles.some(roleRequiresMfa);

    if (needsMfa) {
      const aal = await currentAal();
      if (aal !== "aal2") {
        throw redirect({ to: "/mfa", search: { redirect: location.href } });
      }
    }

    return { user: data.user, roles };
  },
  component: () => <Outlet />,
});
