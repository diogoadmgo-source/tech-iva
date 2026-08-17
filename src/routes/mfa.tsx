import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

import { AuthShell, FormError, FormSuccess } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage } from "@/lib/auth";
import { purgePendingMfaFactors } from "@/lib/mfa.functions";

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/mfa")({
  ssr: false,
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Verificação em duas etapas — TECH-IVA" },
      {
        name: "description",
        content:
          "Cadastre ou confirme o código TOTP. Obrigatório para papéis de plataforma e admin de canal no TECH-IVA.",
      },
      { property: "og:title", content: "Verificação em duas etapas — TECH-IVA" },
      {
        property: "og:description",
        content: "Cadastre ou confirme seu código TOTP de acesso ao TECH-IVA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MfaPage,
});

type Mode = "loading" | "enroll" | "verify" | "no-session";

function MfaPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [mode, setMode] = useState<Mode>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const purgePendingFactors = useServerFn(purgePendingMfaFactors);

  const bootstrap = useCallback(async () => {
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        setMode("no-session");
        return;
      }

      const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();
      if (factorsError) throw factorsError;

      const verified = factorsData?.totp?.find((f) => f.status === "verified");
      if (verified) {
        setFactorId(verified.id);
        setMode("verify");
        return;
      }

      // listFactors() devolve apenas fatores verificados, então tentativas
      // pendentes são apagadas no servidor antes de um novo enroll.
      await purgePendingFactors();

      const { data: enrollData, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `TECH-IVA ${Date.now()}`,
      });
      if (enrollError) throw enrollError;
      setFactorId(enrollData.id);
      setQr(enrollData.totp.qr_code);
      setSecret(enrollData.totp.secret);
      setMode("enroll");
    } catch (err) {
      setError(authErrorMessage(err));
      setMode("verify");
    }
  }, [purgePendingFactors]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setFields({});
    const result = validate(totpSchema, { code });
    if (!result.data) {
      setFields(result.fieldErrors);
      return;
    }
    if (!factorId) {
      setError("Fator TOTP indisponível. Recarregue a página e tente novamente.");
      return;
    }
    setBusy(true);
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId,
      });
      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (verifyError) throw verifyError;

      setInfo("Verificação concluída.");
      navigate({ to: redirect ?? "/select-tenant", replace: true });
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (mode === "no-session") {
    return (
      <AuthShell
        title="Sessão necessária"
        subtitle="Entre com e-mail e senha antes de configurar a verificação em duas etapas."
      >
        <Button asChild className="w-full">
          <Link to="/login">Ir para o login</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Verificação em duas etapas"
      subtitle={
        mode === "enroll"
          ? "Papéis de plataforma e admin de canal exigem MFA. Cadastre o app autenticador e confirme o código."
          : "Informe o código de 6 dígitos do seu app autenticador."
      }
    >
      {mode === "loading" ? (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Preparando o fator TOTP
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {mode === "enroll" && qr ? (
            <div className="space-y-3">
              <div className="flex justify-center rounded-lg border border-border bg-background p-4">
                <img src={qr} alt="QR code para cadastrar o app autenticador" className="size-44" />
              </div>
              {secret ? (
                <p className="text-center font-mono text-xs break-all text-muted-foreground">
                  {secret}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="code">Código de 6 dígitos</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="font-mono tracking-[0.4em]"
              placeholder="000000"
            />
          </div>

          <FormError message={error} />
          <FormSuccess message={info} />

          <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
            {busy ? "Verificando…" : "Confirmar"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
