import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AuthShell, FormError } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage } from "@/lib/auth";
import { linkErrorFromUrl } from "@/lib/auth-validation";
import { resolvePostLoginRoute } from "@/lib/post-login";

export const Route = createFileRoute("/confirm")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Confirmando acesso — TECH-IVA" },
      {
        name: "description",
        content:
          "Validação do link de confirmação de e-mail ou de acesso por link mágico no TECH-IVA.",
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
    let settled = false;

    // 1) O link pode já trazer o erro (otp_expired, access_denied…).
    const linkError = linkErrorFromUrl(window.location.href);
    if (linkError) {
      setError(linkError);
      setStatus("error");
      return;
    }

    async function finish() {
      if (settled || cancelled) return;
      settled = true;
      try {
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

    // 2) Sessão pode chegar via evento (troca do código pelo cliente).
    const { data: sub } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (session) void finish();
    });

    // 3) Fallback: consulta direta com tentativas até ~3s.
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts += 1;
      const { data } = await supabase.auth.getSession();
      if (cancelled || settled) return;
      if (data.session) {
        clearInterval(interval);
        void finish();
        return;
      }
      if (attempts >= 6) {
        clearInterval(interval);
        setError("Link inválido ou expirado. Solicite um novo e-mail.");
        setStatus("error");
      }
    }, 500);

    return () => {
      cancelled = true;
      clearInterval(interval);
      sub.subscription.unsubscribe();
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
          <p className="text-sm text-muted-foreground">
            Você pode entrar novamente para receber um novo link de confirmação.
          </p>
          <Button asChild variant="secondary" className="w-full">
            <Link to="/login">Voltar para o login</Link>
          </Button>
        </div>
      ) : null}
    </AuthShell>
  );
}
