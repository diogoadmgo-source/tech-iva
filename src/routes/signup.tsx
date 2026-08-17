import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { AuthShell, FieldError, FormError, FormSuccess } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage } from "@/lib/auth";
import {
  type FieldErrors,
  MIN_PASSWORD_LENGTH,
  passwordStrength,
  signupSchema,
  validate,
} from "@/lib/auth-validation";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Criar conta — TECH-IVA" },
      {
        name: "description",
        content:
          "Crie sua conta TECH-IVA. Confirmação de e-mail obrigatória e senha de no mínimo 10 caracteres.",
      },
      { property: "og:title", content: "Criar conta — TECH-IVA" },
      {
        property: "og:description",
        content: "Crie sua conta TECH-IVA e receba o e-mail de confirmação.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SignupPage,
});

function SignupPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldErrors>({});
  const [done, setDone] = useState<string | null>(null);
  const [resent, setResent] = useState<string | null>(null);

  const strength = passwordStrength(password);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFields({});
    const result = validate(signupSchema, { fullName, email, password });
    if (!result.data) {
      setFields(result.fieldErrors);
      return;
    }
    setLoading(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: result.data.email,
        password: result.data.password,
        options: {
          data: { full_name: result.data.fullName },
          emailRedirectTo: `${window.location.origin}/confirm`,
        },
      });
      if (signUpError) throw signUpError;
      // Com confirmação obrigatória, session vem null: nunca tratamos como logado.
      if (data.session) {
        setDone(result.data.email);
        return;
      }
      setDone(result.data.email);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    setError(null);
    setResent(null);
    setLoading(true);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: done ?? email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/confirm` },
      });
      if (resendError) throw resendError;
      setResent("E-mail de confirmação reenviado.");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Criar conta"
      subtitle="A confirmação de e-mail é obrigatória antes do primeiro acesso."
      footer={
        <span>
          Já tem conta?{" "}
          <Link to="/login" className="text-primary hover:underline">
            Entrar
          </Link>
        </span>
      }
    >
      {done ? (
        <div className="space-y-4">
          <FormSuccess message={`Enviamos um e-mail de confirmação para ${done}.`} />
          <p className="text-sm text-muted-foreground">
            Abra o link do e-mail para ativar a conta. Enquanto isso o login fica bloqueado.
          </p>
          <FormError message={error} />
          <FormSuccess message={resent} />
          <Button type="button" variant="ghost" className="w-full" disabled={loading} onClick={resend}>
            {loading ? "Reenviando…" : "Não recebi o e-mail"}
          </Button>
          <Button asChild variant="secondary" className="w-full">
            <Link to="/login">Voltar para o login</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome completo</Label>
            <Input
              id="name"
              autoComplete="name"
              aria-invalid={Boolean(fields["fullName"])}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Maria Souza"
            />
            <FieldError message={fields["fullName"]} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              aria-invalid={Boolean(fields["email"])}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@empresa.com"
            />
            <FieldError message={fields["email"]} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(fields["password"])}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <div className="flex h-1 flex-1 gap-1" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={
                      i < strength.score ? "flex-1 rounded bg-primary" : "flex-1 rounded bg-border"
                    }
                  />
                ))}
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">{strength.label}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Mínimo de {MIN_PASSWORD_LENGTH} caracteres, com letra e número.
            </p>
            <FieldError message={fields["password"]} />
          </div>
          <FormError message={error} />
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Criando…" : "Criar conta"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
