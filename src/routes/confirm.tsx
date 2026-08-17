import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AuthShell, FormError } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage } from "@/lib/auth";
import { resolvePostLoginRoute } from "@/lib/post-login";

export const Route = createFileRoute("/confirm")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Confirmando acesso — TECH-IVA" },
      {
        name: "description",
        content: "Validação do link de confirmação de e-mail ou de acesso por link mágico no TECH-IVA.",
      },
      { property: "og:title", content: "Confirmando acesso — TECH-IVA" },
      {
        property: "og:description",
        content: "Validação do link de confirmação de e-mail no TECH-IVA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConfirmPage,
});

function ConfirmPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!data.session) {
          throw new Error("Link inválido ou expirado. Solicite um novo e-mail.");
        }
        const target = await resolvePostLoginRoute();
        if (cancelled) return;
        setStatus("ok");
        navigate({ to: target, replace: true });
      } catch (err) {
        if (cancelled) return;
        setError(authErrorMessage(err));
        setStatus("error");
      }
    }

    // Dá tempo ao cliente de trocar o código do link pela sessão.
    const timer = setTimeout(run, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [navigate]);

  return (
    <AuthShell
      title="Confirmando acesso"
      subtitle={
        status === "loading"
          ? "Validando o link enviado para o seu e-mail…"
          : "Resultado da confirmação."
      }
    >
      {status === "loading" ? (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Aguarde um instante
        </div>
      ) : null}

      {status === "error" ? (
        <div className="space-y-4">
          <FormError message={error} />
          <Button asChild variant="secondary" className="w-full">
            <Link to="/login">Voltar para o login</Link>
          </Button>
        </div>
      ) : null}
    </AuthShell>
  );
}
