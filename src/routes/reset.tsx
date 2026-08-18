import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  AuthShell,
  FieldError,
  FormError,
  FormSuccess,
  SubmitButton,
} from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage } from "@/lib/auth";
import {
  type FieldErrors,
  linkErrorFromUrl,
  MIN_PASSWORD_LENGTH,
  passwordStrength,
  resetSchema,
  validate,
} from "@/lib/auth-validation";

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

type LinkState = "checking" | "valid" | "invalid";

function ResetPage() {
  const navigate = useNavigate();
  const [linkState, setLinkState] = useState<LinkState>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldErrors>({});
  const [done, setDone] = useState(false);

  const strength = passwordStrength(password);

  useEffect(() => {
    let cancelled = false;

    const linkError = linkErrorFromUrl(window.location.href);
    if (linkError) {
      setError(linkError);
      setLinkState("invalid");
      return;
    }

    // O cliente troca o código do link por sessão de forma assíncrona:
    // ouvimos o evento e também consultamos a sessão como fallback.
    const { data: sub } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (cancelled) return;
      if (session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN")) {
        setLinkState("valid");
      }
    });

    const timer = setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) setLinkState("valid");
      else {
        setError("Link inválido ou expirado. Solicite um novo e-mail de recuperação.");
        setLinkState("invalid");
      }
    }, 700);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFields({});
    const result = validate(resetSchema, { password, confirm });
    if (!result.data) {
      setFields(result.fieldErrors);
      return;
    }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: result.data.password,
      });
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
      ) : linkState === "checking" ? (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Validando o link de recuperação
        </div>
      ) : linkState === "invalid" ? (
        <div className="space-y-4">
          <FormError message={error} />
          <Button asChild variant="secondary" className="w-full">
            <Link to="/forgot">Solicitar novo link</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Nova senha</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              className="focus-glow"
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
          <div className="space-y-2">
            <Label htmlFor="confirm">Repetir senha</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              className="focus-glow"
              aria-invalid={Boolean(fields["confirm"])}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <FieldError message={fields["confirm"]} />
          </div>
          <FormError message={error} />
          <SubmitButton loading={loading} loadingLabel="Salvando...">
            Salvar nova senha
          </SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}
