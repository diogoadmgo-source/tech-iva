import { createFileRoute, Navigate } from "@tanstack/react-router";

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
  if (data.tenant.kind === "channel") {
    return <Navigate to="/t/$tenantId/portfolio" params={{ tenantId }} replace />;
  }

  return null;
}
