import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

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
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage } from "@/lib/auth";
import { type FieldErrors, forgotSchema, validate } from "@/lib/auth-validation";

export const Route = createFileRoute("/forgot")({
  head: () => ({
    meta: [
      { title: "Recuperar senha — TECH-IVA" },
      {
        name: "description",
        content: "Receba um link por e-mail para definir uma nova senha de acesso ao TECH-IVA.",
      },
      { property: "og:title", content: "Recuperar senha — TECH-IVA" },
      {
        property: "og:description",
        content: "Receba um link por e-mail para definir uma nova senha no TECH-IVA.",
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
  const [fields, setFields] = useState<FieldErrors>({});
  const [sent, setSent] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFields({});
    const result = validate(forgotSchema, { email });
    if (!result.data) {
      setFields(result.fieldErrors);
      return;
    }
    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(result.data.email, {
        redirectTo: `${window.location.origin}/reset`,
      });
      if (resetError) throw resetError;
      setSent(result.data.email);
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
        <div className="space-y-4">
          {/* Resposta neutra: não revelamos se a conta existe. */}
          <FormSuccess message={`Se existir conta para ${sent}, o link já está a caminho.`} />
          <p className="text-sm text-muted-foreground">
            O link expira em 1 hora e só pode ser usado uma vez.
          </p>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={loading}
            onClick={() => setSent(null)}
          >
            Usar outro e-mail
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
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
          <FormError message={error} />
          <SubmitButton loading={loading} loadingLabel="Enviando...">
            Enviar link
          </SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}
