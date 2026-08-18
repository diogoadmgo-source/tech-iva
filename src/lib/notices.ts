import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/**
 * Avisos da plataforma (platform_notices) e identidade da plataforma.
 *
 * REGRA: nenhum destes textos é escrito no código do front. Eles mudam conforme
 * a Receita evolui e a plataforma edita sem deploy — o front só renderiza.
 */

const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

const table = supabase.from as unknown as (t: string) => any;

export type Notice = {
  key: string;
  severity: string;
  title: string;
  body: string;
};

/** RPC notices_for(scope) — avisos ativos do escopo, warning primeiro. */
export function useNotices(scope: string) {
  return useQuery({
    queryKey: ["notices", scope],
    queryFn: async (): Promise<Notice[]> => {
      const { data, error } = await rpc("notices_for", { p_scope: scope });
      if (error) throw new Error(error.message);
      return (data ?? []) as Notice[];
    },
    staleTime: 60_000,
  });
}

/* ------------------------------------------------- identidade da plataforma */

export type PlatformIdentity = {
  cnpj: string;
  razao_social: string;
  nome_exibicao: string;
  portal_rtc: string;
  ecac_controle_acesso: string;
};

/** RPC platform_identity — CNPJ que o cliente informa no e-CAC ao nos nomear procurador. */
export function usePlatformIdentity() {
  return useQuery({
    queryKey: ["platform-identity"],
    queryFn: async (): Promise<PlatformIdentity> => {
      const { data, error } = await rpc("platform_identity");
      if (error) throw new Error(error.message);
      return data as PlatformIdentity;
    },
    staleTime: 5 * 60_000,
  });
}

export function useSetPlatformIdentity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { cnpj: string; razao: string; nome: string }) => {
      const { error } = await rpc("set_platform_identity", {
        p_cnpj: input.cnpj,
        p_razao: input.razao,
        p_nome: input.nome,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["platform-identity"] });
    },
  });
}

/* ----------------------------------------- gestão dos avisos (plataforma) */

export type NoticeRow = Notice & {
  scope: string;
  active: boolean;
  updated_at: string;
};

export function usePlatformNotices() {
  return useQuery({
    queryKey: ["platform-notices"],
    queryFn: async (): Promise<NoticeRow[]> => {
      const { data, error } = await table("platform_notices")
        .select("key, scope, severity, title, body, active, updated_at")
        .order("scope", { ascending: true })
        .order("key", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as NoticeRow[];
    },
  });
}

export function useSaveNotice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (row: Partial<NoticeRow> & { key: string }) => {
      const { error } = await table("platform_notices").upsert(
        {
          key: row.key,
          scope: row.scope,
          severity: row.severity,
          title: row.title,
          body: row.body,
          active: row.active,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["platform-notices"] });
      void queryClient.invalidateQueries({ queryKey: ["notices"] });
    },
  });
}

/* -------------------------------------------- estado da credencial da RTC */

export type RtcCredentialState = {
  configurada: boolean;
  status?: string;
  caminho: "proprio" | "procurador" | string | null;
  desde?: string | null;
  ultimo_uso?: string | null;
  ultimo_erro?: string | null;
  credential_id?: string;
  mensagem?: string;
};

export function useRtcCredentialState(tenantId: string) {
  return useQuery({
    queryKey: ["rtc-credential-state", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<RtcCredentialState> => {
      const { data, error } = await rpc("rtc_credential_state", { p_tenant: tenantId });
      if (error) throw new Error(error.message);
      return data as RtcCredentialState;
    },
  });
}
