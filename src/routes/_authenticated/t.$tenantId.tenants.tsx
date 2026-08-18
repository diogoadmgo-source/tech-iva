import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Search,
  UserCog,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { CnpjAutofillField } from "@/components/techiva/cnpj-autofill";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FormError } from "@/components/auth/auth-shell";
import { KIND_LABELS, authErrorMessage, type TenantKind } from "@/lib/auth";
import {
  CHILD_KINDS,
  STATUS_LABELS,
  useImpersonation,
  useImpersonationMutations,
  useTenantMutations,
  useTenantTree,
  type TenantNode,
  type TenantStatus,
} from "@/lib/tenants";
import { useShellData } from "@/lib/tenant-shell-data";

export const Route = createFileRoute("/_authenticated/t/$tenantId/tenants")({
  head: () => ({
    meta: [
      { title: "Árvore de organizações — TECH-IVA" },
      {
        name: "description",
        content:
          "Hierarquia de canais, empresas e unidades no TECH-IVA: criar filhos, editar marca e status, e impersonar pela plataforma.",
      },
      { property: "og:title", content: "Árvore de organizações — TECH-IVA" },
      {
        property: "og:description",
        content: "Hierarquia de canais, empresas e unidades no TECH-IVA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TenantsPage,
});

function TenantsPage() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const tree = useTenantTree(tenantId);
  const { create, update } = useTenantMutations(tenantId);
  const impersonation = useImpersonation();
  const impersonationMutations = useImpersonationMutations();

  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ [tenantId]: true });
  const [createParent, setCreateParent] = useState<TenantNode | null>(null);
  const [editTarget, setEditTarget] = useState<TenantNode | null>(null);

  const isPlatform = shell.data?.tenant.kind === "platform";

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return null;
    return new Set(
      (tree.data?.all ?? [])
        .filter(
          (node) =>
            node.name.toLowerCase().includes(term) ||
            (node.cnpj ?? "").toLowerCase().includes(term) ||
            (node.slug ?? "").toLowerCase().includes(term),
        )
        .map((node) => node.id),
    );
  }, [query, tree.data]);

  if (tree.error) return <FormError message={authErrorMessage(tree.error)} />;

  return (
    <div className="mx-auto max-w-5xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Organizações</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hierarquia a partir de{" "}
            <span className="font-medium text-foreground">{shell.data?.tenant.name ?? "—"}</span>. A
            visibilidade é limitada pelo seu escopo no banco.
          </p>
        </div>
        {tree.data?.root && CHILD_KINDS[tree.data.root.kind].length > 0 ? (
          <Button className="gap-2" onClick={() => setCreateParent(tree.data!.root!)}>
            <Plus className="size-4" />
            Nova organização
          </Button>
        ) : null}
      </header>

      <div className="relative mt-6">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por nome, CNPJ ou slug"
          className="pl-9"
          aria-label="Buscar organização"
        />
      </div>

      <div className="mt-4 space-y-1 rounded-xl border border-border bg-surface p-2">
        {tree.isLoading ? (
          <div className="space-y-2 p-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        ) : tree.data?.root ? (
          <TenantRow
            node={tree.data.root}
            depth={0}
            expanded={expanded}
            onToggle={(id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))}
            matches={matches}
            isPlatform={isPlatform}
            impersonatingId={impersonation.data?.tenantId ?? null}
            onCreateChild={setCreateParent}
            onEdit={setEditTarget}
            onImpersonate={async (node) => {
              try {
                await impersonationMutations.start.mutateAsync(node.id);
                toast.success(`Impersonando ${node.name} por 30 minutos.`);
              } catch (error) {
                toast.error(authErrorMessage(error));
              }
            }}
            impersonating={impersonationMutations.start.isPending}
          />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">Nenhuma organização no escopo.</p>
        )}
      </div>

      <CreateTenantDialog
        parent={createParent}
        pending={create.isPending}
        onClose={() => setCreateParent(null)}
        onSubmit={async (input) => {
          try {
            await create.mutateAsync(input);
            setCreateParent(null);
            setExpanded((prev) => ({ ...prev, [input.parentId]: true }));
            toast.success(`${input.name} criada.`);
          } catch (error) {
            toast.error(authErrorMessage(error));
          }
        }}
      />

      <EditTenantDialog
        node={editTarget}
        pending={update.isPending}
        onClose={() => setEditTarget(null)}
        onSubmit={async (input) => {
          try {
            await update.mutateAsync(input);
            setEditTarget(null);
            toast.success("Organização atualizada.");
          } catch (error) {
            toast.error(authErrorMessage(error));
          }
        }}
      />
    </div>
  );
}

