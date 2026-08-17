import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Loader2, Plus, Send } from "lucide-react";
import { toast } from "sonner";

import { CnpjText } from "@/components/techiva/money";
import { EmptyState, ErrorState } from "@/components/techiva/empty-state";
import { Semaphore } from "@/components/techiva/badges";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { sendInviteEmail } from "@/lib/invite-email.functions";
import { useCanAdmin, useMemberMutations } from "@/lib/members";
import {
  isValidCnpj,
  onboardingProgress,
  type IntegrationRow,
  type OnboardingSettings,
} from "@/lib/onboarding";
import { useTenantMutations, useTenantTree } from "@/lib/tenants";
import { useShellData } from "@/lib/tenant-shell-data";

export const Route = createFileRoute("/_authenticated/t/$tenantId/companies")({
  head: () => ({
    meta: [
      { title: "Empresas do canal — TECH-IVA" },
      {
        name: "description",
        content:
          "Cadastre empresas no canal, convide o responsável e acompanhe o estágio do onboarding de cada CNPJ.",
      },
      { property: "og:title", content: "Empresas do canal — TECH-IVA" },
      {
        property: "og:description",
        content: "Cadastro de CNPJs, convite do dono e status do onboarding em um só lugar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CompaniesPage,
});

type CompanyRow = {
  id: string;
  name: string;
  cnpj: string | null;
  step: number;
  stepLabel: string;
};

function CompaniesPage() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const tree = useTenantTree(tenantId);
  const { data: canAdmin } = useCanAdmin(tenantId);

  const companyIds = useMemo(
    () => (tree.data?.all ?? []).filter((t) => t.kind === "company").map((t) => t.id),
    [tree.data],
  );

  const onboarding = useQuery({
    queryKey: ["companies-onboarding", tenantId, companyIds.join(",")],
    enabled: companyIds.length > 0,
    queryFn: async () => {
      const [{ data: tenants, error: tErr }, { data: integrations, error: iErr }] =
        await Promise.all([
          supabase.from("tenants").select("id, settings").in("id", companyIds),
          supabase
            .from("integrations")
            .select("id, kind, status, config, connected_at, error, tenant_id")
            .in("tenant_id", companyIds),
        ]);
      if (tErr) throw tErr;
      if (iErr) throw iErr;
      const byTenant = new Map<string, IntegrationRow[]>();
      for (const row of integrations ?? []) {
        const list = byTenant.get(row.tenant_id) ?? [];
        list.push(row as IntegrationRow);
        byTenant.set(row.tenant_id, list);
      }
      const out = new Map<string, { step: number; label: string }>();
      for (const t of tenants ?? []) {
        const settings = ((t.settings ?? {}) as Record<string, unknown>)["onboarding"] as
          | OnboardingSettings
          | undefined;
        out.set(
          t.id,
          onboardingProgress({
            settings: settings ?? {},
            integrations: byTenant.get(t.id) ?? [],
          }),
        );
      }
      return out;
    },
  });

  const rows: CompanyRow[] = useMemo(() => {
    const progress = onboarding.data;
    return (tree.data?.all ?? [])
      .filter((t) => t.kind === "company")
      .map((t) => {
        const p = progress?.get(t.id);
        return {
          id: t.id,
          name: t.name,
          cnpj: t.cnpj,
          step: p?.step ?? 0,
          stepLabel: p?.label ?? "Empresa",
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [tree.data, onboarding.data]);

  if (tree.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (tree.isError) {
    return <ErrorState message="Falha ao carregar as empresas." onRetry={() => void tree.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Canal</p>
          <h1 className="text-2xl font-semibold">Empresas</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} CNPJ{rows.length === 1 ? "" : "s"} sob{" "}
            {shell.data?.tenant.name ?? "este canal"} · cadastre, convide o dono e acompanhe o
            onboarding.
          </p>
        </div>
        {canAdmin && <NewCompanyDialog parentId={tenantId} />}
      </header>

      {rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Nenhuma empresa cadastrada"
          hint="Cadastre o primeiro CNPJ para começar a ler a operação e projetar o caixa."
          action={canAdmin ? <NewCompanyDialog parentId={tenantId} /> : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface-1">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-2 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Empresa</th>
                <th className="px-3 py-2 text-left font-medium">CNPJ</th>
                <th className="px-3 py-2 text-left font-medium">Onboarding</th>
                <th className="px-3 py-2 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-medium">{row.name}</td>
                  <td className="px-3 py-2">
                    {row.cnpj ? <CnpjText value={row.cnpj} /> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <Semaphore level={row.step >= 4 ? "ok" : row.step >= 2 ? "warn" : "crit"} />
                      <span className="text-xs text-muted-foreground">
                        {row.step >= 4 ? "Concluído" : `Passo ${row.step + 1}/4 · ${row.stepLabel}`}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      <InviteOwnerDialog companyId={row.id} companyName={row.name} />
                      <Button asChild size="sm" variant="outline">
                        <Link to="/t/$tenantId/onboarding" params={{ tenantId: row.id }}>
                          Onboarding
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="ghost">
                        <Link to="/t/$tenantId/cash" params={{ tenantId: row.id }}>
                          Caixa
                        </Link>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewCompanyDialog({ parentId }: { parentId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [cnpj, setCnpj] = useState("");
  const { create } = useTenantMutations(parentId);
  const digits = cnpj.replace(/\D/g, "");
  const cnpjOk = isValidCnpj(digits);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 size-4" aria-hidden /> Nova empresa
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova empresa</DialogTitle>
          <DialogDescription>
            A empresa entra sob este canal e herda a marca dele.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-company-name">Razão social</Label>
            <Input id="new-company-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-company-cnpj">CNPJ</Label>
            <Input
              id="new-company-cnpj"
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value)}
              placeholder="00.000.000/0000-00"
              className="font-mono tabular"
              aria-invalid={digits.length > 0 && !cnpjOk}
            />
            {digits.length > 0 && !cnpjOk && (
              <p className="text-xs text-destructive">CNPJ inválido.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!name.trim() || !cnpjOk || create.isPending}
            onClick={async () => {
              try {
                await create.mutateAsync({
                  parentId,
                  kind: "company",
                  name: name.trim(),
                  cnpj: digits,
                });
                toast.success("Empresa criada.");
                setOpen(false);
                setName("");
                setCnpj("");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Falha ao criar empresa.");
              }
            }}
          >
            {create.isPending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
            Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteOwnerDialog({ companyId, companyName }: { companyId: string; companyName: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const { invite } = useMemberMutations(companyId);
  const sendEmail = useServerFn(sendInviteEmail);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Send className="mr-2 size-3.5" aria-hidden /> Convidar dono
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar dono</DialogTitle>
          <DialogDescription>
            O convidado entra como <span className="font-medium">owner</span> de {companyName}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="invite-owner-email">E-mail</Label>
          <Input
            id="invite-owner-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button
            disabled={!email.includes("@") || invite.isPending}
            onClick={async () => {
              try {
                const result = await invite.mutateAsync({ email: email.trim(), role: "owner" });
                await sendEmail({
                  data: {
                    tenantId: companyId,
                    invitationId: result.invitationId,
                    token: result.token,
                    origin: window.location.origin,
                  },
                });
                toast.success(`Convite enviado para ${email.trim()}.`);
                setOpen(false);
                setEmail("");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Falha ao convidar.");
              }
            }}
          >
            {invite.isPending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
            Enviar convite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
