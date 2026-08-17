import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import type { TenantKind } from "@/lib/auth";
import { startImpersonation, stopImpersonation } from "@/lib/impersonation.functions";
import type { Brand } from "@/lib/tenant-nav";

export type TenantStatus = "active" | "suspended" | "archived";

export type TenantNode = {
  id: string;
  parent_id: string | null;
  name: string;
  kind: TenantKind;
  level: number;
  slug: string | null;
  cnpj: string | null;
  status: TenantStatus;
  brand: Brand | null;
  created_at: string;
  children: TenantNode[];
};

/** Tipos de filho válidos por tipo de pai — espelha create_tenant(). */
export const CHILD_KINDS: Record<TenantKind, TenantKind[]> = {
  platform: ["channel", "company"],
  channel: ["company"],
  company: ["unit"],
  unit: [],
};

export const STATUS_LABELS: Record<TenantStatus, string> = {
  active: "Ativa",
  suspended: "Suspensa",
  archived: "Arquivada",
};

export function useTenantTree(rootId: string) {
  return useQuery({
    queryKey: ["tenant-tree", rootId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, parent_id, name, kind, level, slug, cnpj, status, brand, created_at")
        .order("level")
        .order("name");
      if (error) throw error;

      const rows = (data ?? []) as Array<Omit<TenantNode, "children">>;
      const nodes = new Map<string, TenantNode>(
        rows.map((row) => [row.id, { ...row, children: [] }]),
      );
      for (const node of nodes.values()) {
        const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
        if (parent) parent.children.push(node);
      }
      const root = nodes.get(rootId) ?? null;
      return { root, all: [...nodes.values()] };
    },
  });
}

export function useTenantSubscription(tenantId: string) {
  return useQuery({
    queryKey: ["tenant-plan", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("status, plans(code, name)")
        .eq("tenant_id", tenantId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useTenantMutations(rootId: string) {
  const queryClient = useQueryClient();

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tenant-tree", rootId] }),
      queryClient.invalidateQueries({ queryKey: ["tenant-shell"] }),
      queryClient.invalidateQueries({ queryKey: ["my-tenants"] }),
    ]);
  }

  const create = useMutation({
    mutationFn: async (input: {
      parentId: string;
      kind: TenantKind;
      name: string;
      cnpj?: string | null;
      slug?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("create_tenant", {
        p_parent: input.parentId,
        p_kind: input.kind,
        p_name: input.name,
        p_cnpj: input.cnpj ?? undefined,
        p_slug: input.slug ?? undefined,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: refresh,
  });

  const update = useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      status?: TenantStatus;
      brand?: Brand;
    }) => {
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch["name"] = input.name;
      if (input.status !== undefined) patch["status"] = input.status;
      if (input.brand !== undefined) patch["brand"] = input.brand;
      const { error } = await supabase.from("tenants").update(patch).eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  return { create, update };
}

export type ImpersonationState = {
  tenantId: string;
  tenantName: string | null;
  expiresAt: string;
} | null;

/** Lê o claim impersonated_tenant do JWT da sessão atual. */
export function useImpersonation() {
  return useQuery({
    queryKey: ["impersonation"],
    queryFn: async (): Promise<ImpersonationState> => {
      const { data } = await supabase.auth.getSession();
      const meta = (data.session?.user.app_metadata ?? {}) as Record<string, unknown>;
      const tenantId = meta["impersonated_tenant"];
      const expiresAt = meta["impersonation_expires_at"];
      if (typeof tenantId !== "string" || typeof expiresAt !== "string") return null;
      if (new Date(expiresAt).getTime() <= Date.now()) return null;
      return {
        tenantId,
        tenantName:
          typeof meta["impersonated_tenant_name"] === "string"
            ? (meta["impersonated_tenant_name"] as string)
            : null,
        expiresAt,
      };
    },
    refetchInterval: 60_000,
  });
}

export function useImpersonationMutations() {
  const queryClient = useQueryClient();
  const start = useServerFn(startImpersonation);
  const stop = useServerFn(stopImpersonation);

  async function refresh() {
    await supabase.auth.refreshSession();
    await queryClient.invalidateQueries({ queryKey: ["impersonation"] });
  }

  return {
    start: useMutation({
      mutationFn: async (tenantId: string) => {
        const result = await start({ data: { tenantId } });
        await refresh();
        return result;
      },
    }),
    stop: useMutation({
      mutationFn: async () => {
        const result = await stop({ data: undefined });
        await refresh();
        return result;
      },
    }),
  };
}
