import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AuthShell, FormError, FormSuccess } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage } from "@/lib/auth";

export const Route = createFileRoute("/invite/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Aceitar convite — TECH-IVA" },
      {
        name: "description",
        content:
          "Aceite o convite para uma organização no TECH-IVA. O papel é aplicado pelo RPC accept_invitation.",
      },
      { property: "og:title", content: "Aceitar convite — TECH-IVA" },
      {
        property: "og:description",
        content: "Aceite o convite para uma organização no TECH-IVA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setHasSession(Boolean(data.session)));
  }, []);

  async function accept() {
    setError(null);
    setBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc("accept_invitation", {
        p_token: token,
      });
      if (rpcError) throw rpcError;
      setInfo("Convite aceito. Redirecionando…");
      const tenantId = data as string | null;
      setTimeout(() => {
        if (tenantId) navigate({ to: "/t/$tenantId", params: { tenantId }, replace: true });
        else navigate({ to: "/select-tenant", replace: true });
      }, 900);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Aceitar convite"
      subtitle="O convite é validado no banco: precisa estar pendente, dentro do prazo e no mesmo e-mail da sua conta."
      footer={
        <Link to="/login" className="text-primary hover:underline">
          Usar outra conta
        </Link>
      }
    >
      <div className="space-y-4">
        <p className="font-mono text-xs break-all text-muted-foreground">token: {token}</p>

        {hasSession === false ? (
          <>
            <FormError message="Entre na conta com o e-mail que recebeu o convite para continuar." />
            <Button asChild className="w-full">
              <Link to="/login" search={{ redirect: `/invite/${token}` }}>
                Ir para o login
              </Link>
            </Button>
          </>
        ) : (
          <>
            <FormError message={error} />
            <FormSuccess message={info} />
            <Button
              className="w-full"
              disabled={busy || hasSession === null}
              onClick={() => void accept()}
            >
              {busy ? "Validando convite…" : "Aceitar convite"}
            </Button>
          </>
        )}
      </div>
    </AuthShell>
  );
}
