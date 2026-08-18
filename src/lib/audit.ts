import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { EXACT_COUNT_LIMIT, fetchAllPages, useRowCount } from "@/lib/paginate";

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

type Filterable = {
  in: (c: string, v: string[]) => Filterable;
  ilike: (c: string, v: string) => Filterable;
  eq: (c: string, v: string) => Filterable;
  gte: (c: string, v: string) => Filterable;
  lte: (c: string, v: string) => Filterable;
};

/** Mesmos filtros para a página e para a contagem — não podem divergir. */
function applyAuditFilters<Q>(query: Q, filters: AuditFilters, ids: string[]): Q {
  let q = query as unknown as Filterable;
  if (ids.length > 0) q = q.in("tenant_id", ids);
  // '%texto%' (trecho no meio): atendido pelos índices trigram audit_log_action_trgm
  // e audit_log_entity_trgm — índice btree comum não serve para busca infixa.
  if (filters.action.trim()) q = q.ilike("action", `%${filters.action.trim()}%`);
  if (filters.entity.trim()) q = q.ilike("entity", `%${filters.entity.trim()}%`);
  if (filters.actor.trim()) q = q.eq("actor_id", filters.actor.trim());
  if (filters.from) q = q.gte("at", `${filters.from}T00:00:00Z`);
  if (filters.to) q = q.lte("at", `${filters.to}T23:59:59Z`);
  return q as unknown as Q;
}

/** Ids do escopo (tenant ativo + descendentes), cacheados por 5 min. */
function useScopeIds(tenantId: string) {
  return useQuery({
    queryKey: ["audit-scope-ids", tenantId],
    staleTime: 300_000,
    queryFn: async (): Promise<string[]> => {
      // escopo pode passar de 1000 tenants numa plataforma grande: varre página
      // por página em vez de aceitar o corte silencioso do PostgREST.
      const rows = await fetchAllPages<{ id: string }>((from, to) =>
        supabase
          .from("tenants")
          .select("id")
          .order("level")
          .order("id", { ascending: true })
          .range(from, to),
      );
      return rows.map((t) => t.id);
    },
  });
}

/**
 * Auditoria somente leitura. O RLS já limita a `in_scope(tenant_id)`; aqui apenas
 * paginamos e filtramos. O escopo inclui descendentes do tenant ativo.
 *
 * Ordenação `at desc, id desc`: sem o desempate por id, vários registros gravados
 * no mesmo instante trocam de lugar entre páginas — a mesma linha aparece duas
 * vezes ou desaparece. Em trilha de auditoria isso é inaceitável. Índice que
 * cobre exatamente esse ORDER BY: audit_log_tenant_at_id.
 *
 * A CONTAGEM é consulta separada, cacheada pelos filtros (sem a página): antes,
 * cada clique em "próxima" repetia um count(*) sobre a tabela inteira.
 */
export function useAuditLog(tenantId: string, filters: AuditFilters, page: number) {
  const scope = useScopeIds(tenantId);
  const ids = scope.data ?? [];
  const ready = scope.isSuccess;

  const rows = useQuery({
    queryKey: ["audit-log", tenantId, filters, page],
    enabled: ready,
    queryFn: async (): Promise<AuditEntry[]> => {
      const query = supabase
        .from("audit_log")
        .select(
          "id, tenant_id, actor_id, actor_role, impersonated_by, action, entity, entity_id, before, after, at, ip, user_agent",
        )
        .order("at", { ascending: false })
        .order("id", { ascending: false }) // desempate estável entre páginas
        .range(page * AUDIT_PAGE_SIZE, page * AUDIT_PAGE_SIZE + AUDIT_PAGE_SIZE - 1);

      const { data, error } = await applyAuditFilters(query, filters, ids);
      if (error) throw error;
      return (data ?? []) as AuditEntry[];
    },
  });

  const count = useRowCount(
    ["audit-log", tenantId, filters],
    async () => {
      // "estimated": abaixo do limite o PostgREST devolve contagem exata; acima,
      // a estimativa do planejador — sem varrer a trilha inteira.
      const query = supabase.from("audit_log").select("id", { count: "estimated", head: true });
      const { count: n, error } = await applyAuditFilters(query, filters, ids);
      if (error) throw error;
      return n ?? 0;
    },
    ready,
  );

  const total = count.data ?? 0;
  return {
    ...rows,
    data: rows.data
      ? { rows: rows.data, total, approx: total > EXACT_COUNT_LIMIT }
      : undefined,
    isLoading: scope.isLoading || rows.isLoading,
  };
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
