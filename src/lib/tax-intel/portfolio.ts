/**
 * Leituras da carteira e do painel da Inteligência Tributária. Tudo passa pelo
 * PostgREST com a RLS da migration 0240 (escopo do tenant) e conta no banco:
 * nenhum total é calculado a partir do que a tela carregou.
 */
import { stripCnpj } from "./cnpj";
import { taxFrom, type ImportRow } from "./import-client";
import {
  CLASSIFICATIONS,
  type ConsultationStatus,
  type SourceStatus,
  type TaxClassification,
} from "./labels";
import type { RelationshipKind } from "./relationship";

type Count = { count: number | null; error: { message: string } | null };

async function count(q: PromiseLike<Count>): Promise<number> {
  const { count: c, error } = await q;
  if (error) throw new Error(error.message);
  return c ?? 0;
}

/** CNPJs distintos do tenant (tax_entities ligado por tax_relationships). */
function entities(tenantId: string) {
  return taxFrom("tax_entities")
    .select("cnpj, tax_relationships!inner(tenant_id)", { count: "exact", head: true })
    .eq("tax_relationships.tenant_id", tenantId);
}

function relationships(tenantId: string) {
  return taxFrom("tax_relationships")
    .select("cnpj", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
}

export type SourceRow = {
  code: string;
  name: string;
  kind: "dados_abertos" | "api" | "sem_fonte";
  status: SourceStatus;
  coverage: string;
  limitations: string;
  verified_at: string | null;
};

export type AuditRow = {
  id: number;
  action: string;
  target_type: string;
  target_id: string | null;
  actor_role: string | null;
  after: Record<string, unknown> | null;
  at: string;
};

export type Overview = {
  cnpjs: number;
  matrizes: number;
  filiais: number;
  alfanumericos: number;
  clientes: number;
  fornecedores: number;
  byClass: Record<TaxClassification, number>;
  consultations: Record<ConsultationStatus, number>;
  lastConsultedAt: string | null;
  imports: ImportRow[];
  sources: SourceRow[];
  audit: AuditRow[] | null;
};

export async function loadOverview(tenantId: string): Promise<Overview> {
  const classCounts = Promise.all(
    CLASSIFICATIONS.map((c) => count(entities(tenantId).eq("public_classification", c))),
  );
  const statuses: ConsultationStatus[] = ["ok", "nao_encontrado", "erro", "fonte_indisponivel"];
  const consultCounts = Promise.all(
    statuses.map((s) =>
      count(
        taxFrom("tax_consultations").select("id", { count: "exact", head: true }).eq("status", s),
      ),
    ),
  );

  const [cnpjs, matrizes, alfanumericos, clientes, fornecedores, cls, cons, last, imp, src, aud] =
    await Promise.all([
      count(entities(tenantId)),
      count(entities(tenantId).eq("is_matriz", true)),
      count(entities(tenantId).eq("cnpj_alfanumerico", true)),
      count(relationships(tenantId).eq("relationship", "cliente")),
      count(relationships(tenantId).eq("relationship", "fornecedor")),
      classCounts,
      consultCounts,
      taxFrom("tax_entities")
        .select("last_consulted_at, tax_relationships!inner(tenant_id)")
        .eq("tax_relationships.tenant_id", tenantId)
        .not("last_consulted_at", "is", null)
        .order("last_consulted_at", { ascending: false })
        .limit(1),
      taxFrom("tax_imports")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(8),
      taxFrom("tax_sources")
        .select("code, name, kind, status, coverage, limitations, verified_at")
        .order("code"),
      taxFrom("tax_audit_logs")
        .select("id, action, target_type, target_id, actor_role, after, at")
        .eq("tenant_id", tenantId)
        .order("at", { ascending: false })
        .limit(12),
    ]);

  for (const r of [last, imp, src]) if (r.error) throw new Error(r.error.message);

  const byClass = Object.fromEntries(CLASSIFICATIONS.map((c, i) => [c, cls[i]!])) as Record<
    TaxClassification,
    number
  >;
  const consultations = Object.fromEntries(statuses.map((s, i) => [s, cons[i]!])) as Record<
    ConsultationStatus,
    number
  >;

  const imports = (imp.data ?? []) as ImportRow[];
  return {
    cnpjs,
    matrizes,
    filiais: cnpjs - matrizes,
    alfanumericos,
    clientes,
    fornecedores,
    byClass,
    consultations,
    lastConsultedAt:
      ((last.data ?? [])[0] as { last_consulted_at: string } | undefined)?.last_consulted_at ??
      null,
    imports,
    sources: (src.data ?? []) as SourceRow[],
    // Auditoria: só papéis com leitura de auditoria veem (tax_can_read_audit).
    audit: aud.error ? null : ((aud.data ?? []) as AuditRow[]),
  };
}

// ---------------------------------------------------------------------------
// Carteira
// ---------------------------------------------------------------------------
export type PortfolioFilters = {
  q: string;
  rel: RelationshipKind | "todos";
  estrutura: "todas" | "matriz" | "filial";
  classe: TaxClassification | "todas";
  alfanumerico: boolean;
  importId: string | null;
};

export const EMPTY_FILTERS: PortfolioFilters = {
  q: "",
  rel: "todos",
  estrutura: "todas",
  classe: "todas",
  alfanumerico: false,
  importId: null,
};

export type SortKey = "cnpj" | "razao" | "relationship" | "created_at" | "classe";
export type Sort = { key: SortKey; desc: boolean };

export type PortfolioRow = {
  tenant_id: string;
  cnpj: string;
  relationship: RelationshipKind;
  declared_razao_social: string | null;
  declared_nome_fantasia: string | null;
  first_import_id: string | null;
  last_import_id: string | null;
  created_at: string;
  tax_entities: {
    cnpj_raiz: string;
    is_matriz: boolean;
    cnpj_alfanumerico: boolean;
    razao_social: string | null;
    situacao_cadastral: string | null;
    uf: string | null;
    municipio: string | null;
    public_classification: TaxClassification;
    last_consulted_at: string | null;
  };
};

const SELECT =
  "tenant_id, cnpj, relationship, declared_razao_social, declared_nome_fantasia, first_import_id, last_import_id, created_at, " +
  "tax_entities!inner(cnpj_raiz, is_matriz, cnpj_alfanumerico, razao_social, situacao_cadastral, uf, municipio, public_classification, last_consulted_at)";

const ORDER: Record<SortKey, string> = {
  cnpj: "cnpj",
  razao: "declared_razao_social",
  relationship: "relationship",
  created_at: "created_at",
  classe: "tax_entities(public_classification)",
};

/** Busca: CNPJ (com ou sem máscara, prefixo) ou nome declarado. */
export function searchClause(
  q: string,
): { kind: "cnpj"; value: string } | { kind: "nome"; value: string } | null {
  const t = q.trim();
  if (!t) return null;
  const stripped = stripCnpj(t) ?? "";
  if (!/\s/.test(t) && /\d/.test(stripped) && /^[0-9A-Z]{2,14}$/.test(stripped)) {
    return { kind: "cnpj", value: stripped };
  }
  // Remove caracteres que quebram a sintaxe do filtro `or` do PostgREST.
  return { kind: "nome", value: t.replace(/[,()*%]/g, " ").trim() };
}

function portfolioQuery(
  tenantId: string,
  f: PortfolioFilters,
  s: Sort,
  opts?: { count?: boolean },
) {
  let q = taxFrom("tax_relationships")
    .select(SELECT, opts?.count ? { count: "exact" } : undefined)
    .eq("tenant_id", tenantId);
  if (f.rel !== "todos") q = q.eq("relationship", f.rel);
  if (f.estrutura !== "todas") q = q.eq("tax_entities.is_matriz", f.estrutura === "matriz");
  if (f.classe !== "todas") q = q.eq("tax_entities.public_classification", f.classe);
  if (f.alfanumerico) q = q.eq("tax_entities.cnpj_alfanumerico", true);
  if (f.importId) q = q.or(`first_import_id.eq.${f.importId},last_import_id.eq.${f.importId}`);
  const sc = searchClause(f.q);
  if (sc?.kind === "cnpj") q = q.like("cnpj", `${sc.value}%`);
  if (sc?.kind === "nome" && sc.value)
    q = q.or(
      `declared_razao_social.ilike.*${sc.value}*,declared_nome_fantasia.ilike.*${sc.value}*`,
    );
  q = q.order(ORDER[s.key], { ascending: !s.desc, nullsFirst: false });
  if (s.key !== "cnpj") q = q.order("cnpj");
  return q.order("relationship");
}

export async function loadPortfolioPage(
  tenantId: string,
  f: PortfolioFilters,
  s: Sort,
  page: number,
  pageSize: number,
): Promise<{ rows: PortfolioRow[]; total: number }> {
  const {
    data,
    error,
    count: c,
  } = await portfolioQuery(tenantId, f, s, { count: true }).range(
    page * pageSize,
    page * pageSize + pageSize - 1,
  );
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as PortfolioRow[], total: c ?? 0 };
}

