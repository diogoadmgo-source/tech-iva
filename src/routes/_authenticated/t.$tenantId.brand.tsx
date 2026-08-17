import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { NoPermissionState } from "@/components/techiva/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useShellData } from "@/lib/tenant-shell-data";
import { useTenantMutations } from "@/lib/tenants";
import type { Brand } from "@/lib/tenant-nav";

export const Route = createFileRoute("/_authenticated/t/$tenantId/brand")({
  component: BrandScreen,
  head: () => ({
    meta: [
      { title: "Marca do canal — TECH-IVA" },
      {
        name: "description",
        content:
          "Configure o white-label do canal: nome exibido, logo e cor primária aplicados a toda a subárvore de empresas.",
      },
      { property: "og:title", content: "Marca do canal — TECH-IVA" },
      {
        property: "og:description",
        content: "Nome, logo e cor primária do canal aplicados a todas as empresas abaixo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function BrandScreen() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const mutations = useTenantMutations(tenantId);

  const [form, setForm] = useState<Brand>({ name: "", logo_url: "", color: "#2563EB" });

  const tenant = shell.data?.tenant;
  const role = shell.data?.role ?? null;
  const canEdit = role === "channel_admin" || role === "platform_admin";

  useEffect(() => {
    if (!tenant) return;
    const brand = (tenant.brand ?? {}) as Brand;
    setForm({
      name: brand.name ?? tenant.name,
      logo_url: brand.logo_url ?? "",
      color: brand.color ?? "#2563EB",
    });
  }, [tenant]);

  if (tenant && tenant.kind !== "channel" && tenant.kind !== "platform") {
    return (
      <div className="p-6">
        <NoPermissionState hint="A marca é configurada no canal ou na plataforma." />
      </div>
    );
  }

  if (tenant && !canEdit) {
    return (
      <div className="p-6">
        <NoPermissionState hint="Somente administradores do canal podem alterar a marca." />
      </div>
    );
  }

  async function save() {
    try {
      await mutations.update.mutateAsync({
        id: tenantId,
        brand: {
          name: form.name?.trim() || null,
          logo_url: form.logo_url?.trim() || null,
          color: form.color?.trim() || null,
        },
      });
      toast.success("Marca atualizada. Toda a subárvore já reflete a mudança.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a marca.");
    }
  }

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Marca</h1>
        <p className="text-sm text-muted-foreground">
          O white-label vale para {tenant?.name ?? "este canal"} e todas as empresas abaixo dele.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-border bg-surface-1 p-5 shadow-e1">
          <div className="space-y-1.5">
            <Label htmlFor="brand-name">Nome exibido</Label>
            <Input
              id="brand-name"
              value={form.name ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Contábil Alfa"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brand-logo">URL do logo</Label>
            <Input
              id="brand-logo"
              value={form.logo_url ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, logo_url: e.target.value }))}
              placeholder="https://…/logo.png"
            />
            <p className="text-xs text-muted-foreground">
              PNG ou SVG com fundo transparente, altura mínima de 64 px.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brand-color">Cor primária</Label>
            <div className="flex items-center gap-3">
              <input
                id="brand-color"
                type="color"
                value={form.color ?? "#2563EB"}
                onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                className="size-9 cursor-pointer rounded-md border border-border bg-transparent"
              />
              <Input
                value={form.color ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                className="w-32 font-mono"
                aria-label="Cor primária em hexadecimal"
              />
            </div>
          </div>
          <Button onClick={() => void save()} disabled={mutations.update.isPending}>
            {mutations.update.isPending ? "Salvando…" : "Salvar marca"}
          </Button>
        </div>

        <div className="rounded-xl border border-border bg-surface-1 p-5 shadow-e1">
          <p className="text-xs font-medium text-muted-foreground">Pré-visualização do shell</p>
          <div className="mt-3 overflow-hidden rounded-lg border border-border">
            <div
              className="flex items-center gap-3 px-4 py-3"
              style={{ backgroundColor: form.color ?? "#2563EB" }}
            >
              {form.logo_url ? (
                <img src={form.logo_url} alt="Logo do canal" className="h-7 w-auto" />
              ) : (
                <span className="text-sm font-semibold text-white">{form.name || "Seu canal"}</span>
              )}
            </div>
            <div className="grid grid-cols-[140px_1fr]">
              <div className="space-y-2 border-r border-border bg-surface-2 p-3 text-xs text-muted-foreground">
                <p>Carteira</p>
                <p>Empresas</p>
                <p>Marca</p>
              </div>
              <div className="space-y-3 p-4">
                <div className="h-3 w-32 rounded bg-muted" />
                <div className="h-16 rounded-lg border border-border bg-surface-2" />
                <Button size="sm" style={{ backgroundColor: form.color ?? "#2563EB" }}>
                  Ação primária
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
