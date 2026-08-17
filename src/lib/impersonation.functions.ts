import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Impersonação de organização (documento 01 §1.7.4).
 *
 * Só platform_* com sessão aal2 pode iniciar. O estado vive no app_metadata do
 * próprio usuário (vira claim no JWT após refreshSession) e expira em 30 min ou
 * quando o admin sai. Início e fim vão para audit_log com service role.
 */

const START_INPUT = z.object({ tenantId: z.string().uuid() });

export const IMPERSONATION_TTL_MINUTES = 30;

type AdminUser = { app_metadata?: Record<string, unknown> | null };

async function adminUser(userId: string): Promise<AdminUser> {
  const response = await fetch(
    `${process.env["SUPABASE_URL"]!}/auth/v1/admin/users/${userId}`,
    { headers: adminHeaders() },
  );
  if (!response.ok) throw new Error(`admin user read falhou: ${response.status}`);
  return (await response.json()) as AdminUser;
}

function adminHeaders() {
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
}

async function writeAppMetadata(userId: string, appMetadata: Record<string, unknown>) {
  const response = await fetch(
    `${process.env["SUPABASE_URL"]!}/auth/v1/admin/users/${userId}`,
    {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify({ app_metadata: appMetadata }),
    },
  );
  if (!response.ok) throw new Error(`admin user update falhou: ${response.status}`);
}

async function audit(entry: {
  tenantId: string | null;
  actorId: string;
  action: string;
  entityId: string | null;
  after: Record<string, string> | null;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("audit_log").insert({
    tenant_id: entry.tenantId,
    actor_id: entry.actorId,
    actor_role: "platform_admin",
    impersonated_by: entry.actorId,
    action: entry.action,
    entity: "tenants",
    entity_id: entry.entityId,
    after: entry.after ?? null,
  });
}

export const startImpersonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => START_INPUT.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;

    const { data: isPlatform, error: platformError } = await supabase.rpc("is_platform");
    if (platformError) throw platformError;
    if (!isPlatform) throw new Error("Forbidden");
    if ((claims as { aal?: string }).aal !== "aal2") throw new Error("MFA required");

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("id, name, kind")
      .eq("id", data.tenantId)
      .maybeSingle();
    if (tenantError) throw tenantError;
    if (!tenant) throw new Error("Organização fora do seu escopo.");

    const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MINUTES * 60_000).toISOString();
    const current = await adminUser(userId);
    await writeAppMetadata(userId, {
      ...(current.app_metadata ?? {}),
      impersonated_by: userId,
      impersonated_tenant: tenant.id,
      impersonated_tenant_name: tenant.name,
      impersonation_expires_at: expiresAt,
    });

    await audit({
      tenantId: tenant.id,
      actorId: userId,
      action: "impersonation.start",
      entityId: tenant.id,
      after: { tenant_name: tenant.name, expires_at: expiresAt },
    });

    return { tenantId: tenant.id, tenantName: tenant.name, expiresAt };
  });

export const stopImpersonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const current = await adminUser(userId);
    const meta = { ...(current.app_metadata ?? {}) } as Record<string, unknown>;
    const tenantId = typeof meta["impersonated_tenant"] === "string" ? meta["impersonated_tenant"] : null;

    delete meta["impersonated_by"];
    delete meta["impersonated_tenant"];
    delete meta["impersonated_tenant_name"];
    delete meta["impersonation_expires_at"];
    await writeAppMetadata(userId, meta);

    await audit({
      tenantId,
      actorId: userId,
      action: "impersonation.stop",
      entityId: tenantId,
      after: null,
    });

    return { stopped: true, tenantId };
  });
