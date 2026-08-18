import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  KIND_LABELS,
  authErrorMessage,
  ROLE_LABELS,
  type MemberRole,
  type TenantKind,
} from "@/lib/auth";
import { JobCenter } from "@/components/app/job-center";
import { ShellAlertBell } from "@/components/app/shell-alert-bell";
import { TenantSidebar } from "@/components/app/tenant-sidebar";
import { useImpersonation, useImpersonationMutations } from "@/lib/tenants";
import {
  filterScopeTree,
  flattenScopeTree,
  type ScopeNode,
  type ScopeTreeNode,
  type TenantContext,
} from "@/lib/tenant-scope";


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
  /** Escopo completo vindo de my_tenants(): inclui acesso por hierarquia. */
  scope: ScopeNode[];
  scopeTree: ScopeTreeNode[];
  context: TenantContext;
};

const navItemClass =
  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

const COLLAPSE_KEY = "techiva:sidebar-collapsed";

export function TenantShell({ data, children }: { data: ShellData; children: React.ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteTerm, setPaletteTerm] = useState("");

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

  const impersonation = useImpersonation();
  const { stop: stopImpersonating } = useImpersonationMutations();
  // A composição do menu vive em TenantSidebar: grupos por KIND do tenant aberto
  // e visibilidade por PAPEL EFETIVO (tenant_context.papel).


  return (
    <div className="flex min-h-screen bg-background">
      {impersonation.data ? (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-center gap-3 bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          <span>
            Impersonando{" "}
            <strong>{impersonation.data.tenantName ?? impersonation.data.tenantId}</strong> — expira
            às{" "}
            <span className="font-mono">
              {new Date(impersonation.data.expiresAt).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={stopImpersonating.isPending}
            onClick={async () => {
              try {
                await stopImpersonating.mutateAsync();
                toast.success("Impersonação encerrada.");
              } catch (error) {
                toast.error(authErrorMessage(error));
              }
            }}
          >
            Sair da impersonação
          </Button>
        </div>
      ) : null}
      {data.context.visitando ? (
        <div
          role="status"
          className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-center gap-2 border-t border-border bg-surface-2/95 px-4 py-2 text-xs text-muted-foreground backdrop-blur"
        >
          <Eye className="size-3.5 text-primary" aria-hidden />
          <span>
            Você está visitando <strong className="text-foreground">{data.tenant.name}</strong> como{" "}
            <strong className="text-foreground">
              {data.role ? ROLE_LABELS[data.role] : "acesso por hierarquia"}
            </strong>
            . As ações que fizer aqui ficam registradas na auditoria.
          </span>
        </div>
      ) : null}
      <TenantSidebar
        tenant={data.tenant}
        chain={data.chain}
        context={data.context}
        role={data.role}
        email={data.email}
        fullName={data.fullName}
        collapsed={collapsed}
        onToggle={toggleSidebar}
        onOpenScopePicker={() => setPaletteOpen(true)}
      />


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

          <JobCenter tenantId={data.tenant.id} />

          <ShellAlertBell tenantId={data.tenant.id} />



        </header>

        <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-2">
          <Badge variant="secondary">{KIND_LABELS[data.tenant.kind]}</Badge>
          {data.role ? <Badge variant="outline">{ROLE_LABELS[data.role]}</Badge> : null}
          <span className="font-mono text-xs text-muted-foreground">
            nível {data.tenant.level} · {data.tenant.status}
          </span>
        </div>

        <main
          className={`min-w-0 flex-1 px-4 py-6 md:px-8 ${data.context.visitando ? "pb-16" : ""}`}
        >
          {children}
        </main>
      </div>

      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
          <CommandInput
            placeholder="Buscar organização no seu escopo…"
            value={paletteTerm}
            onValueChange={setPaletteTerm}
          />
          <CommandList>
            <CommandEmpty>Nada encontrado.</CommandEmpty>
            <CommandGroup heading="Plataforma > canais > empresas > unidades">
              {flattenScopeTree(filterScopeTree(data.scopeTree, paletteTerm)).map((node) => (
                <CommandItem
                  key={node.id}
                  value={`${node.name} ${node.slug ?? ""} ${node.cnpj ?? ""}`}
                  onSelect={() => {
                    setPaletteOpen(false);
                    navigate({ to: "/t/$tenantId", params: { tenantId: node.id } });
                  }}
                >
                  <span
                    className="flex-1 truncate"
                    style={{ paddingLeft: `${node.depth * 14}px` }}
                  >
                    {node.name}
                  </span>
                  <Badge
                    variant={node.membership_direta ? "secondary" : "outline"}
                    className="text-[10px]"
                  >
                    {node.membership_direta ? "vínculo direto" : "por hierarquia"}
                  </Badge>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {KIND_LABELS[node.kind]}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
      </CommandDialog>
    </div>
  );
}
