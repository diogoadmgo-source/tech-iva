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
    /** usos que o cliente autorizou explicitamente (lista fechada) */
    finalidades: z
      .array(z.enum(["ingest_dfe", "consulta_apuracao", "emissao_documento"]))
      .min(1)
      .default(["ingest_dfe", "consulta_apuracao"]),
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
      readPfx,
      sealCertificateBundle,
      sealSecret,
      secretPath,
    } = await import("@/lib/credentials.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    /*
     * Papel EFETIVO (herdado pela hierarquia), não a membership direta:
     * role_in() só enxerga vínculo direto, então um platform_admin/channel_admin
     * atuando na empresa do cliente era recusado com "forbidden".
     *
     * uploaded_on_behalf: quem sobe o certificado NÃO é membro direto desta
     * empresa (ex.: o contador do canal subindo pelo cliente). Isso não é
     * proibido — é o fluxo normal do canal — mas o cliente tem direito de ver
     * quem mexeu no certificado dele, então fica gravado.
     */
    const { data: ctx, error: ctxErr } = await context.supabase.rpc("tenant_context", {
      p_tenant: data.tenantId,
    } as never);
    if (ctxErr) {
      const m = ctxErr.message.toLowerCase();
      if (m.includes("jwt") || m.includes("expired")) {
        throw new Error("Sua sessão expirou. Entre novamente e repita o envio.");
      }
      throw new Error(ctxErr.message);
    }
    const ctxRow = (Array.isArray(ctx) ? ctx[0] : ctx) as
      | { papel?: string | null; membership_direta?: boolean | null }
      | null
      | undefined;
    const role = ctxRow?.papel ?? null;

    /*
     * Fonte única da verdade: a decisão de permissão fica no banco (can_admin).
     * Nunca replicar uma lista de papéis aqui — as duas cópias divergem.
     */
    if (role === null) {
      throw new Error("Sua sessão expirou, entre novamente.");
    }
    const { data: pode, error: podeErr } = await context.supabase.rpc("can_admin", {
      p_tenant: data.tenantId,
    } as never);
    if (podeErr) {
      const m = podeErr.message.toLowerCase();
      if (m.includes("jwt") || m.includes("expired")) {
        throw new Error("Sua sessão expirou, entre novamente.");
      }
      throw new Error(podeErr.message);
    }
    if (pode !== true) {
      throw new Error(
        `Seu papel nesta empresa (${role}) não permite gerenciar credenciais. Peça a alguém com papel de proprietário ou administrador.`,
      );
    }

    const onBehalf = ctxRow?.membership_direta === false;


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
          p_finalidades: ["ingest_dfe", "consulta_apuracao"],
          p_uploaded_by_role: role,
          p_uploaded_on_behalf: onBehalf,
          p_caller: context.userId,
        } as never);
        if (error) throw new Error(error.message);
        return { ok: true as const, id: id as string, kind: data.kind };
      }

      // (b) CHAVE DE API — segredo opaco: cifrado no bucket, nunca na tabela.
      if (data.kind === "api_key") {
        const path = secretPath(data.tenantId, data.provider);
        const { data: prevKey } = await supabaseAdmin
          .from("integration_credentials")
          .select("secret_ref")
          .eq("tenant_id", data.tenantId)
          .eq("provider", data.provider)
          .eq("kind", "api_key")
          .maybeSingle();
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
          p_finalidades: ["consulta_apuracao"],
          p_uploaded_by_role: role,
          p_uploaded_on_behalf: onBehalf,
          p_caller: context.userId,
        } as never);
        if (error) {
          // mesma regra do certificado: nada de material cifrado sem registro
          await supabaseAdmin.storage.from(SECRETS_BUCKET).remove([path]);
          throw new Error(error.message);
        }
        const prevRef = prevKey?.secret_ref ?? null;
        if (prevRef && prevRef !== path) {
          await supabaseAdmin.storage.from(SECRETS_BUCKET).remove([prevRef]);
        }
        return { ok: true as const, id: id as string, kind: data.kind };
      }


      // (c) CERTIFICADO A1 — CAMINHO PRINCIPAL do produto.
      const pfx = fromBase64(data.file);
      const meta = readPfx(pfx, data.password); // senha errada -> erro, sem gravar nada

      /*
       * Verificação de titular FALHA FECHADO: só aceita quando conseguimos ler o
       * CNPJ do titular E o tenant tem CNPJ E o banco confirma que conferem.
       * Não conseguir ler o CNPJ é motivo de recusa, não de liberação.
       */
      if (!meta.subjectCnpj) {
        throw new CredentialError(
          "Não foi possível identificar o titular do certificado (CNPJ ausente no campo do titular). Envie o certificado e-CNPJ da empresa.",
        );
      }
      if (!tenant.cnpj) {
        throw new CredentialError(
          "Esta empresa está sem CNPJ cadastrado. Complete o cadastro antes de enviar o certificado.",
        );
      }
      // fonte autoritativa da regra: normaliza os dois lados com so_digitos no banco
      const { data: confere, error: confereErr } = await context.supabase.rpc(
        "certificado_confere_titular",
        { p_tenant: data.tenantId, p_subject_cnpj: meta.subjectCnpj } as never,
      );
      if (confereErr) throw new Error(confereErr.message);
      if (confere !== true) {
        throw new CredentialError(
          "O CNPJ do titular do certificado não corresponde ao CNPJ desta empresa.",
        );
      }

      /*
       * Caminho único por upload (renovação anual não colide) + envelope ÚNICO
       * com material e senha: um objeto só, sem operação parcial e sem senha
       * gravada ao lado do material.
       */
      const path = secretPath(data.tenantId, data.provider);
      // renovação: material antigo do mesmo provider/kind sai do bucket depois do registro
      const { data: previous } = await supabaseAdmin
        .from("integration_credentials")
        .select("secret_ref")
        .eq("tenant_id", data.tenantId)
        .eq("provider", data.provider)
        .eq("kind", "certificado_a1")
        .maybeSingle();
      const sealed = await sealCertificateBundle(pfx, data.password);
      const up = await supabaseAdmin.storage
        .from(SECRETS_BUCKET)
        .upload(path, sealed, { contentType: "application/octet-stream", upsert: false });
      if (up.error) throw new Error(up.error.message);


      let id: unknown;
      try {
        const registered = await supabaseAdmin.rpc("register_credential", {
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
          p_finalidades: data.finalidades,
          p_uploaded_by_role: role,
          p_uploaded_on_behalf: onBehalf,
          p_caller: context.userId,
        } as never);
        if (registered.error) throw new Error(registered.error.message);
        id = registered.data;
      } catch (regError) {
        // sem registro no banco, o material cifrado seria órfão: remove antes de propagar
        await supabaseAdmin.storage.from(SECRETS_BUCKET).remove([path]);
        throw regError;
      }

      const oldRef = previous?.secret_ref ?? null;
      if (oldRef && oldRef !== path) {
        await supabaseAdmin.storage.from(SECRETS_BUCKET).remove([oldRef]);
      }


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
      const raw =
        error instanceof Error ? error.message : "Falha ao registrar a credencial.";
      if (error instanceof CredentialError) throw new Error(raw);

      // Erro de segurança pode ser discreto, mas não pode ser mudo.
      const lower = raw.toLowerCase();
      if (lower.includes("jwt") || lower.includes("unauthorized") || lower.includes("expired")) {
        throw new Error("Sua sessão expirou, entre novamente.");
      }
      /*
       * O papel já foi autorizado por can_admin() antes de qualquer escrita.
       * Portanto "permission denied" que chega aqui é privilégio de banco/
       * storage faltando — defeito nosso, nunca culpa do usuário.
       */
      if (lower.includes("permission denied") || lower.includes("forbidden") || lower.includes("row-level security")) {
        console.error("[credentials] falha de privilégio no registro:", raw);
        throw new Error(
          "Falha interna ao registrar a credencial. O arquivo não foi salvo. Avise o suporte.",
        );
      }
      console.error("[credentials] erro ao registrar credencial:", raw);
      throw new Error(raw);
    }

  });

/**
 * Remove material cifrado órfão do bucket privado (sem registro em
 * integration_credentials). Só a plataforma executa: é operação de manutenção.
 */
export const cleanupCredentialSecrets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ dryRun: z.boolean().default(false) }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { data: isPlatform, error } = await context.supabase.rpc("is_platform" as never);
    if (error) throw new Error(error.message);
    if (isPlatform !== true) throw new Error("Só a plataforma pode rodar a limpeza de material órfão.");

    const { cleanupOrphanSecrets } = await import("@/lib/credentials.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await cleanupOrphanSecrets(
      supabaseAdmin as unknown as Parameters<typeof cleanupOrphanSecrets>[0],
      { dryRun: data.dryRun },
    );
    return {
      scanned: result.scanned,
      referenced: result.referenced,
      orphans: result.orphans.length,
      removed: result.removed.length,
    };
  });
