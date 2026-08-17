import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Envia o e-mail de convite depois que a RPC invite_user gerou o token.
 * O chamador precisa ser admin do tenant (validado via can_admin com RLS do usuário).
 */
export const sendInviteEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId: string; invitationId: string; token: string; origin: string }) => {
    if (!input?.tenantId || !input?.invitationId || !input?.token) throw new Error("Dados do convite incompletos.");
    if (!/^https?:\/\//.test(input.origin)) throw new Error("Origem inválida.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: canAdmin, error: adminError } = await supabase.rpc("can_admin", { p_tenant: data.tenantId });
    if (adminError) throw adminError;
    if (!canAdmin) throw new Error("Sem permissão para enviar convites neste tenant.");

    const { data: invitation, error: inviteError } = await supabase
      .from("invitations")
      .select("id, email, role, status, expires_at, tenant_id")
      .eq("id", data.invitationId)
      .eq("tenant_id", data.tenantId)
      .maybeSingle();
    if (inviteError) throw inviteError;
    if (!invitation) throw new Error("Convite não encontrado.");
    if (invitation.status !== "pending") throw new Error("Este convite não está mais pendente.");

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("name")
      .eq("id", data.tenantId)
      .maybeSingle();
    if (tenantError) throw tenantError;

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", userId)
      .maybeSingle();

    const { renderInviteEmail, inviteEmailSubject } = await import("@/lib/email/invite-template");
    const { sendEmail } = await import("@/lib/email/resend.server");

    const html = renderInviteEmail({
      acceptUrl: `${data.origin.replace(/\/$/, "")}/invite/${data.token}`,
      tenantName: tenant?.name ?? "sua organização",
      role: invitation.role,
      invitedBy: profile?.full_name ?? null,
      expiresAt: invitation.expires_at,
    });

    const result = await sendEmail({
      to: invitation.email,
      subject: inviteEmailSubject(tenant?.name ?? "TECH-IVA"),
      html,
    });

    await supabase.rpc("log_audit", {
      p_tenant: data.tenantId,
      p_action: "invitation.email_sent",
      p_entity: "invitations",
      p_entity_id: invitation.id,
      p_before: null,
      p_after: { email: invitation.email, provider_id: result.id },
    });

    return { sent: true, email: invitation.email };
  });
