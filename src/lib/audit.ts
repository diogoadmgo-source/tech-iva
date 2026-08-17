import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export type AuditEntry = {
  id: number;
  tenant_id: string | null;
  actor_id: string | null;
  actor_role: string | null;
  impersonated_by: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: Json;
  after: Json;
  at: string;
  ip: string | null;
  user_agent: string | null;
};

export type AuditFilters = {
  action: string;
  entity: string;
  actor: string;
  from: string;
  to: string;
};

export const AUDIT_PAGE_SIZE = 25;

export const EMPTY_AUDIT_FILTERS: AuditFilters = {
  action: "",
  entity: "",
  actor: "",
  from: "",
  to: "",
};

/**
 * Auditoria somente leitura. O RLS já limita a `in_scope(tenant_id)`; aqui apenas
 * paginamos e filtramos. O escopo inclui descendentes do tenant ativo.
 */
export function useAuditLog(tenantId: string, filters: AuditFilters, page: number) {
  return useQuery({
    queryKey: ["audit-log", tenantId, filters, page],
    queryFn: async (): Promise<{ rows: AuditEntry[]; total: number }> => {
      const { data: descendants, error: scopeError } = await supabase
        .from("tenants")
        .select("id")
        .order("level");
      if (scopeError) throw scopeError;
      const ids = (descendants ?? []).map((t) => t.id);

      let query = supabase
        .from("audit_log")
        .select(
          "id, tenant_id, actor_id, actor_role, impersonated_by, action, entity, entity_id, before, after, at, ip, user_agent",
          { count: "exact" },
        )
        .order("at", { ascending: false })
        .range(page * AUDIT_PAGE_SIZE, page * AUDIT_PAGE_SIZE + AUDIT_PAGE_SIZE - 1);

      if (ids.length > 0) query = query.in("tenant_id", ids);
      if (filters.action.trim()) query = query.ilike("action", `%${filters.action.trim()}%`);
      if (filters.entity.trim()) query = query.ilike("entity", `%${filters.entity.trim()}%`);
      if (filters.actor.trim()) query = query.eq("actor_id", filters.actor.trim());
      if (filters.from) query = query.gte("at", `${filters.from}T00:00:00Z`);
      if (filters.to) query = query.lte("at", `${filters.to}T23:59:59Z`);

      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as AuditEntry[], total: count ?? 0 };
    },
  });
}

export type DiffLine = {
  key: string;
  before: string;
  after: string;
  changed: boolean;
};

function asRecord(value: Json): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function show(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Diff chave a chave entre before/after para exibição na linha expandida. */
export function jsonDiff(before: Json, after: Json): DiffLine[] {
  const a = asRecord(before);
  const b = asRecord(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys.map((key) => ({
    key,
    before: show(a[key]),
    after: show(b[key]),
    changed: show(a[key]) !== show(b[key]),
  }));
}
