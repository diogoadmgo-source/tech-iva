import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BadgeDollarSign,
  Banknote,
  Bell,
  BookOpen,
  Building2,
  Calculator,
  FileText,
  Gauge,
  Layers,
  Megaphone,
  Network,
  Palette,
  PlugZap,
  Rocket,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  Tag,
  ToggleLeft,
  Users,
} from "lucide-react";

import type { MemberRole, TenantKind } from "@/lib/auth";

export type NavRoute =
  | "/t/$tenantId"
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
  | "/t/$tenantId/features"
  | "/t/$tenantId/notices"
  | "/t/$tenantId/settings";

export type NavBadge = "alerts" | "jobs";

export type NavItem = {
  label: string;
  /** Bloco da especificação que entrega a tela. */
  block: string;
  icon: LucideIcon;
  /** Rota já implementada (relativa ao tenant ativo); ausente = tela futura. */
  to?: NavRoute;
  /** Módulo obrigatório: o item só aparece se feature_enabled(tenant, feature). */
  feature?: "credit";
  /**
   * Guarda por PAPEL EFETIVO (tenant_context.papel), nunca por kind do tenant.
   * Ausente = visível para qualquer papel com leitura no tenant.
   */
  roles?: MemberRole[];
  /** Contador discreto à direita. */
  badge?: NavBadge;
};

export type NavGroup = { label: string; items: NavItem[] };

/** Papéis de escrita/administração. */
const MANAGERS: MemberRole[] = ["platform_admin", "platform_ops", "channel_admin", "owner"];
const PLATFORM_MANAGERS: MemberRole[] = ["platform_admin", "platform_ops"];
const BILLING: MemberRole[] = [...MANAGERS, "finance"];
const AUDITORS: MemberRole[] = [
  "platform_admin",
  "platform_ops",
  "platform_risk",
  "channel_admin",
  "owner",
  "finance",
];

const OVERVIEW: NavItem = { label: "Visão geral", block: "1.7.2", icon: Gauge, to: "/t/$tenantId" };

/**
 * Sidebar em grupos rotulados por tipo de tenant (documento 01 §1.7.2).
 * A composição segue o KIND do tenant aberto; a visibilidade de cada item
 * segue o PAPEL EFETIVO do usuário nesse tenant.
 */
