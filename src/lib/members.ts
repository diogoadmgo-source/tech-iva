import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { MemberRole, TenantKind } from "@/lib/auth";

export type TenantMember = {
  tenant_id: string;
  user_id: string;
  role: MemberRole;
  created_at: string;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
};

export type Invitation = {
  id: string;
  email: string;
  role: MemberRole;
  status: string;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
};

/** Papéis aceitos por tipo de tenant — espelha as validações de invite_user(). */
export const ROLES_BY_KIND: Record<TenantKind, MemberRole[]> = {
  platform: ["platform_admin", "platform_ops", "platform_risk"],
  channel: ["channel_admin", "channel_analyst"],
  company: ["owner", "finance", "commercial", "viewer"],
  unit: ["owner", "finance", "commercial", "viewer"],
};

const ADMIN_ROLES: MemberRole[] = ["platform_admin", "channel_admin", "owner"];

export function isAdminRole(role: MemberRole): boolean {
  return ADMIN_ROLES.includes(role);
}

export function useCanAdmin(tenantId: string) {
  return useQuery({
    queryKey: ["can-admin", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("can_admin", { p_tenant: tenantId });
      if (error) throw error;
      return Boolean(data);
    },
  });
}

export function useMembers(tenantId: string) {
  return useQuery({
    queryKey: ["tenant-members", tenantId],
    queryFn: async (): Promise<TenantMember[]> => {
      const { data, error } = await supabase.rpc("tenant_members", { p_tenant: tenantId });
      if (error) throw error;
      return (data ?? []) as TenantMember[];
    },
  });
}

export function useInvitations(tenantId: string) {
  return useQuery({
    queryKey: ["tenant-invitations", tenantId],
    queryFn: async (): Promise<Invitation[]> => {
      const { data, error } = await supabase
        .from("invitations")
        .select("id, email, role, status, expires_at, created_at, accepted_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Invitation[];
    },
  });
}

/** Monta o link de aceite a partir do token devolvido pelo RPC invite_user. */
export function inviteLink(token: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/invite/${token}`;
}

export function useMemberMutations(tenantId: string) {
  const queryClient = useQueryClient();

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tenant-members", tenantId] }),
      queryClient.invalidateQueries({ queryKey: ["tenant-invitations", tenantId] }),
    ]);
  }

  const invite = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: MemberRole }) => {
      const { data, error } = await supabase.rpc("invite_user", {
        p_tenant: tenantId,
        p_email: email,
        p_role: role,
      });
      if (error) throw error;
      const row = (data ?? [])[0];
      if (!row?.token) throw new Error("O convite não retornou token.");
      return { invitationId: row.invitation_id as string, token: row.token as string };
    },
    onSuccess: refresh,
  });

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: MemberRole }) => {
      const { error } = await supabase.rpc("set_member_role", {
        p_tenant: tenantId,
        p_user: userId,
        p_role: role,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("remove_member", {
        p_tenant: tenantId,
        p_user: userId,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const revoke = useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await supabase
        .from("invitations")
        .update({ status: "revoked" })
        .eq("id", invitationId);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  return { invite, setRole, remove, revoke };
}
