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
      { title: "Selecionar organização — TECH-IVA" },
      {
        name: "description",
        content:
          "Escolha a plataforma, canal, empresa ou unidade que você vai operar no painel TECH-IVA.",
      },
      { property: "og:title", content: "Selecionar organização — TECH-IVA" },
      {
        property: "og:description",
        content: "Escolha a organização que você vai operar no painel TECH-IVA.",
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

const KIND_ORDER: TenantKind[] = ["platform", "channel", "company", "unit"];

function SelectTenantPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");


  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ["select-tenant"],
    queryFn: async (): Promise<Row[]> => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id ?? "";
      const [{ data: tenants, error: tenantsError }, { data: memberships }] = await Promise.all([
        supabase
          .from("tenants")
          .select("id, name, kind, level, slug")
          .order("level")
          .order("name"),
        // Só os vínculos do próprio usuário: o RLS permite ler os de outros no escopo.
        supabase.from("memberships").select("tenant_id, role").eq("user_id", userId),
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
        <div className="space-y-5">
          <FormError message={error ?? (queryError ? authErrorMessage(queryError) : null)} />

          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome ou slug…"
            aria-label="Buscar organização"
          />

          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma organização encontrada no seu escopo.
            </p>
          ) : null}

          {groups.map(([kind, rows]) => (
            <section key={kind} className="space-y-2">
              <h2 className="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
                {KIND_LABELS[kind]}
              </h2>
              {rows.map((tenant) => (
                <button
                  key={tenant.id}
                  type="button"
                  onClick={() => void choose(tenant.id)}
                  className="flex w-full items-center justify-between gap-4 rounded-lg border border-border bg-background/40 px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-accent"
                >
                  <span>
                    <span className="block text-sm font-medium text-foreground">{tenant.name}</span>
                    <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                      nível {tenant.level}
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
            </section>
          ))}
        </div>
      )}
    </AuthShell>
  );
}
