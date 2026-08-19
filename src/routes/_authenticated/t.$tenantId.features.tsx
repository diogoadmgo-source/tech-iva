import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/techiva/data-table";
import { ErrorState, NoPermissionState } from "@/components/techiva/empty-state";
import { Page, PageHeader, Panel, Rise } from "@/components/techiva/page";
import { CnpjText } from "@/components/techiva/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { usePlatformFeatures, useSetTenantFeature, type PlatformFeatureRow } from "@/lib/features";
import { useShellData } from "@/lib/tenant-shell-data";
import type { ColumnDef } from "@tanstack/react-table";

export const Route = createFileRoute("/_authenticated/t/$tenantId/features")({
  head: () => ({
    meta: [
      { title: "Módulo de crédito — TECH-IVA" },
      {
        name: "description",
        content:
          "Painel da plataforma para habilitar ou bloquear o módulo de crédito por empresa e por canal, com motivo registrado em auditoria.",
      },
      { property: "og:title", content: "Módulo de crédito — TECH-IVA" },
      {
        property: "og:description",
        content: "Controle de liberação do módulo de crédito por tenant, auditado e com MFA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FeaturesPage,
});

const KIND_LABEL: Record<string, string> = {
  platform: "plataforma",
  channel: "canal",
  company: "empresa",
  unit: "filial",
};

type PendingAction = { row: PlatformFeatureRow; enable: boolean };

function FeaturesPage() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const role = shell.data?.role ?? null;
  const allowed = role === "platform_admin" || role === "platform_ops";

  const features = usePlatformFeatures("credit", allowed);
  const setFeature = useSetTenantFeature("credit");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const rows = features.data ?? [];

  const columns = useMemo<ColumnDef<PlatformFeatureRow, unknown>[]>(
    () => [
      { accessorKey: "tenant_name", header: "Nome" },
      {
        accessorKey: "cnpj",
        header: "CNPJ",
        cell: ({ row }) =>
          row.original.cnpj ? <CnpjText value={row.original.cnpj} /> : <span>—</span>,
      },
      {
        accessorKey: "kind",
        header: "Tipo",
        cell: ({ row }) => KIND_LABEL[row.original.kind] ?? row.original.kind,
      },
      {
        accessorKey: "enabled",
        header: "Estado",
        cell: ({ row }) =>
          row.original.enabled ? (
            <Badge className="bg-flow-in/15 text-flow-in">habilitado</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              desligado
            </Badge>
          ),
      },
      {
        id: "enabled_by",
        header: "Habilitado por",
        cell: ({ row }) => row.original.enabled_by_label ?? "—",
      },
      {
        accessorKey: "enabled_at",
        header: "Quando",
        cell: ({ row }) =>
          row.original.enabled_at
            ? new Date(row.original.enabled_at).toLocaleString("pt-BR")
            : "—",
      },
      {
        accessorKey: "note",
        header: "Motivo / contrato",
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.note ?? "—"}</span>
        ),
      },
      {
        id: "toggle",
        header: "Ação",
        cell: ({ row }) => (
          <Button
            size="sm"
            variant={row.original.enabled ? "outline" : "default"}
            onClick={() => {
              setPending({ row: row.original, enable: !row.original.enabled });
              setNote("");
              setConfirmed(false);
            }}
          >
            {row.original.enabled ? "Desabilitar" : "Habilitar"}
          </Button>
        ),
      },
    ],
    [],
  );

  if (shell.isSuccess && !allowed) {
    return (
      <NoPermissionState hint="A liberação do módulo de crédito é exclusiva da plataforma (platform_admin ou platform_ops)." />
    );
  }

  if (features.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar o estado do módulo"
        message={(features.error as Error)?.message}
        onRetry={() => void features.refetch()}
      />
    );
  }

  const enabledCount = rows.filter((r) => r.enabled).length;

  async function submit() {
    if (!pending) return;
    try {
      await setFeature.mutateAsync({
        tenantId: pending.row.tenant_id,
        enabled: pending.enable,
        ...(pending.enable ? { note: note.trim() } : {}),
      });
      toast.success(
        pending.enable
          ? `Módulo de crédito habilitado para ${pending.row.tenant_name}.`
          : `Módulo de crédito bloqueado para ${pending.row.tenant_name}.`,
      );
      setPending(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao alterar o módulo.";
      toast.error(/aal2|mfa/i.test(message) ? "MFA required — refaça a verificação em dois fatores." : message);
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="administração"
        title="Módulo de crédito"
        helpTitle="Sobre este módulo"
        help={
          <>
            <p>
              O módulo de crédito está construído, porém desligado por padrão: ele só faz sentido
              com fundo ou banco parceiro contratado.
            </p>
            <p>
              Habilite empresa por empresa (ou um canal inteiro, que a liberação é herdada pelos
              descendentes) informando o contrato de funding.
            </p>
          </>
        }
      />

      <Rise index={1}>
        <Panel
          title="Tenants"
          help={<p>{enabledCount} de {rows.length} tenants com o módulo habilitado.</p>}
        >
          <div className="overflow-x-auto">
            <DataTable
              columns={columns}
              data={rows}
              loading={features.isLoading}
              searchPlaceholder="Buscar tenant ou CNPJ…"
              emptyTitle="Nenhum tenant ativo"
              emptyHint="Canais e empresas ativos aparecem aqui."
              exportName="modulo-credito"
            />
          </div>
        </Panel>
      </Rise>

      <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {pending?.enable ? (
                <ShieldCheck className="size-4 text-flow-in" aria-hidden />
              ) : (
                <ShieldAlert className="size-4 text-warn" aria-hidden />
              )}
              {pending?.enable ? "Habilitar módulo de crédito" : "Desabilitar módulo de crédito"}
            </DialogTitle>
            <DialogDescription>
              {pending?.enable
                ? `Isso libera oferta e contratação de crédito para ${pending?.row.tenant_name} (e para os tenants abaixo dele). Só habilite com funding contratado.`
                : `Os contratos existentes de ${pending?.row.tenant_name} continuam no banco, mas ficam inacessíveis pela interface enquanto o módulo estiver desligado.`}
            </DialogDescription>
          </DialogHeader>

          {pending?.enable ? (
            <div className="space-y-3">
              <div>
                <Label htmlFor="feature-note">Motivo / contrato de funding</Label>
                <Textarea
                  id="feature-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Ex.: contrato de funding 2026-014 — Banco Parceiro S.A."
                  className="mt-1"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Obrigatório: o motivo vai para o audit_log.
                </p>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="mt-1"
                />
                <span>
                  Confirmo que existe fundo ou banco parceiro para esta empresa e que ela pode
                  receber ofertas de crédito.
                </span>
              </label>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={
                setFeature.isPending ||
                (pending?.enable ? note.trim().length < 3 || !confirmed : false)
              }
              variant={pending?.enable ? "default" : "outline"}
            >
              {pending?.enable ? "Habilitar crédito" : "Desabilitar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
