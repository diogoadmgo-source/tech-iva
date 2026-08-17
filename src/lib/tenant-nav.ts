import type { TenantKind } from "@/lib/auth";

export type NavItem = {
  label: string;
  /** Bloco da especificação que entrega a tela. */
  block: string;
  /** Rota já implementada (relativa ao tenant ativo); ausente = tela futura. */
  to?: "/t/$tenantId/settings/users";
};

/** Itens da sidebar por tipo de tenant (documento 01 §1.7.2). */
export const NAV_BY_KIND: Record<TenantKind, NavItem[]> = {
  platform: [
    { label: "Organizações", block: "1.7.4" },
    { label: "Planos", block: "1.7.5" },
    { label: "Regras", block: "1.7.5" },
    { label: "Operações", block: "1.7.6" },
    { label: "Crédito", block: "1.7.5" },
    { label: "Auditoria", block: "1.7.6" },
    { label: "Usuários", block: "1.7.3", to: "/t/$tenantId/settings/users" },
  ],
  channel: [
    { label: "Carteira", block: "1.7.4" },
    { label: "Empresas", block: "1.7.4" },
    { label: "Usuários", block: "1.7.3", to: "/t/$tenantId/settings/users" },
    { label: "Marca", block: "1.7.4" },
    { label: "Comissões", block: "1.7.5" },
  ],
  company: [
    { label: "Caixa", block: "1.7.5" },
    { label: "Carteira", block: "1.7.5" },
    { label: "Preço", block: "1.7.5" },
    { label: "Regime", block: "1.7.5" },
    { label: "Financiamento", block: "1.7.5" },
    { label: "Configurações", block: "1.7.3", to: "/t/$tenantId/settings/users" },
  ],
  unit: [
    { label: "Caixa", block: "1.7.5" },
    { label: "Carteira", block: "1.7.5" },
    { label: "Preço", block: "1.7.5" },
    { label: "Regime", block: "1.7.5" },
    { label: "Financiamento", block: "1.7.5" },
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
