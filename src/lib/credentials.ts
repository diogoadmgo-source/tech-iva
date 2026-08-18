import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { uploadCredential } from "@/lib/credentials.functions";

/** RPCs da migration 0070 (ainda não presentes nos tipos gerados). */
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export type CredentialKind = "procuracao" | "api_key" | "certificado_a1";
export type CredentialStatus = "pendente" | "ativa" | "expirada" | "revogada" | "erro";

/** Finalidades autorizadas (lista fechada — validada por trigger no banco). */
export type Finalidade = "ingest_dfe" | "consulta_apuracao" | "emissao_documento";

/** O que o certificado será usado para fazer. O cliente autoriza usos específicos. */
export const FINALIDADES_PADRAO: Finalidade[] = ["ingest_dfe", "consulta_apuracao"];

export const FINALIDADE_LABEL: Record<string, string> = {
  ingest_dfe: "Baixar seus documentos fiscais (notas emitidas e recebidas)",
  consulta_apuracao: "Consultar a sua apuração de CBS/IBS na Receita",
  emissao_documento: "Assinar e emitir documentos fiscais em seu nome",
};

export type CredentialRow = {
  id: string;
  provider: string;
  kind: CredentialKind;
  status: CredentialStatus;
  subject_cn: string | null;
  subject_cnpj: string | null;
  not_after: string | null;
  dias_para_expirar: number | null;
  last_used_at: string | null;
  last_error: string | null;
  finalidades: string[] | null;
  falhas_consecutivas: number | null;
  uploaded_on_behalf: boolean | null;
  uploaded_by_role: string | null;
  uploaded_by_name: string | null;
  created_at: string | null;
};

/** Uma linha do extrato "onde meu certificado foi usado". */
export type CredentialUsageRow = {
  usado_em: string;
  finalidade: string;
  sucesso: boolean;
  detalhe: string | null;
  subject_cn: string | null;
  fingerprint: string | null;
};

export const KIND_LABEL: Record<CredentialKind, string> = {
  procuracao: "Procuração eletrônica",
  api_key: "Chave de API",
  certificado_a1: "Certificado A1",
};

export const STATUS_LABEL: Record<CredentialStatus, string> = {
  pendente: "Pendente",
  ativa: "Ativa",
  expirada: "Expirada",
  revogada: "Revogada",
  erro: "Erro",
};

/** Semáforo por validade: verde > 30 dias, amarelo 30–7, vermelho < 7 ou expirada. */
export type Semaphore = "green" | "amber" | "red" | "neutral";

export function credentialSemaphore(row: CredentialRow): Semaphore {
  if (row.status === "expirada" || row.status === "erro") return "red";
  if (row.status === "pendente") return "amber";
  if (row.dias_para_expirar === null) return row.status === "ativa" ? "green" : "neutral";
  if (row.dias_para_expirar < 7) return "red";
  if (row.dias_para_expirar <= 30) return "amber";
  return "green";
}

export function useCredentials(tenantId: string) {
  return useQuery({
    queryKey: ["credentials", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<CredentialRow[]> => {
      const { data, error } = await rpc("credentials_status", { p_tenant: tenantId });
      if (error) throw new Error(error.message);
      return (data as CredentialRow[] | null) ?? [];
    },
  });
}

/**
 * Extrato de uso do certificado — responde "onde o meu certificado foi usado?".
 * A trilha vem do banco (credential_usage) e não pode ser editada por ninguém
 * pelo app: é prova, não histórico decorativo.
 */
export function useCredentialUsage(tenantId: string, dias = 90) {
  return useQuery({
    queryKey: ["credential-usage", tenantId, dias],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<CredentialUsageRow[]> => {
      const { data, error } = await rpc("credential_usage_report", {
        p_tenant: tenantId,
        p_dias: dias,
      });
      if (error) throw new Error(error.message);
      return (data as CredentialUsageRow[] | null) ?? [];
    },
  });
}

/** O passo de autorização só está pronto quando existe credencial ativa de dfe. */
export function hasActiveDfe(rows: CredentialRow[] | undefined): boolean {
  return (rows ?? []).some((r) => r.provider === "dfe" && r.status === "ativa");
}

export function useRevokeCredential(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; reason: string }) => {
      const { error } = await rpc("revoke_credential", {
        p_id: input.id,
        p_reason: input.reason,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["credentials", tenantId] }),
  });
}

export type UploadInput =
  | { kind: "procuracao"; provider?: string }
  | { kind: "api_key"; provider?: string; apiKey: string }
  | { kind: "certificado_a1"; provider?: string; file: File; password: string };

/** Envia o material para o servidor. O segredo sai do navegador e não volta. */
export function useUploadCredential(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UploadInput) => {
      if (input.kind === "certificado_a1") {
        const base64 = await fileToBase64(input.file);
        return uploadCredential({
          data: {
            kind: "certificado_a1",
            tenantId,
            provider: input.provider ?? "dfe",
            file: base64,
            password: input.password,
            acknowledged: true,
          },
        });
      }
      if (input.kind === "api_key") {
        return uploadCredential({
          data: {
            kind: "api_key",
            tenantId,
            provider: input.provider ?? "rtc",
            apiKey: input.apiKey,
          },
        });
      }
      return uploadCredential({
        data: { kind: "procuracao", tenantId, provider: input.provider ?? "dfe" },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["credentials", tenantId] });
      void queryClient.invalidateQueries({ queryKey: ["onboarding", tenantId] });
    },
  });
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** CNPJ do TECH-IVA que o cliente nomeia como procurador no e-CAC. */
export const TECHIVA_PROCURADOR_CNPJ = "00.000.000/0000-00";
export const ECAC_URL = "https://cav.receita.fazenda.gov.br/autenticacao/login";

export const WHY_PROCURACAO =
  "Recomendamos a procuração eletrônica porque, nesse caminho, usamos o nosso próprio certificado: nós não guardamos chave privada de cliente nenhum. É a opção mais segura para você e para nós.";
