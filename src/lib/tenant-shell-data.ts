import { useQuery } from "@tanstack/react-query";

import type { ShellData, ShellTenant } from "@/components/app/tenant-shell";
import { supabase } from "@/integrations/supabase/client";
import { buildScopeTree, type ScopeNode, type TenantContext } from "@/lib/tenant-scope";

/**
 * Dados do shell (migration 0100).
 *
 * O escopo de navegação vem de my_tenants() — toda a árvore visível, não só os
 * tenants com membership direta — e o contexto do tenant aberto vem de
 * tenant_context(), que informa o papel efetivo, a trilha de ancestrais e se o
 * usuário está VISITANDO (acesso por hierarquia).
 */
export function useShellData(tenantId: string) {
  return useQuery({
    queryKey: ["tenant-shell", tenantId],
    queryFn: async (): Promise<ShellData> => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id ?? "";
      const [
        { data: scopeRows, error: scopeError },
        { data: contextData, error: contextError },
        { data: tenants, error: tenantsError },
        { data: profile },
      ] = await Promise.all([
        supabase.rpc("my_tenants"),
        supabase.rpc("tenant_context", { p_tenant: tenantId }),
        // Somente para a marca (white-label) da trilha: brand não vem do RPC.
        supabase.from("tenants").select("id, name, kind, level, slug, status, brand, parent_id"),
        supabase.from("profiles").select("full_name").eq("user_id", userId).maybeSingle(),
      ]);
      if (scopeError) throw scopeError;
      if (contextError) throw contextError;
      if (tenantsError) throw tenantsError;

      const context = contextData as unknown as TenantContext;
      const scope = (scopeRows ?? []) as unknown as ScopeNode[];
      const byId = new Map((tenants ?? []).map((t) => [t.id, t]));
      const active = byId.get(tenantId);
      if (!active) throw new Error("Organização fora do seu escopo.");

      // Trilha: ancestrais do tenant_context (já ordenados) + o tenant ativo.
      const chain: ShellTenant[] = [
        ...context.ancestrais.map(
          (a) => (byId.get(a.id) ?? { ...a, level: 0, slug: null, status: "active", brand: null }) as ShellTenant,
        ),
        active as ShellTenant,
      ];

      return {
        tenant: active as ShellTenant,
        chain,
        role: context.papel ?? null,
        email: userData.user?.email ?? null,
        fullName: profile?.full_name ?? null,
        scope,
        scopeTree: buildScopeTree(scope),
        context,
      };
    },
  });
}