/** Todas as linhas do filtro, em páginas de 1.000 (limite do PostgREST). */
export async function loadPortfolioAll(
  tenantId: string,
  f: PortfolioFilters,
  s: Sort,
  onProgress?: (loaded: number) => void,
  max = 100_000,
): Promise<PortfolioRow[]> {
  const out: PortfolioRow[] = [];
  const size = 1000;
  for (let page = 0; out.length < max; page++) {
    const { data, error } = await portfolioQuery(tenantId, f, s).range(
      page * size,
      page * size + size - 1,
    );
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as PortfolioRow[];
    out.push(...rows);
    onProgress?.(out.length);
    if (rows.length < size) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Detalhe de um CNPJ
// ---------------------------------------------------------------------------
export type ConsultationRow = {
  id: string;
  source_code: string;
  dataset_version: string | null;
  status: ConsultationStatus;
  error: string | null;
  consulted_at: string;
};
export type RegimeHistoryRow = {
  ano: number;
  forma_tributacao_original: string;
  regime_normalizado: string;
  dataset_version: string;
};
export type EventRow = {
  event_type: string;
  event_date: string | null;
  effective_date: string | null;
  detected_at: string;
};

export type EntityDetail = {
  relationships: PortfolioRow[];
  imports: Pick<ImportRow, "id" | "file_name" | "created_at">[];
  consultations: ConsultationRow[];
  history: RegimeHistoryRow[];
  events: EventRow[];
  basis: Record<string, unknown>;
};

export async function loadEntityDetail(tenantId: string, cnpj: string): Promise<EntityDetail> {
  const raiz = cnpj.slice(0, 8);
  const [rels, ent, cons, hist, ev] = await Promise.all([
    taxFrom("tax_relationships").select(SELECT).eq("tenant_id", tenantId).eq("cnpj", cnpj),
    taxFrom("tax_entities").select("public_classification_basis").eq("cnpj", cnpj).maybeSingle(),
    taxFrom("tax_consultations")
      .select("id, source_code, dataset_version, status, error, consulted_at")
      .in("lookup_key", [cnpj, raiz])
      .order("consulted_at", { ascending: false })
      .limit(20),
    taxFrom("tax_regime_history")
      .select("ano, forma_tributacao_original, regime_normalizado, dataset_version")
      .eq("cnpj_raiz", raiz)
      .order("ano", { ascending: false })
      .limit(20),
    taxFrom("tax_regime_events")
      .select("event_type, event_date, effective_date, detected_at")
      .in("lookup_key", [cnpj, raiz])
      .order("detected_at", { ascending: false })
      .limit(20),
  ]);
  for (const r of [rels, ent, cons, hist, ev]) if (r.error) throw new Error(r.error.message);
  const relationships = (rels.data ?? []) as PortfolioRow[];
  const ids = [
    ...new Set(relationships.flatMap((r) => [r.first_import_id, r.last_import_id]).filter(Boolean)),
  ] as string[];
  let imports: EntityDetail["imports"] = [];
  if (ids.length) {
    const { data, error } = await taxFrom("tax_imports")
      .select("id, file_name, created_at")
      .in("id", ids);
    if (error) throw new Error(error.message);
    imports = data ?? [];
  }
  return {
    relationships,
    imports,
    consultations: (cons.data ?? []) as ConsultationRow[],
    history: (hist.data ?? []) as RegimeHistoryRow[],
    events: (ev.data ?? []) as EventRow[],
    basis: ((ent.data as { public_classification_basis?: Record<string, unknown> } | null)
      ?.public_classification_basis ?? {}) as Record<string, unknown>,
  };
}
