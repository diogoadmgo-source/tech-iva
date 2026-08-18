import { keepPreviousData, useQuery } from "@tanstack/react-query";

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
 *
 * Performance: NÃO varremos mais a tabela `tenants` inteira. A marca
 * (white-label) só é necessária para a trilha (ancestrais + tenant ativo), que
 * são poucos ids — o resto vem de my_tenants().
 */
export function useShellData(tenantId: string) {
  return useQuery({
    queryKey: ["tenant-shell", tenantId],
    // Shell não muda a cada clique: mantém montado entre navegações.
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ShellData> => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id ?? "";
      const [
        { data: scopeRows, error: scopeError },
        { data: contextData, error: contextError },
        { data: profile },
      ] = await Promise.all([
        supabase.rpc("my_tenants"),
        supabase.rpc("tenant_context", { p_tenant: tenantId }),
        supabase.from("profiles").select("full_name").eq("user_id", userId).maybeSingle(),
      ]);
      if (scopeError) throw scopeError;
      if (contextError) throw contextError;

      const raw = (contextData ?? null) as unknown as TenantContext | null;
      if (!raw) throw new Error("Contexto da organização indisponível.");
      const context: TenantContext = { ...raw, ancestrais: raw.ancestrais ?? [] };
      const scope = (scopeRows ?? []) as unknown as ScopeNode[];

      const scopeById = new Map(scope.map((t) => [t.id, t]));
      const active = scopeById.get(tenantId);
      if (!active) throw new Error("Organização fora do seu escopo.");

      // Marca apenas dos tenants da trilha (poucos ids), não da tabela toda.
      const chainIds = [...context.ancestrais.map((a) => a.id), tenantId];
      const { data: brandRows } = await supabase
        .from("tenants")
        .select("id, name, kind, level, slug, status, brand")
        .in("id", chainIds);
      const brandById = new Map((brandRows ?? []).map((t) => [t.id, t]));

      const toShell = (id: string, fallbackName: string, fallbackKind: ShellTenant["kind"]) => {
        const fromBrand = brandById.get(id);
        const fromScope = scopeById.get(id);
        return {
          id,
          name: fromBrand?.name ?? fromScope?.name ?? fallbackName,
          kind: (fromBrand?.kind ?? fromScope?.kind ?? fallbackKind) as ShellTenant["kind"],
          level: fromBrand?.level ?? fromScope?.level ?? 0,
          slug: fromBrand?.slug ?? fromScope?.slug ?? null,
          status: (fromBrand?.status ?? fromScope?.status ?? "active") as string,
          brand: fromBrand?.brand ?? null,
        } satisfies ShellTenant;
      };

      // Trilha: ancestrais do tenant_context (já ordenados) + o tenant ativo.
      const chain: ShellTenant[] = [
        ...context.ancestrais.map((a) => toShell(a.id, a.name, a.kind as ShellTenant["kind"])),
        toShell(tenantId, active.name, active.kind),
      ];

      return {
        tenant: chain[chain.length - 1] as ShellTenant,
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
