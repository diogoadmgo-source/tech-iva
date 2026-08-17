import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { AuthShell, FormError, FormSuccess } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage } from "@/lib/auth";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Criar conta — FLUXA" },
      {
        name: "description",
        content:
          "Crie sua conta FLUXA. Confirmação de e-mail obrigatória e senha de no mínimo 10 caracteres.",
      },
      { property: "og:title", content: "Criar conta — FLUXA" },
      {
        property: "og:description",
        content: "Crie sua conta FLUXA e receba o e-mail de confirmação.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SignupPage,
});

export default function SignupPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 10) {
      setError("A senha deve ter no mínimo 10 caracteres.");
      return;
    }
    setLoading(true);
    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim() || null },
          emailRedirectTo: `${window.location.origin}/confirm`,
        },
      });
      if (signUpError) throw signUpError;
      setDone(true);
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
          <FormSuccess message={`Enviamos um e-mail de confirmação para ${email}.`} />
          <p className="text-sm text-muted-foreground">
            Abra o link do e-mail para ativar a conta. Depois disso você já pode entrar.
          </p>
          <Button asChild variant="secondary" className="w-full">
            <Link to="/login">Voltar para o login</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome completo</Label>
            <Input
              id="name"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Maria Souza"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@empresa.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Mínimo de 10 caracteres.</p>
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
