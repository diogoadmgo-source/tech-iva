import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { AuthShell, FormError } from "@/components/auth/auth-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  KIND_LABELS,
  ROLE_LABELS,
  authErrorMessage,
  signOutAndRedirect,
  type MemberRole,
  type TenantKind,
} from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/select-tenant")({
  head: () => ({
    meta: [
      { title: "Selecionar organização — FLUXA" },
      {
        name: "description",
        content:
          "Escolha a plataforma, canal, empresa ou unidade que você vai operar no painel FLUXA.",
      },
      { property: "og:title", content: "Selecionar organização — FLUXA" },
      {
        property: "og:description",
        content: "Escolha a organização que você vai operar no painel FLUXA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SelectTenantPage,
});

type Row = {
  id: string;
  name: string;
  kind: TenantKind;
  level: number;
  slug: string | null;
  role: MemberRole | null;
};

function SelectTenantPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ["select-tenant"],
    queryFn: async (): Promise<Row[]> => {
      const [{ data: tenants, error: tenantsError }, { data: memberships }] = await Promise.all([
        supabase
          .from("tenants")
          .select("id, name, kind, level, slug")
          .order("level")
          .order("name"),
        supabase.from("memberships").select("tenant_id, role"),
      ]);
      if (tenantsError) throw tenantsError;
      const byTenant = new Map((memberships ?? []).map((m) => [m.tenant_id, m.role]));
      return (tenants ?? []).map((t) => ({ ...t, role: byTenant.get(t.id) ?? null }));
    },
  });

  async function choose(tenantId: string) {
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        await supabase
          .from("profiles")
          .update({ last_tenant: tenantId })
          .eq("user_id", userData.user.id);
      }
      navigate({ to: "/t/$tenantId", params: { tenantId } });
    } catch (err) {
      setError(authErrorMessage(err));
    }
  }

  return (
    <AuthShell
      wide
      title="Selecionar organização"
      subtitle="Você vê apenas o seu escopo e os níveis abaixo dele."
      footer={
        <button
          type="button"
          className="text-muted-foreground hover:text-primary"
          onClick={() => void signOutAndRedirect(queryClient, navigate)}
        >
          Sair da conta
        </button>
      }
    >
      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg border border-border bg-muted/40" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <FormError message={error ?? (queryError ? authErrorMessage(queryError) : null)} />

          {(data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma organização no seu escopo. Peça um convite ao administrador.
            </p>
          ) : null}

          {(data ?? []).map((tenant) => (
            <button
              key={tenant.id}
              type="button"
              onClick={() => void choose(tenant.id)}
              className="flex w-full items-center justify-between gap-4 rounded-lg border border-border bg-background/40 px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-accent"
              style={{ marginLeft: `${Math.min(tenant.level, 3) * 12}px` }}
            >
              <span>
                <span className="block text-sm font-medium text-foreground">{tenant.name}</span>
                <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                  {KIND_LABELS[tenant.kind]}
                  {tenant.slug ? ` · ${tenant.slug}` : ""}
                </span>
              </span>
              {tenant.role ? (
                <Badge variant="secondary">{ROLE_LABELS[tenant.role]}</Badge>
              ) : (
                <Badge variant="outline">herdado</Badge>
              )}
            </button>
          ))}
        </div>
      )}
    </AuthShell>
  );
}
