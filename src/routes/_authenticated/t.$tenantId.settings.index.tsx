import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Building2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { NoPermissionState } from "@/components/techiva/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlatformIdentity, useSetPlatformIdentity } from "@/lib/notices";
import { useShellData } from "@/lib/tenant-shell-data";

export const Route = createFileRoute("/_authenticated/t/$tenantId/settings/")({
  head: () => ({
    meta: [
      { title: "Configurações da plataforma — TECH-IVA" },
      {
        name: "description",
        content:
          "Identidade da plataforma usada pelos clientes ao nos nomear procurador no e-CAC: CNPJ, razão social e nome de exibição.",
      },
      { property: "og:title", content: "Configurações da plataforma — TECH-IVA" },
      {
        property: "og:description",
        content: "CNPJ do procurador, razão social e nome exibido nos passos do e-CAC.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PlatformSettingsPage,
});

function PlatformSettingsPage() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const identity = usePlatformIdentity();
  const save = useSetPlatformIdentity();

  const [cnpj, setCnpj] = useState("");
  const [razao, setRazao] = useState("");
  const [nome, setNome] = useState("");

  const isPlatform = shell.data?.tenant?.kind === "platform";

  useEffect(() => {
    const d = identity.data;
    if (!d) return;
    setCnpj(d.cnpj.startsWith("(") ? "" : d.cnpj);
    setRazao(d.razao_social.startsWith("(") ? "" : d.razao_social);
    setNome(d.nome_exibicao);
  }, [identity.data]);

  if (shell.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!isPlatform || shell.data?.role !== "platform_admin") {
    return <NoPermissionState hint="Só o administrador da plataforma edita a identidade usada no e-CAC." />;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-medium">Configurações da plataforma</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Este é o CNPJ que o cliente informa no e-CAC quando nos autoriza como procurador para a
          apuração assistida de CBS. Ele aparece no passo a passo da tela de integrações — se estiver
          vazio, o cliente não consegue concluir esse caminho.
        </p>
      </header>

      <section className="max-w-2xl rounded-xl border border-border bg-surface-1 p-5">
        <div className="flex items-center gap-2">
          <Building2 className="size-4 text-primary" aria-hidden />
          <h2 className="text-base font-medium">Identidade do procurador</h2>
        </div>

        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pi-cnpj">CNPJ da plataforma</Label>
            <Input
              id="pi-cnpj"
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value)}
              placeholder="00.000.000/0000-00"
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pi-razao">Razão social</Label>
            <Input id="pi-razao" value={razao} onChange={(e) => setRazao(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pi-nome">Nome de exibição</Label>
            <Input id="pi-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
        </div>

        <Button
          className="mt-5"
          disabled={cnpj.trim().length < 14 || razao.trim().length < 3 || save.isPending}
          onClick={async () => {
            try {
              await save.mutateAsync({ cnpj: cnpj.trim(), razao: razao.trim(), nome: nome.trim() });
              toast.success("Identidade da plataforma atualizada.");
            } catch (error) {
              const message = error instanceof Error ? error.message : "Falha ao salvar.";
              toast.error(
                message.includes("MFA")
                  ? "MFA required — ative a verificação em duas etapas para esta operação."
                  : message === "forbidden"
                    ? "Só a plataforma pode alterar a identidade."
                    : message,
              );
            }
          }}
        >
          {save.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
          Salvar identidade
        </Button>

        <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          A alteração exige verificação em duas etapas (aal2) e fica registrada em auditoria.
        </p>
      </section>
    </div>
  );
}
