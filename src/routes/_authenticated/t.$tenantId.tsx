import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { FormError } from "@/components/auth/auth-shell";
import { TenantShell, type ShellData, type ShellTenant } from "@/components/app/tenant-shell";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/t/$tenantId")({
  head: () => ({
    meta: [
      { title: "Painel da organização — TECH-IVA" },
      {
        name: "description",
        content:
          "Painel da organização ativa no TECH-IVA, com papel do usuário, trilha hierárquica e escopo carregados do banco.",
      },
      { property: "og:title", content: "Painel da organização — TECH-IVA" },
      {
        property: "og:description",
        content: "Painel da organização ativa no TECH-IVA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TenantLayout,
});

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

function TenantLayout() {
  const { tenantId } = Route.useParams();
  const { data, isLoading, error } = useShellData(tenantId);

  // Persiste a última organização usada.
  useEffect(() => {
    if (!data?.tenant) return;
    void (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      await supabase
        .from("profiles")
        .update({ last_tenant: tenantId })
        .eq("user_id", userData.user.id);
    })();
  }, [data?.tenant, tenantId]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="mt-6 h-40 animate-pulse rounded-xl bg-muted/60" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background p-8">
        <FormError message={authErrorMessage(error ?? new Error("Organização indisponível."))} />
      </div>
    );
  }

  return (
    <TenantShell data={data}>
      <Outlet />
    </TenantShell>
  );
}
