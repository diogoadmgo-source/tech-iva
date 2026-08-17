import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { FormError } from "@/components/auth/auth-shell";
import { TenantShell } from "@/components/app/tenant-shell";
import { useShellData } from "@/lib/tenant-shell-data";
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
