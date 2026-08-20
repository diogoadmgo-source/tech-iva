import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Loader2, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoHint } from "@/components/techiva/info-hint";
import { Segmented } from "@/components/techiva/page";
import { authErrorMessage } from "@/lib/auth";
import {
  cancelSubscription,
  changePlan,
  previewPlanChange,
  resumeSubscription,
  type ProrationPreview,
} from "@/lib/billing-manage.functions";
import {
  BILLING_CATALOG,
  cycleLabel,
  planCodeFromPriceId,
  priceIdCycle,
  useRefreshBilling,
  type BillingCycle,
  type BillingSubscription,
} from "@/lib/billing";
import { formatCents } from "@/lib/plans";

/** Ordem de valor do catálogo — define se a troca é upgrade ou downgrade. */
const RANK: Record<string, number> = { starter: 1, pro: 2, scale: 3 };

export type PlanChange = {
  priceId: string;
  planCode: string;
  cycle: BillingCycle;
  kind: "upgrade" | "downgrade";
};

/** Decide o tipo de troca comparando plano e ciclo atuais com o alvo. */
export function classifyChange(
  currentPriceId: string | null,
  targetPriceId: string,
): PlanChange | null {
  const cycle = priceIdCycle(targetPriceId);
  const planCode = planCodeFromPriceId(targetPriceId);
  if (!cycle || !planCode) return null;
  if (currentPriceId === targetPriceId) return null;

  const currentCode = planCodeFromPriceId(currentPriceId);
  const currentCycle = priceIdCycle(currentPriceId);
  const currentRank = currentCode ? (RANK[currentCode] ?? 0) : 0;
  const targetRank = RANK[planCode] ?? 0;

  let kind: "upgrade" | "downgrade" = targetRank >= currentRank ? "upgrade" : "downgrade";
  if (targetRank === currentRank) {
    // mesmo plano, só muda o ciclo: anual é upgrade, mensal é downgrade
    kind = cycle === "year" && currentCycle === "month" ? "upgrade" : "downgrade";
  }
  return { priceId: targetPriceId, planCode, cycle, kind };
}

