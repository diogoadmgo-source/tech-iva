import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Bell, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { KIND_LABELS, ROLE_LABELS, signOutAndRedirect, type MemberRole, type TenantKind } from "@/lib/auth";
import { NAV_BY_KIND, resolveBrand } from "@/lib/tenant-nav";

export type ShellTenant = {
  id: string;
  name: string;
  kind: TenantKind;
  level: number;
  slug: string | null;
  status: string;
  brand: unknown;
};

export type ShellData = {
  tenant: ShellTenant;
  chain: ShellTenant[]; // da raiz até o tenant ativo (apenas os visíveis no escopo)
  role: MemberRole | null;
  email: string | null;
  fullName: string | null;
  scope: ShellTenant[]; // todos os tenants visíveis, para o ⌘K
};

const COLLAPSE_KEY = "techiva:sidebar-collapsed";

export function TenantShell({ data, children }: { data: ShellData; children: React.ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggleSidebar() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const brand = resolveBrand(data.chain);
  const items = NAV_BY_KIND[data.tenant.kind];
  const initials = (data.fullName ?? data.email ?? "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-surface md:flex ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        <div className="flex h-16 items-center gap-2 border-b border-border px-4">
          <span
            className="grid size-8 shrink-0 place-items-center rounded-md font-mono text-xs font-semibold"
            style={{
              backgroundColor: brand.color ?? "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            {(brand.name ?? "TECH-IVA").slice(0, 2).toUpperCase()}
          </span>
          {!collapsed ? (
            <span className="truncate text-sm font-medium text-foreground">
              {brand.name ?? "TECH-IVA"}
            </span>
          ) : null}
        </div>

        <nav className="flex-1 space-y-1 p-2" aria-label="Navegação da organização">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() =>
                toast.info(`${item.label} entra no bloco ${item.block}`, {
                  description: "Nesta fase a fundação entrega o shell e o seletor de organização.",
                })
              }
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title={collapsed ? item.label : undefined}
            >
              <span className="size-1.5 shrink-0 rounded-full bg-primary/60" />
              {!collapsed ? <span className="truncate">{item.label}</span> : null}
            </button>
          ))}
        </nav>

        <div className="border-t border-border p-2">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={toggleSidebar}>
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
            {!collapsed ? <span className="ml-2">Recolher</span> : null}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur">
          <nav aria-label="Trilha hierárquica" className="min-w-0 flex-1">
            <ol className="flex flex-wrap items-center gap-1 text-sm">
              {data.chain.map((node, index) => {
                const isLast = index === data.chain.length - 1;
                return (
                  <li key={node.id} className="flex items-center gap-1">
                    {index > 0 ? <span className="text-muted-foreground">/</span> : null}
                    {isLast ? (
                      <span className="font-medium text-foreground">{node.name}</span>
                    ) : (
                      <Link
                        to="/t/$tenantId"
                        params={{ tenantId: node.id }}
                        className="text-muted-foreground hover:text-primary"
                      >
                        {node.name}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>

          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-muted-foreground"
            onClick={() => setPaletteOpen(true)}
          >
            <Search className="size-4" />
            <span className="hidden sm:inline">Buscar</span>
            <kbd className="hidden font-mono text-[10px] sm:inline">⌘K</kbd>
          </Button>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Alertas">
                <Bell className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <p className="text-sm font-medium text-foreground">Alertas</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Nenhum alerta. A central de alertas entra no bloco 1.7.6.
              </p>
            </PopoverContent>
          </Popover>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Conta">
                <span className="grid size-8 place-items-center rounded-full bg-muted font-mono text-xs text-foreground">
                  {initials || "?"}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="truncate font-normal">
                <span className="block text-sm text-foreground">{data.fullName ?? "Sem nome"}</span>
                <span className="block font-mono text-xs text-muted-foreground">{data.email}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => toast.info("Perfil entra no bloco 1.7.5")}
              >
                Perfil
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/select-tenant" })}>
                Trocar organização
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => void signOutAndRedirect(queryClient, navigate)}
              >
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-2">
          <Badge variant="secondary">{KIND_LABELS[data.tenant.kind]}</Badge>
          {data.role ? <Badge variant="outline">{ROLE_LABELS[data.role]}</Badge> : null}
          <span className="font-mono text-xs text-muted-foreground">
            nível {data.tenant.level} · {data.tenant.status}
          </span>
        </div>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>

      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <Command>
          <CommandInput placeholder="Buscar organização no seu escopo…" />
          <CommandList>
            <CommandEmpty>Nada encontrado.</CommandEmpty>
            <CommandGroup heading="Organizações">
              {data.scope.map((node) => (
                <CommandItem
                  key={node.id}
                  value={`${node.name} ${node.slug ?? ""}`}
                  onSelect={() => {
                    setPaletteOpen(false);
                    navigate({ to: "/t/$tenantId", params: { tenantId: node.id } });
                  }}
                >
                  <span className="flex-1 truncate">{node.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {KIND_LABELS[node.kind]}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </div>
  );
}
