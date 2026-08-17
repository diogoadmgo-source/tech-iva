import { useQuery } from "@tanstack/react-query";

import type { ShellData, ShellTenant } from "@/components/app/tenant-shell";
import { supabase } from "@/integrations/supabase/client";

export function useShellData(tenantId: string) {
  return useQuery({
    queryKey: ["tenant-shell", tenantId],
    queryFn: async (): Promise<ShellData> => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id ?? "";
      const [{ data: tenants, error }, { data: role }, { data: profile }] = await Promise.all([
        supabase
          .from("tenants")
          .select("id, name, kind, level, slug, status, brand, parent_id")
          .order("level")
          .order("name"),
        supabase.rpc("role_in", { p_tenant: tenantId }),
        supabase.from("profiles").select("full_name").eq("user_id", userId).maybeSingle(),
      ]);
      if (error) throw error;

      const rows = tenants ?? [];
      const byId = new Map(rows.map((t) => [t.id, t]));
      const active = byId.get(tenantId);
      if (!active) throw new Error("Organização fora do seu escopo.");

      // Trilha: sobe por parent_id enquanto o ancestral estiver visível (RLS).
      const chain: ShellTenant[] = [];
      let cursor: (typeof rows)[number] | undefined = active;
      while (cursor) {
        chain.unshift(cursor as ShellTenant);
        cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
      }

      return {
        tenant: active as ShellTenant,
        chain,
        role: role ?? null,
        email: userData.user?.email ?? null,
        fullName: profile?.full_name ?? null,
        scope: rows as ShellTenant[],
      };
    },
  });
}