export const NAV_GROUPS_BY_KIND: Record<TenantKind, NavGroup[]> = {
  platform: [
    {
      label: "Operação",
      items: [
        OVERVIEW,
        { label: "Tenants", block: "1.7.4", icon: Building2, to: "/t/$tenantId/tenants" },
        {
          label: "Operações",
          block: "3.9",
          icon: Activity,
          to: "/t/$tenantId/ops",
          roles: PLATFORM_MANAGERS,
          badge: "jobs",
        },
        {
          label: "Alertas",
          block: "3.10",
          icon: Bell,
          to: "/t/$tenantId/alerts",
          badge: "alerts",
        },
      ],
    },
    {
      label: "Produto",
      items: [
        { label: "Planos", block: "1.7.5", icon: Layers, to: "/t/$tenantId/plans", roles: BILLING },
        {
          label: "Módulos",
          block: "1.7.5",
          icon: ToggleLeft,
          to: "/t/$tenantId/features",
          roles: PLATFORM_MANAGERS,
        },
        {
          label: "Regras fiscais",
          block: "3.9",
          icon: BookOpen,
          to: "/t/$tenantId/rules",
          roles: PLATFORM_MANAGERS,
        },
        {
          label: "Avisos",
          block: "3.13",
          icon: Megaphone,
          to: "/t/$tenantId/notices",
          roles: PLATFORM_MANAGERS,
        },
        {
          label: "Comissões",
          block: "3.6",
          icon: BadgeDollarSign,
          to: "/t/$tenantId/commissions",
          roles: BILLING,
        },
      ],
    },
    {
      label: "Governança",
      items: [
        { label: "Auditoria", block: "1.7.6", icon: ScrollText, to: "/t/$tenantId/audit", roles: AUDITORS },
        {
          label: "Usuários",
          block: "1.7.3",
          icon: Users,
          to: "/t/$tenantId/settings/users",
          roles: MANAGERS,
        },
        {
          label: "Configurações da plataforma",
          block: "3.13",
          icon: Settings,
          to: "/t/$tenantId/settings",
          roles: PLATFORM_MANAGERS,
        },
      ],
    },
  ],
  channel: [
    {
      label: "Carteira",
      items: [
        OVERVIEW,
        { label: "Visão da carteira", block: "3.6", icon: Network, to: "/t/$tenantId/portfolio" },
        { label: "Empresas", block: "3.6", icon: Building2, to: "/t/$tenantId/companies" },
        { label: "Relatórios", block: "3.6", icon: FileText, to: "/t/$tenantId/reports" },
      ],
    },
    {
      label: "Negócio",
      items: [
        {
          label: "Comissões",
          block: "3.6",
          icon: BadgeDollarSign,
          to: "/t/$tenantId/commissions",
          roles: BILLING,
        },
        { label: "Assinaturas", block: "1.7.5", icon: Layers, to: "/t/$tenantId/plans", roles: BILLING },
      ],
    },
    {
      label: "Configuração",
      items: [
        { label: "Marca", block: "3.6", icon: Palette, to: "/t/$tenantId/brand", roles: MANAGERS },
        {
          label: "Usuários",
          block: "1.7.3",
          icon: Users,
          to: "/t/$tenantId/settings/users",
          roles: MANAGERS,
        },
      ],
    },
    {
      label: "Gestão",
      items: [
        { label: "Alertas", block: "3.10", icon: Bell, to: "/t/$tenantId/alerts", badge: "alerts" },
        { label: "Auditoria", block: "1.7.6", icon: ScrollText, to: "/t/$tenantId/audit", roles: AUDITORS },
      ],
    },
  ],
  company: [
    {
      label: "Caixa e tributo",
      items: [
        OVERVIEW,
        { label: "Caixa do imposto", block: "3.4", icon: Banknote, to: "/t/$tenantId/cash" },
        { label: "Apuração", block: "3.12", icon: FileText, to: "/t/$tenantId/apuracao" },
        { label: "Preço", block: "3.7", icon: Tag, to: "/t/$tenantId/price" },
        {
          label: "Financiamento",
          block: "3.8",
          icon: Banknote,
          to: "/t/$tenantId/finance",
          feature: "credit",
          roles: BILLING,
        },
      ],
    },
    {
      label: "Cadeia",
      items: [
        { label: "Carteira", block: "3.3", icon: Network, to: "/t/$tenantId/chain" },
        { label: "Regime", block: "3.5", icon: Scale, to: "/t/$tenantId/regime" },
      ],
    },
    {
      label: "Ferramentas",
      items: [
        { label: "Simulador", block: "3.13", icon: Calculator, to: "/t/$tenantId/simulador" },
        { label: "Validador", block: "3.13", icon: ShieldCheck, to: "/t/$tenantId/validador" },
      ],
    },
    {
      label: "Gestão",
      items: [
        { label: "Alertas", block: "3.10", icon: Bell, to: "/t/$tenantId/alerts", badge: "alerts" },
        {
          label: "Onboarding",
          block: "3.2",
          icon: Rocket,
          to: "/t/$tenantId/onboarding",
          roles: MANAGERS,
        },
        {
          label: "Integrações",
          block: "1.7.3",
          icon: PlugZap,
          to: "/t/$tenantId/settings/integrations",
          roles: MANAGERS,
        },
        {
          label: "Usuários",
          block: "1.7.3",
          icon: Users,
          to: "/t/$tenantId/settings/users",
          roles: MANAGERS,
        },
        { label: "Assinatura", block: "1.7.5", icon: Layers, to: "/t/$tenantId/plans", roles: BILLING },
        { label: "Auditoria", block: "1.7.6", icon: ScrollText, to: "/t/$tenantId/audit", roles: AUDITORS },
      ],
    },
  ],
  unit: [
    {
      label: "Caixa e tributo",
      items: [
        OVERVIEW,
        { label: "Caixa do imposto", block: "3.4", icon: Banknote, to: "/t/$tenantId/cash" },
        { label: "Apuração", block: "3.12", icon: FileText, to: "/t/$tenantId/apuracao" },
        { label: "Preço", block: "3.7", icon: Tag, to: "/t/$tenantId/price" },
        {
          label: "Financiamento",
          block: "3.8",
          icon: Banknote,
          to: "/t/$tenantId/finance",
          feature: "credit",
          roles: BILLING,
        },
      ],
    },
    {
      label: "Cadeia",
      items: [
        { label: "Carteira", block: "3.3", icon: Network, to: "/t/$tenantId/chain" },
        { label: "Regime", block: "3.5", icon: Scale, to: "/t/$tenantId/regime" },
      ],
    },
    {
      label: "Ferramentas",
      items: [
        { label: "Simulador", block: "3.13", icon: Calculator, to: "/t/$tenantId/simulador" },
        { label: "Validador", block: "3.13", icon: ShieldCheck, to: "/t/$tenantId/validador" },
      ],
    },
    {
      label: "Gestão",
      items: [
        { label: "Alertas", block: "3.10", icon: Bell, to: "/t/$tenantId/alerts", badge: "alerts" },
        {
          label: "Usuários",
          block: "1.7.3",
          icon: Users,
          to: "/t/$tenantId/settings/users",
          roles: MANAGERS,
        },
        { label: "Auditoria", block: "1.7.6", icon: ScrollText, to: "/t/$tenantId/audit", roles: AUDITORS },
      ],
    },
  ],
};

/** Rótulo do tipo de tenant usado no cabeçalho de contexto da sidebar. */
export const CONTEXT_KIND_LABELS: Record<TenantKind, string> = {
  platform: "Plataforma",
  channel: "Canal contábil",
  company: "Empresa",
  unit: "Unidade",
};

/** Aplica feature flags e guarda por papel efetivo. */
export function visibleNavGroups(
  kind: TenantKind,
  papel: MemberRole | null,
  flags: { credit: boolean },
): NavGroup[] {
  return NAV_GROUPS_BY_KIND[kind]
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.feature === "credit" && !flags.credit) return false;
        if (item.roles && (!papel || !item.roles.includes(papel))) return false;
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);
}

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

/** Formata CNPJ para exibição em mono. */
export function formatCnpj(cnpj: string | null): string | null {
  if (!cnpj) return null;
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return cnpj;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}
