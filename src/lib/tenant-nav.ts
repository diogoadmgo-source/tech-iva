import type { TenantKind } from "@/lib/auth";

export type NavItem = {
  label: string;
  /** Bloco da especificação que entrega a tela. */
  block: string;
  /** Rota já implementada (relativa ao tenant ativo); ausente = tela futura. */
  to?:
    | "/t/$tenantId/cash"
    | "/t/$tenantId/apuracao"
    | "/t/$tenantId/chain"
    | "/t/$tenantId/simulador"
    | "/t/$tenantId/validador"

    | "/t/$tenantId/regime"
    | "/t/$tenantId/portfolio"
    | "/t/$tenantId/brand"
    | "/t/$tenantId/companies"
    | "/t/$tenantId/commissions"
    | "/t/$tenantId/reports"
    | "/t/$tenantId/onboarding"
    | "/t/$tenantId/price"
    | "/t/$tenantId/finance"
    | "/t/$tenantId/settings/users"
    | "/t/$tenantId/settings/integrations"
    | "/t/$tenantId/tenants"
    | "/t/$tenantId/plans"
    | "/t/$tenantId/audit"
    | "/t/$tenantId/rules"
    | "/t/$tenantId/ops"
    | "/t/$tenantId/alerts"
    | "/t/$tenantId/features";
  /** Módulo obrigatório: o item só aparece se feature_enabled(tenant, feature). */
  feature?: "credit";
};

/** Itens da sidebar por tipo de tenant (documento 01 §1.7.2). */
export const NAV_BY_KIND: Record<TenantKind, NavItem[]> = {
  platform: [
    { label: "Organizações", block: "1.7.4", to: "/t/$tenantId/tenants" },
    { label: "Planos", block: "1.7.5", to: "/t/$tenantId/plans" },
    { label: "Regras", block: "3.9", to: "/t/$tenantId/rules" },
    { label: "Operações", block: "3.9", to: "/t/$tenantId/ops" },
    { label: "Alertas", block: "3.10", to: "/t/$tenantId/alerts" },
    { label: "Módulo de crédito", block: "1.7.5", to: "/t/$tenantId/features" },
    { label: "Comissões", block: "3.6", to: "/t/$tenantId/commissions" },
    { label: "Auditoria", block: "1.7.6", to: "/t/$tenantId/audit" },
    { label: "Usuários", block: "1.7.3", to: "/t/$tenantId/settings/users" },
  ],
  channel: [
    { label: "Carteira", block: "3.6", to: "/t/$tenantId/portfolio" },
    { label: "Empresas", block: "3.6", to: "/t/$tenantId/companies" },
    { label: "Usuários", block: "1.7.3", to: "/t/$tenantId/settings/users" },
    { label: "Marca", block: "3.6", to: "/t/$tenantId/brand" },
    { label: "Relatórios", block: "3.6", to: "/t/$tenantId/reports" },
    { label: "Comissões", block: "3.6", to: "/t/$tenantId/commissions" },
    { label: "Alertas", block: "3.10", to: "/t/$tenantId/alerts" },
    { label: "Assinaturas", block: "1.7.5", to: "/t/$tenantId/plans" },
    { label: "Auditoria", block: "1.7.6", to: "/t/$tenantId/audit" },
  ],
  company: [
    { label: "Caixa", block: "3.4", to: "/t/$tenantId/cash" },
    { label: "Onboarding", block: "3.2", to: "/t/$tenantId/onboarding" },
    { label: "Assinatura", block: "1.7.5", to: "/t/$tenantId/plans" },
    { label: "Auditoria", block: "1.7.6", to: "/t/$tenantId/audit" },
    { label: "Carteira", block: "3.3", to: "/t/$tenantId/chain" },
    { label: "Preço", block: "3.7", to: "/t/$tenantId/price" },
    { label: "Apuração", block: "3.12", to: "/t/$tenantId/apuracao" },
    { label: "Simulador", block: "3.13", to: "/t/$tenantId/simulador" },
    { label: "Validador de XML", block: "3.13", to: "/t/$tenantId/validador" },
    { label: "Regime", block: "3.5", to: "/t/$tenantId/regime" },
    { label: "Financiamento", block: "3.8", to: "/t/$tenantId/finance", feature: "credit" },
    { label: "Integrações", block: "1.7.3", to: "/t/$tenantId/settings/integrations" },
    { label: "Alertas", block: "3.10", to: "/t/$tenantId/alerts" },
    { label: "Configurações", block: "1.7.3", to: "/t/$tenantId/settings/users" },
  ],
  unit: [
    { label: "Caixa", block: "3.4", to: "/t/$tenantId/cash" },
    { label: "Auditoria", block: "1.7.6", to: "/t/$tenantId/audit" },
    { label: "Carteira", block: "3.3", to: "/t/$tenantId/chain" },
    { label: "Preço", block: "3.7", to: "/t/$tenantId/price" },
    { label: "Apuração", block: "3.12", to: "/t/$tenantId/apuracao" },
    { label: "Simulador", block: "3.13", to: "/t/$tenantId/simulador" },
    { label: "Validador de XML", block: "3.13", to: "/t/$tenantId/validador" },
    { label: "Regime", block: "3.5", to: "/t/$tenantId/regime" },
    { label: "Financiamento", block: "3.8", to: "/t/$tenantId/finance", feature: "credit" },
    { label: "Integrações", block: "1.7.3", to: "/t/$tenantId/settings/integrations" },
    { label: "Alertas", block: "3.10", to: "/t/$tenantId/alerts" },
    { label: "Configurações", block: "1.7.3", to: "/t/$tenantId/settings/users" },
  ],
};

export type Brand = {
  logo_url?: string | null;
  color?: string | null;
  name?: string | null;
};

/** Lê o brand do canal ancestral mais próximo; cai para a plataforma. */
export function resolveBrand(
  chain: Array<{ kind: TenantKind; brand: unknown; name: string }>,
): Brand & { source: string } {
  const ordered = [...chain].reverse(); // do tenant ativo para a raiz
  const channel = ordered.find((t) => t.kind === "channel" && hasBrand(t.brand));
  const platform = ordered.find((t) => t.kind === "platform" && hasBrand(t.brand));
  const picked = channel ?? platform;
  if (!picked) return { source: "TECH-IVA" };
  const brand = picked.brand as Brand;
  return {
    logo_url: brand.logo_url ?? null,
    color: brand.color ?? null,
    name: brand.name ?? picked.name,
    source: picked.name,
  };
}

function hasBrand(brand: unknown): boolean {
  if (!brand || typeof brand !== "object") return false;
  const b = brand as Brand;
  return Boolean(b.logo_url || b.color || b.name);
}
