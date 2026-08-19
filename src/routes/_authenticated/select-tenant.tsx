import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { AuthShell, FormError } from "@/components/auth/auth-shell";
import { InfoHint } from "@/components/techiva/info-hint";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { KIND_LABELS, ROLE_LABELS, authErrorMessage, signOutAndRedirect } from "@/lib/auth";
import { EmptyState } from "@/components/techiva/empty-state";
import { filterScopeTree, useMyTenants, type ScopeTreeNode } from "@/lib/tenant-scope";

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

function SelectTenantPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // my_tenants(): TODO o escopo hierárquico, não apenas os vínculos diretos.
  const { data, isLoading, error: queryError } = useMyTenants();
  const tree = filterScopeTree(data?.tree ?? [], query);

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

  function renderNode(node: ScopeTreeNode) {
    return (
      <div key={node.id} className="space-y-1">
        <button
          type="button"
          onClick={() => void choose(node.id)}
          style={{ marginLeft: `${node.depth * 16}px` }}
          className="flex w-full items-center justify-between gap-4 rounded-lg border border-border bg-background/40 px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-accent"
        >
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              {node.depth > 0 ? (
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              ) : null}
              <span className="truncate text-sm font-medium text-foreground">{node.name}</span>
              <Badge variant="outline" className="text-[10px]">
                {KIND_LABELS[node.kind]}
              </Badge>
            </span>
            <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
              nível {node.level}
              {node.slug ? ` · ${node.slug}` : ""}
              {node.cnpj ? ` · ${node.cnpj}` : ""}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            {node.papel ? <Badge variant="secondary">{ROLE_LABELS[node.papel]}</Badge> : null}
            <Badge variant={node.membership_direta ? "default" : "outline"} className="text-[10px]">
              {node.membership_direta ? "vínculo direto" : "por hierarquia"}
            </Badge>
          </span>
        </button>
        {node.children.map(renderNode)}
      </div>
    );
  }

  return (
    <AuthShell
      wide
      title="Selecionar organização"
      subtitle="Escolha onde operar."
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
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg border border-border bg-muted/40"
            />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <FormError message={error ?? (queryError ? authErrorMessage(queryError) : null)} />

          <div className="flex items-center gap-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por nome, slug ou CNPJ…"
              aria-label="Buscar organização"
            />
            <InfoHint title="Sobre o escopo">
              <p>
                Todo o seu escopo em árvore: você abre também os níveis abaixo do seu vínculo.
              </p>
              <p>
                "Por hierarquia" significa acesso de visita: as ações ficam registradas na
                auditoria e o seu papel efetivo continua valendo.
              </p>
            </InfoHint>
          </div>

          {tree.length === 0 ? (
            <EmptyState title="Nenhuma organização encontrada no seu escopo." />
          ) : (
            <div className="space-y-1">{tree.map(renderNode)}</div>
          )}
        </div>
      )}
    </AuthShell>
  );
}
