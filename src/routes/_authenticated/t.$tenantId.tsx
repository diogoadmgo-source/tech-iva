import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { KIND_LABELS, ROLE_LABELS, signOutAndRedirect } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/t/$tenantId")({
  head: () => ({
    meta: [
      { title: "Painel da organização — TECH-IVA" },
      {
        name: "description",
        content:
          "Painel da organização ativa no TECH-IVA, com papel do usuário e escopo hierárquico carregados do banco.",
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
  component: TenantHome,
});

function TenantHome() {
  const { tenantId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["tenant", tenantId],
    queryFn: async () => {
      const [{ data: tenant, error }, { data: role }, { data: user }] = await Promise.all([
        supabase
          .from("tenants")
          .select("id, name, kind, level, slug, status")
          .eq("id", tenantId)
          .maybeSingle(),
        supabase.rpc("role_in", { p_tenant: tenantId }),
        supabase.auth.getUser(),
      ]);
      if (error) throw error;
      return { tenant, role, email: user.user?.email ?? null };
    },
  });

  return (
    <main className="auth-backdrop min-h-screen px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs tracking-[0.35em] text-primary uppercase">fluxa</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              {isLoading ? "Carregando…" : (data?.tenant?.name ?? "Organização não encontrada")}
            </h1>
            {data?.tenant ? (
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {KIND_LABELS[data.tenant.kind]} · nível {data.tenant.level} · {data.tenant.status}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            {data?.role ? <Badge variant="secondary">{ROLE_LABELS[data.role]}</Badge> : null}
            <Button variant="outline" onClick={() => navigate({ to: "/select-tenant" })}>
              Trocar organização
            </Button>
            <Button
              variant="ghost"
              onClick={() => void signOutAndRedirect(queryClient, navigate)}
            >
              Sair
            </Button>
          </div>
        </header>

        <section className="mt-10 rounded-xl border border-border bg-surface p-8">
          <h2 className="text-base font-medium text-foreground">Fundação concluída</h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
            Sessão ativa como <span className="font-mono">{data?.email ?? "—"}</span>. Os módulos
            de gestão (seletor e shell, usuários, árvore de organizações, planos e auditoria)
            entram nos blocos 1.7.2 a 1.7.6.
          </p>
        </section>
      </div>
    </main>
  );
}
