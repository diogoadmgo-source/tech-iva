import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { MemberRole, TenantKind } from "@/lib/auth";
import type { TenantStatus } from "@/lib/tenants";

/**
 * Escopo de navegação (migration 0100).
 *
 * my_tenants() devolve TODO o escopo hierárquico do usuário — não apenas os
 * tenants com membership direta. Isso é o que permite o platform_admin abrir
 * uma empresa e o channel_admin abrir as empresas da carteira. A permissão
 * sempre existiu (in_scope cobre descendentes); faltava o caminho na navegação.
 */
export type ScopeNode = {
  id: string;
  parent_id: string | null;
  name: string;
  kind: TenantKind;
  cnpj: string | null;
  slug: string | null;
  level: number;
  path: string;
  status: TenantStatus;
  papel: MemberRole | null;
  /** true = vínculo direto; false = acesso por hierarquia (visita). */
  membership_direta: boolean;
  credito_habilitado: boolean;
};

export type ScopeTreeNode = ScopeNode & { children: ScopeTreeNode[]; depth: number };

/** Monta a árvore (plataforma > canais > empresas > unidades) a partir do path. */
export function buildScopeTree(rows: ScopeNode[]): ScopeTreeNode[] {
  const nodes = new Map<string, ScopeTreeNode>(
    rows.map((row) => [row.id, { ...row, children: [], depth: 0 }]),
  );
  const roots: ScopeTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const byName = (a: ScopeTreeNode, b: ScopeTreeNode) => a.name.localeCompare(b.name, "pt-BR");
  function sort(list: ScopeTreeNode[], depth: number) {
    list.sort(byName);
    for (const node of list) {
      node.depth = depth;
      sort(node.children, depth + 1);
    }
  }
  sort(roots, 0);
  return roots;
}

/** Achata a árvore preservando a ordem visual (para listas e para o ⌘K). */
export function flattenScopeTree(roots: ScopeTreeNode[]): ScopeTreeNode[] {
  const out: ScopeTreeNode[] = [];
  const walk = (list: ScopeTreeNode[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(roots);
  return out;
}

/** Filtra a árvore por termo, mantendo os ancestrais dos nós que casam. */
export function filterScopeTree(roots: ScopeTreeNode[], term: string): ScopeTreeNode[] {
  const q = term.trim().toLowerCase();
  if (!q) return roots;
  const matches = (node: ScopeTreeNode) =>
    node.name.toLowerCase().includes(q) ||
    (node.slug ?? "").toLowerCase().includes(q) ||
    (node.cnpj ?? "").replace(/\D/g, "").includes(q.replace(/\D/g, "") || "\u0000");

  const prune = (list: ScopeTreeNode[]): ScopeTreeNode[] =>
    list
      .map((node) => ({ ...node, children: prune(node.children) }))
      .filter((node) => node.children.length > 0 || matches(node));
  return prune(roots);
}

export function useMyTenants() {
  return useQuery({
    queryKey: ["my-tenants"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_tenants");
      if (error) throw error;
      const rows = (data ?? []) as unknown as ScopeNode[];
      return { rows, tree: buildScopeTree(rows) };
    },
    staleTime: 60_000,
  });
}

export type TenantContextAncestor = { id: string; name: string; kind: TenantKind };

export type TenantContext = {
  id: string;
  name: string;
  kind: TenantKind;
  cnpj: string | null;
  level: number;
  papel: MemberRole | null;
  membership_direta: boolean;
  /** true quando o acesso vem da hierarquia, não de vínculo direto. */
  visitando: boolean;
  ancestrais: TenantContextAncestor[];
  filhos: number;
  credito_habilitado: boolean;
  marca: Record<string, unknown>;
};

export function useTenantContext(tenantId: string) {
  return useQuery({
    queryKey: ["tenant-context", tenantId],
    queryFn: async (): Promise<TenantContext> => {
      const { data, error } = await supabase.rpc("tenant_context", { p_tenant: tenantId });
      if (error) throw error;
      return data as unknown as TenantContext;
    },
  });
}