function planName(code: string | null): string {
  return BILLING_CATALOG.find((p) => p.code === code)?.name ?? (code ?? "—");
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Diálogo de confirmação da troca de plano, com prévia de cobrança proporcional. */
export function PlanChangeDialog({
  tenantId,
  change,
  onOpenChange,
}: {
  tenantId: string;
  change: PlanChange | null;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefreshBilling(tenantId);
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<ProrationPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const timing = change?.kind === "upgrade" ? "immediately" : "next_billing_period";

  useEffect(() => {
    if (!change) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let alive = true;
    setLoadingPreview(true);
    setPreviewError(null);
    previewPlanChange({ data: { tenantId, priceId: change.priceId, timing } })
      .then((result) => {
        if (alive) setPreview(result);
      })
      .catch((err) => {
        if (alive) setPreviewError(authErrorMessage(err));
      })
      .finally(() => {
        if (alive) setLoadingPreview(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change?.priceId, tenantId, timing]);

  const apply = useMutation({
    mutationFn: async () => {
      if (!change) return;
      await changePlan({ data: { tenantId, priceId: change.priceId, timing } });
    },
    onSuccess: () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: ["billing-subscription", tenantId] });
      toast.success(
        change?.kind === "upgrade"
          ? "Plano atualizado agora."
          : "Troca agendada para o próximo ciclo.",
      );
      onOpenChange(false);
    },
    onError: (err) => toast.error(authErrorMessage(err)),
  });

  return (
    <AlertDialog open={Boolean(change)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {change?.kind === "upgrade" ? (
              <ArrowUpRight className="size-4 text-primary" aria-hidden />
            ) : (
              <ArrowDownRight className="size-4 text-warn" aria-hidden />
            )}
            {change?.kind === "upgrade" ? "Subir para" : "Descer para"} {planName(change?.planCode ?? null)}
            {change ? (
              <span className="text-xs font-normal text-muted-foreground">
                {cycleLabel(change.cycle)}
              </span>
            ) : null}
            <InfoHint title="Como fica a cobrança">
              <p>
                Ao subir de plano, o provedor cobra agora só a diferença proporcional aos dias que
                faltam no ciclo e o acesso muda na hora.
              </p>
              <p>
                Ao descer, o plano atual continua até o fim do período já pago e o valor novo passa a
                valer na renovação — sem perda do que foi pago.
              </p>
            </InfoHint>
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              {loadingPreview ? (
                <Skeleton className="h-12 w-full" />
              ) : previewError ? (
                <span className="text-destructive">{previewError}</span>
              ) : preview ? (
                <div className="space-y-1">
                  <Row
                    label={change?.kind === "upgrade" ? "Cobrança agora" : "Cobrança agora"}
                    value={formatCents(preview.amountDueNow)}
                  />
                  <Row
                    label="Próxima fatura"
                    value={
                      preview.nextBillingAmount === null
                        ? "—"
                        : `${formatCents(preview.nextBillingAmount)} em ${formatDate(preview.nextBilledAt)}`
                    }
                  />
                </div>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={apply.isPending}>Voltar</AlertDialogCancel>
          <AlertDialogAction
            disabled={apply.isPending || loadingPreview}
            onClick={(event) => {
              event.preventDefault();
              apply.mutate();
            }}
          >
            {apply.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Confirmar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-surface-2/50 px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}

/** Cancelamento e retomada da assinatura, sem sair do app. */
export function BillingLifecycleActions({
  tenantId,
  subscription,
}: {
  tenantId: string;
  subscription: BillingSubscription;
}) {
  const refresh = useRefreshBilling(tenantId);
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState<"next_billing_period" | "immediately">("next_billing_period");

  const cancel = useMutation({
    mutationFn: () => cancelSubscription({ data: { tenantId, effectiveFrom: when } }),
    onSuccess: () => {
      refresh();
      toast.success(
        when === "immediately" ? "Assinatura cancelada." : "Cancelamento agendado para o fim do período.",
      );
      setOpen(false);
    },
    onError: (err) => toast.error(authErrorMessage(err)),
  });

  const resume = useMutation({
    mutationFn: () => resumeSubscription({ data: { tenantId } }),
    onSuccess: () => {
      refresh();
      toast.success("Renovação automática restabelecida.");
    },
    onError: (err) => toast.error(authErrorMessage(err)),
  });

  const canceled = subscription.status === "canceled";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {subscription.cancel_at_period_end && !canceled ? (
        <Button
          variant="outline"
          size="sm"
          disabled={resume.isPending}
          onClick={() => resume.mutate()}
        >
          {resume.isPending ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <RotateCcw className="mr-2 size-4" />
          )}
          Manter assinatura
        </Button>
      ) : null}

      {!canceled ? (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <XCircle className="mr-2 size-4" />
          Cancelar
        </Button>
      ) : null}

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              Cancelar assinatura
              <InfoHint title="Quando o acesso termina">
                <p>
                  No fim do período, o acesso segue até {formatDate(subscription.current_period_end)}{" "}
                  e nada mais é cobrado depois disso.
                </p>
                <p>
                  Imediato encerra o acesso pago agora; eventual crédito é tratado pelo provedor de
                  pagamento.
                </p>
              </InfoHint>
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <Segmented
                  label="Quando cancelar"
                  value={when}
                  onChange={setWhen}
                  options={[
                    { value: "next_billing_period", label: "No fim do período" },
                    { value: "immediately", label: "Imediato" },
                  ]}
                />
                <Row
                  label="Acesso até"
                  value={
                    when === "immediately" ? "agora" : formatDate(subscription.current_period_end)
                  }
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancel.isPending}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancel.isPending}
              onClick={(event) => {
                event.preventDefault();
                cancel.mutate();
              }}
            >
              {cancel.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Confirmar cancelamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
