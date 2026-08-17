import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { FormError } from "@/components/auth/auth-shell";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authErrorMessage } from "@/lib/auth";
import {
  SUBSCRIPTION_STATUSES,
  formatCents,
  useChangeSubscription,
  useIsPlatform,
  usePlanMutations,
  usePlans,
  useSubscription,
  type Plan,
} from "@/lib/plans";
import { useShellData } from "@/lib/tenant-shell-data";

export const Route = createFileRoute("/_authenticated/t/$tenantId/plans")({
  head: () => ({
    meta: [
      { title: "Planos e assinatura · TECH-IVA" },
      {
        name: "description",
        content:
          "Catálogo de planos da plataforma TECH-IVA e assinatura vigente da organização selecionada.",
      },
      { property: "og:title", content: "Planos e assinatura · TECH-IVA" },
      {
        property: "og:description",
        content: "Gestão de planos, limites e assinatura por organização no TECH-IVA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PlansPage,
});

type Draft = {
  code: string;
  name: string;
  price: string;
  limits: string;
  features: string;
  active: boolean;
};

const EMPTY_DRAFT: Draft = {
  code: "",
  name: "",
  price: "0",
  limits: "{}",
  features: "{}",
  active: true,
};

function PlansPage() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const plans = usePlans();
  const isPlatform = useIsPlatform();
  const subscription = useSubscription(tenantId);
  const { create, update, remove } = usePlanMutations();
  const changeSubscription = useChangeSubscription(tenantId);

  const [editing, setEditing] = useState<Plan | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  const [planId, setPlanId] = useState<string>("");
  const [status, setStatus] = useState<string>("active");
  const [subError, setSubError] = useState<string | null>(null);

  const canManagePlans = isPlatform.data === true;
  const current = subscription.data ?? null;
  const currentPlan = useMemo(
    () => plans.data?.find((p) => p.id === current?.plan_id) ?? null,
    [plans.data, current],
  );

  function openCreate() {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
    setDialogOpen(true);
  }

  function openEdit(plan: Plan) {
    setEditing(plan);
    setDraft({
      code: plan.code,
      name: plan.name,
      price: String(plan.price_cents / 100),
      limits: JSON.stringify(plan.limits ?? {}, null, 2),
      features: JSON.stringify(plan.features ?? {}, null, 2),
      active: plan.active,
    });
    setError(null);
    setDialogOpen(true);
  }

  async function submitPlan() {
    setError(null);
    if (!draft.code.trim() || !draft.name.trim()) {
      setError("Código e nome são obrigatórios.");
      return;
    }
    const price = Number(draft.price.replace(",", "."));
    if (!Number.isFinite(price) || price < 0) {
      setError("Preço inválido.");
      return;
    }
    let limits: unknown;
    let features: unknown;
    try {
      limits = JSON.parse(draft.limits || "{}");
      features = JSON.parse(draft.features || "{}");
    } catch {
      setError("Limites e features precisam ser JSON válido.");
      return;
    }

    const payload = {
      code: draft.code.trim(),
      name: draft.name.trim(),
      price_cents: Math.round(price * 100),
      limits: limits as never,
      features: features as never,
      active: draft.active,
    };

    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, ...payload });
        toast.success("Plano atualizado.");
      } else {
        await create.mutateAsync(payload);
        toast.success("Plano criado.");
      }
      setDialogOpen(false);
    } catch (err) {
      setError(authErrorMessage(err));
    }
  }

  async function submitSubscription() {
    setSubError(null);
    if (!planId) {
      setSubError("Selecione um plano.");
      return;
    }
    try {
      await changeSubscription.mutateAsync({ planId, status, current });
      toast.success("Assinatura atualizada.");
    } catch (err) {
      setSubError(authErrorMessage(err));
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Planos e assinatura</h1>
        <p className="text-sm text-muted-foreground">
          Catálogo global de planos e a assinatura de{" "}
          <span className="text-foreground">{shell.data?.tenant.name ?? "…"}</span>.
        </p>
      </header>

      <Tabs defaultValue="catalog">
        <TabsList>
          <TabsTrigger value="catalog">Catálogo</TabsTrigger>
          <TabsTrigger value="subscription">Assinatura</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="space-y-4 pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {canManagePlans
                ? "Você pode criar e editar planos (papel de plataforma)."
                : "Somente papéis de plataforma podem alterar o catálogo."}
            </p>
            {canManagePlans ? (
              <Button onClick={openCreate}>
                <Plus className="mr-2 size-4" /> Novo plano
              </Button>
            ) : null}
          </div>

          {plans.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Preço</TableHead>
                    <TableHead>Status</TableHead>
                    {canManagePlans ? <TableHead className="w-24" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(plans.data ?? []).map((plan) => (
                    <TableRow key={plan.id}>
                      <TableCell className="font-mono text-xs">{plan.code}</TableCell>
                      <TableCell>{plan.name}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatCents(plan.price_cents)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={plan.active ? "secondary" : "outline"}>
                          {plan.active ? "ativo" : "inativo"}
                        </Badge>
                      </TableCell>
                      {canManagePlans ? (
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(plan)}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={async () => {
                              try {
                                await remove.mutateAsync(plan.id);
                                toast.success("Plano removido.");
                              } catch (err) {
                                toast.error(authErrorMessage(err));
                              }
                            }}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                  {(plans.data ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-sm text-muted-foreground">
                        Nenhum plano cadastrado.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="subscription" className="space-y-4 pt-4">
          {subscription.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="space-y-4 rounded-lg border border-border bg-card p-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Assinatura vigente</p>
                <p className="text-foreground">
                  {currentPlan ? `${currentPlan.name} · ${formatCents(currentPlan.price_cents)}` : "Sem assinatura"}
                </p>
                {current ? (
                  <p className="font-mono text-xs text-muted-foreground">
                    status {current.status} · início{" "}
                    {new Date(current.started_at).toLocaleDateString("pt-BR")}
                    {current.ends_at
                      ? ` · fim ${new Date(current.ends_at).toLocaleDateString("pt-BR")}`
                      : ""}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Plano</Label>
                  <Select value={planId} onValueChange={setPlanId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {(plans.data ?? [])
                        .filter((p) => p.active)
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SUBSCRIPTION_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <FormError message={subError} />
              <Button onClick={() => void submitSubscription()} disabled={changeSubscription.isPending}>
                {changeSubscription.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Salvar assinatura
              </Button>
              <p className="text-xs text-muted-foreground">
                A alteração só é aceita para papéis de plataforma ou administrador do canal — o banco
                valida via RLS.
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar plano" : "Novo plano"}</DialogTitle>
            <DialogDescription>
              Limites e features são objetos JSON usados pela aplicação.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="code">Código</Label>
                <Input
                  id="code"
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="price">Preço (R$)</Label>
                <Input
                  id="price"
                  value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input
                id="name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="limits">Limites (JSON)</Label>
              <textarea
                id="limits"
                className="min-h-24 w-full rounded-md border border-input bg-background p-2 font-mono text-xs text-foreground"
                value={draft.limits}
                onChange={(e) => setDraft({ ...draft, limits: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="features">Features (JSON)</Label>
              <textarea
                id="features"
                className="min-h-24 w-full rounded-md border border-input bg-background p-2 font-mono text-xs text-foreground"
                value={draft.features}
                onChange={(e) => setDraft({ ...draft, features: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="active"
                checked={draft.active}
                onCheckedChange={(v: boolean) => setDraft({ ...draft, active: v })}
              />
              <Label htmlFor="active">Plano ativo</Label>
            </div>
            <FormError message={error} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void submitPlan()}
              disabled={create.isPending || update.isPending}
            >
              {create.isPending || update.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
