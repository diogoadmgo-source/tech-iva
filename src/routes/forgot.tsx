import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { AuthShell, FormError, FormSuccess } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage } from "@/lib/auth";

export const Route = createFileRoute("/forgot")({
  head: () => ({
    meta: [
      { title: "Recuperar senha — FLUXA" },
      {
        name: "description",
        content: "Receba um link por e-mail para definir uma nova senha de acesso ao FLUXA.",
      },
      { property: "og:title", content: "Recuperar senha — FLUXA" },
      {
        property: "og:description",
        content: "Receba um link por e-mail para definir uma nova senha no FLUXA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ForgotPage,
});

function ForgotPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset`,
      });
      if (resetError) throw resetError;
      setSent(true);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Recuperar senha"
      subtitle="Enviaremos um link para você definir uma nova senha."
      footer={
        <Link to="/login" className="text-primary hover:underline">
          Voltar para o login
        </Link>
      }
    >
      {sent ? (
        <FormSuccess message={`Se existir conta para ${email}, o link já está a caminho.`} />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
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
          <FormError message={error} />
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Enviando…" : "Enviar link"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
