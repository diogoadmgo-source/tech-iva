import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AuthShell, FormError, FormSuccess } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage } from "@/lib/auth";

export const Route = createFileRoute("/reset")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Definir nova senha — TECH-IVA" },
      {
        name: "description",
        content:
          "Defina uma nova senha de acesso ao TECH-IVA. A troca de senha encerra as outras sessões ativas.",
      },
      { property: "og:title", content: "Definir nova senha — TECH-IVA" },
      {
        property: "og:description",
        content: "Defina uma nova senha de acesso ao TECH-IVA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPage,
});

function ResetPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setReady(Boolean(data.session));
    });
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 10) {
      setError("A senha deve ter no mínimo 10 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      // Logout global em troca de senha (documento 01 §1.4).
      await supabase.auth.signOut({ scope: "global" });
      setDone(true);
      setTimeout(() => navigate({ to: "/login", replace: true }), 1800);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Definir nova senha"
      subtitle="Ao concluir, todas as outras sessões desta conta serão encerradas."
      footer={
        <Link to="/login" className="text-primary hover:underline">
          Voltar para o login
        </Link>
      }
    >
      {done ? (
        <FormSuccess message="Senha atualizada. Redirecionando para o login…" />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {!ready ? (
            <p className="text-sm text-muted-foreground">
              Abra esta página pelo link enviado por e-mail para autorizar a troca de senha.
            </p>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="password">Nova senha</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Repetir senha</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <FormError message={error} />
          <Button type="submit" className="w-full" disabled={loading || !ready}>
            {loading ? "Salvando…" : "Salvar nova senha"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
