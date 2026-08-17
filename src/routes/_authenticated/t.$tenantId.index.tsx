import { createFileRoute, Navigate } from "@tanstack/react-router";

import { KIND_LABELS } from "@/lib/auth";
import { NAV_BY_KIND } from "@/lib/tenant-nav";
import { useShellData } from "@/lib/tenant-shell-data";

export const Route = createFileRoute("/_authenticated/t/$tenantId/")({
  component: TenantHome,
});

function TenantHome() {
  const { tenantId } = Route.useParams();
  const { data } = useShellData(tenantId);
  if (!data) return null;

  // Redireciona pela home natural de cada tipo (spec 3.2).
  if (data.tenant.kind === "company" || data.tenant.kind === "unit") {
    return <Navigate to="/t/$tenantId/cash" params={{ tenantId }} replace />;
  }
  if (data.tenant.kind === "platform") {
    return <Navigate to="/t/$tenantId/tenants" params={{ tenantId }} replace />;
  }

  const items = NAV_BY_KIND[data.tenant.kind];

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{data.tenant.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {KIND_LABELS[data.tenant.kind]} · sessão ativa como{" "}
        <span className="font-mono">{data.email ?? "—"}</span>
      </p>

      <section className="mt-8 rounded-xl border border-border bg-surface p-6">
        <h2 className="text-base font-medium text-foreground">Shell da organização pronto</h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Sidebar por tipo de organização, trilha hierárquica clicável, busca ⌘K no seu escopo,
          alertas e menu de conta. A última organização usada fica salva no seu perfil.
        </p>
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <article key={item.label} className="rounded-lg border border-border bg-background/40 p-4">
            <h3 className="text-sm font-medium text-foreground">{item.label}</h3>
            <p className="mt-1 font-mono text-xs text-muted-foreground">bloco {item.block}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