function TenantRow({
  node,
  depth,
  expanded,
  onToggle,
  matches,
  isPlatform,
  impersonatingId,
  onCreateChild,
  onEdit,
  onImpersonate,
  impersonating,
}: {
  node: TenantNode;
  depth: number;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  matches: Set<string> | null;
  isPlatform: boolean;
  impersonatingId: string | null;
  onCreateChild: (node: TenantNode) => void;
  onEdit: (node: TenantNode) => void;
  onImpersonate: (node: TenantNode) => void;
  impersonating: boolean;
}) {
  const hasChildren = node.children.length > 0;
  const open = matches ? true : Boolean(expanded[node.id]);
  const visible = !matches || subtreeMatches(node, matches);
  if (!visible) return null;
  const highlighted = Boolean(matches?.has(node.id));

  return (
    <>
      <div
        className={`flex flex-wrap items-center gap-2 rounded-md px-2 py-2 hover:bg-accent/60 ${
          highlighted ? "bg-accent/40" : ""
        }`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        <button
          type="button"
          onClick={() => onToggle(node.id)}
          className="text-muted-foreground disabled:opacity-30"
          disabled={!hasChildren}
          aria-label={open ? `Recolher ${node.name}` : `Expandir ${node.name}`}
        >
          {hasChildren ? (
            open ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )
          ) : (
            <Building2 className="size-4 opacity-40" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{node.name}</span>
            <Badge variant="secondary">{KIND_LABELS[node.kind]}</Badge>
            <Badge variant={node.status === "active" ? "outline" : "destructive"}>
              {STATUS_LABELS[node.status]}
            </Badge>
          </div>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            {node.cnpj ? `CNPJ ${node.cnpj}` : node.slug ? `/${node.slug}` : `nível ${node.level}`}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link
              to="/t/$tenantId/settings/users"
              params={{ tenantId: node.id }}
              className="gap-1"
              title="Membros"
            >
              <Users className="size-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(node)}
            aria-label={`Editar ${node.name}`}
          >
            <Pencil className="size-4" />
          </Button>
          {CHILD_KINDS[node.kind].length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onCreateChild(node)}
              aria-label={`Criar filho em ${node.name}`}
            >
              <Plus className="size-4" />
            </Button>
          ) : null}
          {isPlatform && node.kind !== "platform" ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={impersonating || impersonatingId === node.id}
              onClick={() => onImpersonate(node)}
            >
              <UserCog className="size-4" />
              {impersonatingId === node.id ? "Ativa" : "Impersonar"}
            </Button>
          ) : null}
        </div>
      </div>

      {open
        ? node.children.map((child) => (
            <TenantRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              matches={matches}
              isPlatform={isPlatform}
              impersonatingId={impersonatingId}
              onCreateChild={onCreateChild}
              onEdit={onEdit}
              onImpersonate={onImpersonate}
              impersonating={impersonating}
            />
          ))
        : null}
    </>
  );
}

function subtreeMatches(node: TenantNode, matches: Set<string>): boolean {
  if (matches.has(node.id)) return true;
  return node.children.some((child) => subtreeMatches(child, matches));
}

