import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { AuthShell, FormError, FormSuccess } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage } from "@/lib/auth";
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
  const [sent, setSent] = useState<string | null>(null);

  async function handlePassword(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSent(null);
    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
      const target = await resolvePostLoginRoute();
      navigate({
        to: target === "/mfa" ? "/mfa" : (search.redirect ?? "/select-tenant"),
        replace: true,
      });
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleMagicLink(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSent(null);
    setLoading(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/confirm` },
      });
      if (otpError) throw otpError;
      setSent("Link enviado. Confira sua caixa de entrada.");
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
      footer={
        <span>
          Não tem conta?{" "}
          <Link to="/signup" className="text-primary hover:underline">
            Criar conta
          </Link>
        </span>
      }
    >
      <Tabs defaultValue="password">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="password">Senha</TabsTrigger>
          <TabsTrigger value="magic">Link mágico</TabsTrigger>
        </TabsList>

        <TabsContent value="password" className="mt-6">
          <form onSubmit={handlePassword} className="space-y-4">
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
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <FormError message={error} />
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Entrando…" : "Entrar"}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="magic" className="mt-6">
          <form onSubmit={handleMagicLink} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="magic-email">E-mail</Label>
              <Input
                id="magic-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com"
              />
            </div>
            <FormError message={error} />
            <FormSuccess message={sent} />
            <Button type="submit" variant="secondary" className="w-full" disabled={loading}>
              {loading ? "Enviando…" : "Enviar link mágico"}
            </Button>
          </form>
        </TabsContent>
      </Tabs>
    </AuthShell>
  );
}
