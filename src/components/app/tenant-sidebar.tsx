import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Eye,
  LogOut,
  UserRound,
} from "lucide-react";

import { BrandIcon, BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ROLE_LABELS, signOutAndRedirect, type MemberRole } from "@/lib/auth";
import { useAlerts } from "@/lib/cash";
import { useFeature } from "@/lib/features";
import { useJobs } from "@/lib/jobs";
import { prefetchRouteData } from "@/lib/nav-prefetch";
import {
  CONTEXT_KIND_LABELS,
  formatCnpj,
  resolveBrand,
  visibleNavGroups,
  type NavItem,
} from "@/lib/tenant-nav";
import type { TenantContext } from "@/lib/tenant-scope";
import type { ShellTenant } from "@/components/app/tenant-shell";

type Props = {
  tenant: ShellTenant;
  chain: ShellTenant[];
  context: TenantContext;
  role: MemberRole | null;
  email: string | null;
  fullName: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onOpenScopePicker: () => void;
  /** "sheet" = dentro da gaveta do celular (sem sticky/hidden, sempre expandida). */
  variant?: "desktop" | "sheet";
  /** Fecha a gaveta ao navegar (só no celular). */
  onNavigate?: () => void;
};

export function TenantSidebar({
  tenant,
  chain,
  context,
  role,
  email,
  fullName,
  collapsed: collapsedProp,
  onToggle,
  onOpenScopePicker,
  variant = "desktop",
  onNavigate,
}: Props) {
  const isSheet = variant === "sheet";
  const collapsed = isSheet ? false : collapsedProp;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const credit = useFeature(tenant.id, "credit");
  const alerts = useAlerts(tenant.id);
  const jobs = useJobs(tenant.id);

  const unreadAlerts = (alerts.data ?? []).filter((a) => !a.read_at && !a.resolved_at).length;
  const failedJobs = (jobs.data ?? []).filter((j) => j.status === "failed").length;
  const counts = { alerts: unreadAlerts, jobs: failedJobs };

  const brand = resolveBrand(chain);
  // Composição pelo KIND do tenant aberto; visibilidade pelo PAPEL EFETIVO.
  const groups = visibleNavGroups(tenant.kind, context.papel ?? role, {
    credit: credit.enabled,
  });

  const cnpj = formatCnpj(context.cnpj);
  const origin = context.visitando ? context.ancestrais[context.ancestrais.length - 1] : null;
  const initials = (fullName ?? email ?? "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <TooltipProvider delayDuration={120}>
      <aside
        className={
          isSheet
            ? "flex h-full w-full shrink-0 flex-col bg-surface"
            : `sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-surface md:flex ${
                collapsed ? "w-16" : "w-64"
              }`
        }
        aria-label="Navegação"
      >
        {/* Marca: lockup TECH-IVA centralizado (ou o símbolo, quando recolhida) */}
        <div className="flex h-14 items-center justify-center px-3">
          {collapsed ? (
            <BrandIcon className="size-8 shrink-0 drop-shadow-[0_0_10px_rgba(37,99,235,0.35)]" />
          ) : (
            <BrandLogo className="h-6 w-auto drop-shadow-[0_0_12px_rgba(37,99,235,0.28)]" />
          )}
        </div>


        {/* Cabeçalho de contexto: responde "onde estou" */}
        <div className="px-2">
          <button
            type="button"
            onClick={onOpenScopePicker}
            className={`focus-glow group flex w-full items-center gap-2.5 rounded-lg border border-border/70 bg-surface-2/70 p-2 text-left transition-colors hover:border-primary/40 hover:bg-surface-2 ${
              context.visitando ? "border-l-2 border-l-warn" : ""
            }`}
            title={collapsed ? `${tenant.name} — trocar organização` : undefined}
            aria-label="Trocar organização"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/15 font-mono text-xs font-semibold text-primary">
              {tenant.name.slice(0, 2).toUpperCase()}
            </span>
            {!collapsed ? (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {tenant.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {CONTEXT_KIND_LABELS[tenant.kind]}
                    {cnpj ? <span className="font-mono"> · {cnpj}</span> : null}
                  </span>
                </span>
                <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
              </>
            ) : null}
          </button>

          {context.visitando ? (
            <div className="mt-1.5">
              {!collapsed ? (
                <p className="flex items-center gap-1.5 px-1 pb-1 text-[11px] text-warn">
                  <Eye className="size-3" aria-hidden />
                  Visitando — ações auditadas
                </p>
              ) : null}
              {origin ? (
                <Link
                  to="/t/$tenantId"
                  params={{ tenantId: origin.id }}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-1 hover:text-foreground"
                  title={collapsed ? `Voltar para ${origin.name}` : undefined}
                >
                  <ArrowLeft className="size-3.5 shrink-0" aria-hidden />
                  {!collapsed ? (
                    <span className="truncate">
                      Voltar para {CONTEXT_KIND_LABELS[origin.kind].toLowerCase()}
                    </span>
                  ) : null}
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>

        <nav className="mt-2 flex-1 overflow-y-auto px-2 pb-2">
          {groups.map((group) => (
            <div key={group.label} className="mb-1">
              {collapsed ? (
                <hr className="hairline mx-2 my-2" />
              ) : (
                <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                  {group.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.label}>
                    <SidebarItem
                      item={item}
                      tenantId={tenant.id}
                      collapsed={collapsed}
                      count={item.badge ? counts[item.badge] : 0}
                      onNavigate={onNavigate}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Rodapé: usuário + papel efetivo */}
        <div className="border-t border-border p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="focus-glow flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-1"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted font-mono text-xs text-foreground">
                  {initials || "?"}
                </span>
                {!collapsed ? (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">
                        {fullName ?? email ?? "Conta"}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {context.papel ?? role
                          ? ROLE_LABELS[(context.papel ?? role) as MemberRole]
                          : "Acesso por hierarquia"}
                      </span>
                    </span>
                    <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
                  </>
                ) : null}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-56">
              <DropdownMenuLabel className="truncate font-normal">
                <span className="block text-sm text-foreground">{fullName ?? "Sem nome"}</span>
                <span className="block font-mono text-xs text-muted-foreground">{email}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate({ to: "/profile" })}>
                <UserRound className="size-4" /> Perfil
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/select-tenant" })}>
                <ChevronsUpDown className="size-4" /> Trocar organização
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void signOutAndRedirect(queryClient, navigate)}>
                <LogOut className="size-4" /> Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {!isSheet ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 w-full justify-start text-muted-foreground"
              onClick={onToggle}
              aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            >
              {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
              {!collapsed ? <span className="ml-2">Recolher</span> : null}
            </Button>
          ) : null}
        </div>
      </aside>
    </TooltipProvider>
  );
}

const itemBase =
  "group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-surface-1 hover:text-foreground";

function SidebarItem({
  item,
  tenantId,
  collapsed,
  count,
  onNavigate,
}: {
  item: NavItem;
  tenantId: string;
  collapsed: boolean;
  count: number;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const queryClient = useQueryClient();
  // Aquece a consulta principal da tela ANTES do clique: sem isto o clique
  // montava a tela com cache frio e o esqueleto piscava.
  const warm = () => prefetchRouteData(queryClient, item.to, tenantId);
  const content = (
    <Link
      to={item.to ?? "/t/$tenantId"}
      params={{ tenantId }}
      onMouseEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
      activeOptions={{ exact: item.to === "/t/$tenantId" }}
      activeProps={{
        className:
          "bg-surface-2 text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r before:bg-primary [&_svg]:text-primary",
      }}
      className={`${itemBase} ${collapsed ? "justify-center px-0" : ""}`}
    >
      <Icon className="size-4 shrink-0 transition-colors group-hover:text-primary" aria-hidden />
      {!collapsed ? <span className="min-w-0 flex-1 truncate">{item.label}</span> : null}
      {!collapsed && count > 0 ? (
        <span className="rounded-full border border-border bg-surface-1 px-1.5 font-mono text-[10px] tabular-nums text-foreground">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
      {collapsed && count > 0 ? (
        <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary" aria-hidden />
      ) : null}
    </Link>
  );

  if (!collapsed) return content;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="right">
        {item.label}
        {count > 0 ? <span className="ml-1 font-mono tabular-nums">({count})</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}