function CreateTenantDialog({
  parent,
  pending,
  onClose,
  onSubmit,
}: {
  parent: TenantNode | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: {
    parentId: string;
    kind: TenantKind;
    name: string;
    cnpj?: string | null;
    slug?: string | null;
  }) => Promise<void>;
}) {
  const kinds = parent ? CHILD_KINDS[parent.kind] : [];
  const [kind, setKind] = useState<TenantKind | "">("");
  const [name, setName] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);

  const effectiveKind = kind || kinds[0] || "";

  return (
    <Dialog
      open={Boolean(parent)}
      onOpenChange={(open) => {
        if (open) return;
        onClose();
        setKind("");
        setName("");
        setCnpj("");
        setSlug("");
        setError(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova organização</DialogTitle>
          <DialogDescription>
            Será criada sob <span className="text-foreground">{parent?.name}</span>. A hierarquia e o
            tipo permitido são validados pelo banco.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!parent || !effectiveKind) return;
            if (name.trim().length < 2) {
              setError("Informe um nome com pelo menos 2 caracteres.");
              return;
            }
            const digits = cnpj.replace(/\D/g, "");
            if ((effectiveKind === "company" || effectiveKind === "unit") && digits.length !== 14) {
              setError("Empresas e unidades exigem CNPJ com 14 dígitos.");
              return;
            }
            if (effectiveKind === "channel" && !/^[a-z0-9-]{2,40}$/.test(slug.trim())) {
              setError("O slug do canal aceita letras minúsculas, números e hífen.");
              return;
            }
            setError(null);
            void onSubmit({
              parentId: parent.id,
              kind: effectiveKind,
              name: name.trim(),
              cnpj: digits || null,
              slug: effectiveKind === "channel" ? slug.trim() : null,
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="tenant-kind">Tipo</Label>
            <Select value={effectiveKind} onValueChange={(value) => setKind(value as TenantKind)}>
              <SelectTrigger id="tenant-kind">
                <SelectValue placeholder="Selecione o tipo" />
              </SelectTrigger>
              <SelectContent>
                {kinds.map((option) => (
                  <SelectItem key={option} value={option}>
                    {KIND_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tenant-name">Nome</Label>
            <Input
              id="tenant-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Razão social ou nome do canal"
            />
          </div>

          {effectiveKind === "channel" ? (
            <div className="space-y-2">
              <Label htmlFor="tenant-slug">Slug</Label>
              <Input
                id="tenant-slug"
                value={slug}
                onChange={(event) => setSlug(event.target.value.toLowerCase())}
                placeholder="contabil-alfa"
                className="font-mono"
              />
            </div>
          ) : null}

          {effectiveKind === "company" || effectiveKind === "unit" ? (
            <CnpjAutofillField
              id="tenant-cnpj"
              value={cnpj}
              onChange={setCnpj}
              onResolved={(record) => {
                if (record.razao_social) setName(record.razao_social);
              }}
            />
          ) : null}

          {error ? <FormError message={error} /> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending} className="gap-2">
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Criar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditTenantDialog({
  node,
  pending,
  onClose,
  onSubmit,
}: {
  node: TenantNode | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: {
    id: string;
    name?: string;
    status?: TenantStatus;
    brand?: { name?: string | null; color?: string | null; logo_url?: string | null };
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<TenantStatus>("active");
  const [brandName, setBrandName] = useState("");
  const [color, setColor] = useState("#2563EB");
  const [logoUrl, setLogoUrl] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Sincroniza o formulário com o nó selecionado, sem efeito colateral em efeito.
  if (node && loadedFor !== node.id) {
    setLoadedFor(node.id);
    setName(node.name);
    setStatus(node.status);
    setBrandName(node.brand?.name ?? "");
    setColor(node.brand?.color ?? "#2563EB");
    setLogoUrl(node.brand?.logo_url ?? "");
  }

  const showsBrand = node?.kind === "channel" || node?.kind === "platform";

  return (
    <Dialog
      open={Boolean(node)}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setLoadedFor(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar organização</DialogTitle>
          <DialogDescription>
            Nome, status e marca. Alterações ficam registradas na auditoria.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!node) return;
            void onSubmit({
              id: node.id,
              name: name.trim(),
              status,
              ...(showsBrand
                ? {
                    brand: {
                      name: brandName.trim() || null,
                      color: color || null,
                      logo_url: logoUrl.trim() || null,
                    },
                  }
                : {}),
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="edit-name">Nome</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-status">Status</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as TenantStatus)}>
              <SelectTrigger id="edit-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_LABELS) as TenantStatus[]).map((option) => (
                  <SelectItem key={option} value={option}>
                    {STATUS_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {showsBrand ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="edit-brand-name">Nome da marca</Label>
                <Input
                  id="edit-brand-name"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="Exibido no painel dos clientes do canal"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-color">Cor</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="edit-color"
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent"
                    />
                    <Input
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="font-mono"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-logo">Logo (URL)</Label>
                  <Input
                    id="edit-logo"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://…"
                  />
                </div>
              </div>
            </>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending} className="gap-2">
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
