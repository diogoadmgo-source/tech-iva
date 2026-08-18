import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * credential-upload — recebe o material sensível, valida, cifra e registra.
 *
 * Ordem obrigatória: (i) valida o material; (ii) confere o CNPJ do titular contra
 * o CNPJ do tenant; (iii) cifra (envelope) e grava em bucket PRIVADO;
 * (iv) register_credential com os metadados + secret_ref.
 *
 * O material nunca volta para o cliente e não existe rota de download.
 */

const INPUT = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("certificado_a1"),
    tenantId: z.string().uuid(),
    provider: z.string().min(1).max(40).default("dfe"),
    /** conteúdo do .pfx em base64 (nunca é persistido em claro nem logado) */
    file: z.string().min(100),
    password: z.string().min(1).max(200),
    acknowledged: z.literal(true),
  }),
  z.object({
    kind: z.literal("api_key"),
    tenantId: z.string().uuid(),
    provider: z.string().min(1).max(40).default("rtc"),
    apiKey: z.string().min(8).max(4000),
  }),
  z.object({
    kind: z.literal("procuracao"),
    tenantId: z.string().uuid(),
    provider: z.string().min(1).max(40).default("dfe"),
  }),
]);

export const uploadCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => INPUT.parse(input))
  .handler(async ({ data, context }) => {
    const {
      CredentialError,
      SECRETS_BUCKET,
      fromBase64,
      onlyDigits,
      readPfx,
      sealSecret,
      secretPath,
    } = await import("@/lib/credentials.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // O papel é validado com o client do usuário (RLS/hierarquia), não com service role.
    const { data: allowed, error: roleErr } = await context.supabase.rpc("has_role", {
      p_tenant: data.tenantId,
      p_roles: ["platform_admin", "channel_admin", "owner", "finance"],
    } as never);
    if (roleErr) throw new Error(roleErr.message);
    if (allowed !== true) throw new Error("forbidden");

    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("id, cnpj")
      .eq("id", data.tenantId)
      .maybeSingle();
    if (!tenant) throw new Error("Empresa não encontrada.");

    try {
      // (a) PROCURAÇÃO — caminho recomendado: nenhum material sensível existe.
      if (data.kind === "procuracao") {
        const { data: id, error } = await supabaseAdmin.rpc("register_credential", {
          p_tenant: data.tenantId,
          p_provider: data.provider,
          p_kind: "procuracao",
          p_secret_ref: null,
          p_subject_cnpj: tenant.cnpj,
          p_scopes: ["dfe.consulta"],
        } as never);
        if (error) throw new Error(error.message);
        return { ok: true as const, id: id as string, kind: data.kind };
      }

      // (b) CHAVE DE API — segredo opaco: cifrado no bucket, nunca na tabela.
      if (data.kind === "api_key") {
        const path = secretPath(data.tenantId, data.provider);
        const sealed = await sealSecret(data.apiKey);
        const up = await supabaseAdmin.storage
          .from(SECRETS_BUCKET)
          .upload(path, sealed, { contentType: "application/octet-stream", upsert: false });
        if (up.error) throw new Error(up.error.message);

        const { data: id, error } = await supabaseAdmin.rpc("register_credential", {
          p_tenant: data.tenantId,
          p_provider: data.provider,
          p_kind: "api_key",
          p_secret_ref: path,
          p_subject_cnpj: tenant.cnpj,
          p_scopes: ["rtc.api"],
        } as never);
        if (error) throw new Error(error.message);
        return { ok: true as const, id: id as string, kind: data.kind };
      }

      // (c) CERTIFICADO A1 — último recurso.
      const pfx = fromBase64(data.file);
      const meta = readPfx(pfx, data.password); // senha errada -> erro, sem gravar nada

      const tenantCnpj = onlyDigits(tenant.cnpj);
      if (tenantCnpj && meta.subjectCnpj && tenantCnpj !== meta.subjectCnpj) {
        throw new CredentialError(
          "O CNPJ do titular do certificado não corresponde ao CNPJ desta empresa.",
        );
      }

      const path = secretPath(data.tenantId, data.provider);
      const sealed = await sealSecret(pfx);
      const up = await supabaseAdmin.storage
        .from(SECRETS_BUCKET)
        .upload(path, sealed, { contentType: "application/octet-stream", upsert: false });
      if (up.error) throw new Error(up.error.message);

      // a senha vai no mesmo envelope, em arquivo separado ao lado do material
      const passSealed = await sealSecret(data.password);
      const passUp = await supabaseAdmin.storage
        .from(SECRETS_BUCKET)
        .upload(`${path}.pass`, passSealed, {
          contentType: "application/octet-stream",
          upsert: false,
        });
      if (passUp.error) throw new Error(passUp.error.message);

      const { data: id, error } = await supabaseAdmin.rpc("register_credential", {
        p_tenant: data.tenantId,
        p_provider: data.provider,
        p_kind: "certificado_a1",
        p_secret_ref: path,
        p_subject_cn: meta.subjectCn,
        p_subject_cnpj: meta.subjectCnpj,
        p_fingerprint: meta.fingerprint,
        p_not_before: meta.notBefore,
        p_not_after: meta.notAfter,
        p_scopes: ["dfe.consulta", "dfe.assinatura"],
      } as never);
      if (error) throw new Error(error.message);

      // único identificador que pode ir para log
      console.info("[credential-upload] certificado registrado", {
        fingerprint: meta.fingerprint,
        not_after: meta.notAfter,
      });

      return {
        ok: true as const,
        id: id as string,
        kind: data.kind,
        subjectCn: meta.subjectCn,
        subjectCnpj: meta.subjectCnpj,
        fingerprint: meta.fingerprint,
        notAfter: meta.notAfter,
      };
    } catch (error) {
      const message =
        error instanceof CredentialError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Falha ao registrar a credencial.";
      throw new Error(message);
    }
  });
