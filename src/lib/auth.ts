import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type MemberRole = Database["public"]["Enums"]["member_role"];
export type TenantKind = Database["public"]["Enums"]["tenant_kind"];

/** Papéis que exigem MFA (aal2) — documento 01 §1.4. Espelha role_requires_mfa() no banco. */
export const MFA_REQUIRED_ROLES: MemberRole[] = [
  "platform_admin",
  "platform_ops",
  "platform_risk",
  "channel_admin",
];

export function roleRequiresMfa(role: MemberRole): boolean {
  return MFA_REQUIRED_ROLES.includes(role);
}

export const ROLE_LABELS: Record<MemberRole, string> = {
  platform_admin: "Admin da plataforma",
  platform_ops: "Operações da plataforma",
  platform_risk: "Risco da plataforma",
  channel_admin: "Admin do canal",
  channel_analyst: "Analista do canal",
  owner: "Proprietário",
  finance: "Financeiro",
  commercial: "Comercial",
  viewer: "Leitura",
};

export const KIND_LABELS: Record<TenantKind, string> = {
  platform: "Plataforma",
  channel: "Canal",
  company: "Empresa",
  unit: "Unidade",
};

/** aal atual da sessão: "aal1" (senha) ou "aal2" (senha + TOTP). */
export async function currentAal(): Promise<"aal1" | "aal2" | null> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return (data?.currentLevel as "aal1" | "aal2" | null) ?? null;
}

/** Mensagens de erro do Supabase Auth / RPCs em PT-BR. */
export function authErrorMessage(error: unknown): string {
  const raw =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error ?? "Erro desconhecido");

  const map: Array<[RegExp, string]> = [
    [/invalid login credentials/i, "E-mail ou senha inválidos."],
    [/email not confirmed/i, "Confirme seu e-mail antes de entrar."],
    [/user already registered/i, "Este e-mail já possui conta."],
    [/password should be at least/i, "A senha deve ter no mínimo 10 caracteres."],
    [/for security purposes|rate limit|too many requests/i, "Muitas tentativas. Aguarde alguns instantes."],
    [/invalid totp|invalid code|otp/i, "Código inválido ou expirado."],
    [/mfa required/i, "Verificação em duas etapas obrigatória para este papel."],
    [/forbidden/i, "Você não tem permissão para esta ação."],
    [/invalid or expired invitation/i, "Convite inválido ou expirado."],
    [/cannot remove last admin/i, "Não é possível remover o último administrador."],
    [/email mismatch/i, "Este convite foi enviado para outro e-mail."],
  ];
  for (const [re, msg] of map) if (re.test(raw)) return msg;
  return raw;
}

/** Saída de sessão em ordem segura. */
export async function signOutAndRedirect(
  queryClient: { cancelQueries: () => Promise<void>; clear: () => void },
  navigate: (opts: { to: string; replace?: boolean }) => void,
) {
  await queryClient.cancelQueries();
  queryClient.clear();
  await supabase.auth.signOut();
  navigate({ to: "/login", replace: true });
}
