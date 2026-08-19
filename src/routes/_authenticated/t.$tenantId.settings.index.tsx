import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { NoPermissionState } from "@/components/techiva/empty-state";
import { Page, PageHeader, Panel, Rise } from "@/components/techiva/page";
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
    <Page>
      <PageHeader
        eyebrow="ADMINISTRAÇÃO"
        title="Configurações da plataforma"
        help={
          <p>
            Este é o CNPJ que o cliente informa no e-CAC quando nos autoriza como procurador para a
            apuração assistida de CBS. Ele aparece no passo a passo da tela de integrações — se
            estiver vazio, o cliente não consegue concluir esse caminho.
          </p>
        }
      />

      <Rise index={1}>
        <Panel
          title="Identidade do procurador"
          icon={Building2}
          className="max-w-2xl"
          help={
            <p>
              A alteração exige verificação em duas etapas (aal2) e fica registrada em auditoria.
            </p>
          }
        >
          <div className="space-y-4">
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
        </Panel>
      </Rise>
    </Page>
  );
}
