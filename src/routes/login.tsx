import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";

import { Scale } from "lucide-react";

import {
  AuthProof,
  AuthSegmented,
  AuthShell,
  FieldError,
  FormError,
  FormSuccess,
  SubmitButton,
} from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage } from "@/lib/auth";
import {
  type FieldErrors,
  linkErrorFromUrl,
  loginSchema,
  magicLinkSchema,
  validate,
} from "@/lib/auth-validation";
import { resolvePostLoginRoute } from "@/lib/post-login";

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/login")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Entrar — TECH-IVA" },
      {
        name: "description",
        content:
          "Acesse o painel TECH-IVA com e-mail e senha ou link mágico. Plataforma multi-tenant de gestão fiscal para PMEs.",
      },
      { property: "og:title", content: "Entrar — TECH-IVA" },
      {
        property: "og:description",
        content: "Acesse o painel TECH-IVA com e-mail e senha ou link mágico.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldErrors>({});
  const [sent, setSent] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [mode, setMode] = useState<"password" | "magic">("password");

  // Erros devolvidos pelo próprio link do Supabase (ex.: otp_expired).
  useEffect(() => {
    const linkError = linkErrorFromUrl(window.location.href);
    if (linkError) setError(linkError);
  }, []);

  function reset() {
    setError(null);
    setSent(null);
    setFields({});
    setNeedsConfirm(false);
  }

  async function handlePassword(event: React.FormEvent) {
    event.preventDefault();
    reset();
    const result = validate(loginSchema, { email, password });
    if (!result.data) {
      setFields(result.fieldErrors);
      return;
    }
    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: result.data.email,
        password: result.data.password,
      });
      if (signInError) throw signInError;
      const target = await resolvePostLoginRoute();
      if (target === "/mfa") {
        navigate({
          to: "/mfa",
          search: search.redirect ? { redirect: search.redirect } : {},
          replace: true,
        });
        return;
      }
      navigate({ to: search.redirect ?? "/select-tenant", replace: true });
    } catch (err) {
      const message = authErrorMessage(err);
      setError(message);
      setNeedsConfirm(/confirme seu e-mail/i.test(message));
    } finally {
      setLoading(false);
    }
  }

  async function handleMagicLink(event: React.FormEvent) {
    event.preventDefault();
    reset();
    const result = validate(magicLinkSchema, { email });
    if (!result.data) {
      setFields(result.fieldErrors);
      return;
    }
    setLoading(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: result.data.email,
        options: { emailRedirectTo: `${window.location.origin}/confirm` },
      });
      if (otpError) throw otpError;
      setSent("Link enviado. Confira sua caixa de entrada e a pasta de spam.");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function resendConfirmation() {
    reset();
    const result = validate(magicLinkSchema, { email });
    if (!result.data) {
      setFields(result.fieldErrors);
      return;
    }
    setLoading(true);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: result.data.email,
        options: { emailRedirectTo: `${window.location.origin}/confirm` },
      });
      if (resendError) throw resendError;
      setSent("Novo e-mail de confirmação enviado.");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Entrar"
      subtitle="Use suas credenciais ou receba um link mágico por e-mail."
      aside={
        <AuthProof
          icon={Scale}
          label="prova"
          title="Cálculo oficial, com base legal"
          body="Usamos a Calculadora da Receita Federal. Cada número tem memória de cálculo e o artigo da lei por trás dele."
        />
      }
      footer={
        <span>
          Não tem conta?{" "}
          <Link to="/signup" className="text-primary hover:underline">
            Criar conta
          </Link>
        </span>
      }
    >
      <AuthSegmented
        options={[
          { value: "password", label: "Senha" },
          { value: "magic", label: "Link mágico" },
        ] as const}
        value={mode}
        onChange={(next) => {
          setMode(next);
          reset();
        }}
      />

      {mode === "password" ? (
        <div className="mt-6">
          <form onSubmit={handlePassword} noValidate className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                className="focus-glow"
                aria-invalid={Boolean(fields["email"])}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com"
              />
              <FieldError message={fields["email"]} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Senha</Label>
                <Link to="/forgot" className="text-xs text-muted-foreground hover:text-primary">
                  Esqueci a senha
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                className="focus-glow"
                aria-invalid={Boolean(fields["password"])}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <FieldError message={fields["password"]} />
            </div>
            <FormError message={error} />
            <FormSuccess message={sent} />
            {needsConfirm ? (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={loading}
                onClick={resendConfirmation}
              >
                Reenviar e-mail de confirmação
              </Button>
            ) : null}
            <SubmitButton loading={loading} loadingLabel="Entrando...">
              Entrar
            </SubmitButton>
          </form>
        </div>
      ) : (
        <div className="mt-6">
          <form onSubmit={handleMagicLink} noValidate className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="magic-email">E-mail</Label>
              <Input
                id="magic-email"
                type="email"
                autoComplete="email"
                className="focus-glow"
                aria-invalid={Boolean(fields["email"])}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com"
              />
              <FieldError message={fields["email"]} />
            </div>
            <FormError message={error} />
            <FormSuccess message={sent} />
            <SubmitButton loading={loading} loadingLabel="Enviando..." variant="secondary">
              Enviar link mágico
            </SubmitButton>
          </form>
        </div>
      )}
    </AuthShell>
  );
}
