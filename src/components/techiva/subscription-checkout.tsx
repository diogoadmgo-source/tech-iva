import { useEffect, useMemo, useState } from "react";
import { Check, CreditCard, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PaymentTestBadge } from "@/components/techiva/payment-test-banner";
import { Panel, Rise, Segmented } from "@/components/techiva/page";
import { authErrorMessage } from "@/lib/auth";
import {
  BILLING_CATALOG,
  BILLING_STATUS,
  cycleLabel,
  planCodeFromPriceId,
  priceIdCycle,
  useBillingPortal,
  useBillingSubscription,
  useCanManageBilling,
  useRefreshBilling,
  type BillingCycle,
} from "@/lib/billing";
import { usePaddleCheckout } from "@/lib/paddle";
import { formatCents } from "@/lib/plans";
import { useProfile } from "@/lib/profile";

const TONE_CLASS: Record<string, string> = {
  ok: "border-success/40 bg-success/10 text-success",
  warn: "border-warn/40 bg-warn/10 text-warn",
  bad: "border-destructive/40 bg-destructive/10 text-destructive",
  neutral: "border-border bg-surface-2/60 text-muted-foreground",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Tela de assinatura: escolha do plano, checkout e status do pagamento. */
export function SubscriptionCheckoutSection({ tenantId }: { tenantId: string }) {
  const profile = useProfile();
  const canManage = useCanManageBilling(tenantId);
  const portal = useBillingPortal(tenantId);
  const refresh = useRefreshBilling(tenantId);
  const { openCheckout, loading: opening } = usePaddleCheckout();

  const [cycle, setCycle] = useState<BillingCycle>("month");
  const [pending, setPending] = useState<string | null>(null);
  /** voltou do checkout e ainda aguarda a confirmação do provedor */
  const [awaiting, setAwaiting] = useState(false);

  const subscription = useBillingSubscription(tenantId, awaiting ? 4000 : 0);
  const current = subscription.data ?? null;
  const currentCode = planCodeFromPriceId(current?.paddle_price_id ?? null);
  const currentCycle = priceIdCycle(current?.paddle_price_id ?? null);
  const statusInfo = current ? (BILLING_STATUS[current.status] ?? null) : null;

  // Retorno do checkout: ?checkout=success — confirma via webhook, então esperamos a linha.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;
    setAwaiting(true);
    refresh();
    const stop = window.setTimeout(() => setAwaiting(false), 90_000);
    return () => window.clearTimeout(stop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!awaiting) return;
    if (current?.paddle_subscription_id && current.status !== "canceled") {
      setAwaiting(false);
      refresh();
      toast.success("Assinatura confirmada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaiting, current?.paddle_subscription_id, current?.status]);

  const successUrl = useMemo(
    () => `${window.location.origin}/t/${tenantId}/plans?checkout=success`,
    [tenantId],
  );

  async function subscribe(priceId: string) {
    if (!profile.data) return;
    setPending(priceId);
    try {
      await openCheckout({
        priceId,
        customerEmail: profile.data.email ?? undefined,
        customData: { userId: profile.data.userId, tenantId },
        successUrl,
      });
    } catch (err) {
      toast.error(authErrorMessage(err));
    } finally {
      setPending(null);
    }
  }

  const allowed = canManage.data === true;

  return (
    <div className="space-y-5">
      <Rise index={1}>
        <Panel
          title="Status da assinatura"
          icon={ShieldCheck}
          help={
            <>
              <p>
                A confirmação vem do provedor de pagamento por webhook: assim que ele confirma o
                pagamento, o plano e os limites desta organização são atualizados sozinhos.
              </p>
              <p>
                <strong>Cancelada com data futura</strong> significa que o acesso continua até o fim
                do período já pago.
              </p>
            </>
          }
          actions={<PaymentTestBadge />}
        >
          {subscription.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : awaiting ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
              Confirmando o pagamento com o provedor…
            </div>
          ) : current ? (
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Situação">
                <Badge
                  variant="outline"
                  className={TONE_CLASS[statusInfo?.tone ?? "neutral"] ?? TONE_CLASS["neutral"]}
                >
                  {statusInfo?.label ?? current.status}
                </Badge>
              </Field>
              <Field label="Plano">
                <span className="text-sm font-medium text-foreground capitalize">
                  {currentCode ?? "manual"}
                  {currentCycle ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      {cycleLabel(currentCycle)}
                    </span>
                  ) : null}
                </span>
              </Field>
              <Field label="Período atual">
                <span className="font-mono text-xs text-foreground">
                  {formatDate(current.current_period_start)} →{" "}
                  {formatDate(current.current_period_end)}
                </span>
              </Field>
              <Field label="Renovação">
                <span className="text-xs text-foreground">
                  {current.cancel_at_period_end ? "cancelamento agendado" : "automática"}
                </span>
              </Field>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma assinatura paga nesta empresa.</p>
          )}

          {current?.paddle_customer_id && allowed ? (
            <div className="mt-4 border-t border-border/60 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={portal.isPending}
                onClick={() => {
                  portal.mutate(undefined, {
                    onError: (err) => toast.error(authErrorMessage(err)),
                  });
                }}
              >
                {portal.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <ExternalLink className="mr-2 size-4" />
                )}
                Gerenciar assinatura
              </Button>
            </div>
          ) : null}
        </Panel>
      </Rise>

      <Rise index={2}>
        <Panel
          title="Escolha do plano"
          icon={CreditCard}
          help={
            <>
              <p>
                O valor cobrado é sempre o do provedor de pagamento, em reais, com imposto calculado
                por ele no checkout.
              </p>
              <p>
                Trocar de plano no meio do ciclo gera crédito ou cobrança proporcional automática.
              </p>
            </>
          }
          actions={
            <Segmented
              label="Ciclo de cobrança"
              value={cycle}
              onChange={setCycle}
              options={[
                { value: "month", label: "Mensal" },
                { value: "year", label: "Anual" },
              ]}
            />
          }
        >
          <div className="grid gap-3 md:grid-cols-3">
            {BILLING_CATALOG.map((plan) => {
              const priceId = plan.priceId[cycle];
              const isCurrent = currentCode === plan.code && currentCycle === cycle;
              const busy = pending === priceId || opening;
              return (
                <article
                  key={plan.code}
                  className={
                    "panel panel-hover flex flex-col gap-3 p-4" +
                    (isCurrent ? " ring-1 ring-primary/60" : "")
                  }
                >
                  <header className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{plan.name}</h3>
                    {isCurrent ? (
                      <Badge variant="outline" className={TONE_CLASS["ok"]}>
                        atual
                      </Badge>
                    ) : null}
                  </header>
                  <p className="font-mono text-lg text-foreground">
                    {formatCents(plan.price[cycle])}
                    <span className="ml-1 text-[11px] text-muted-foreground">
                      {cycleLabel(cycle)}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">{plan.resumo}</p>
                  <ul className="space-y-1.5">
                    {plan.itens.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-xs text-foreground">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="mt-auto"
                    size="sm"
                    variant={isCurrent ? "outline" : "default"}
                    disabled={!allowed || busy || isCurrent || !profile.data}
                    onClick={() => void subscribe(priceId)}
                  >
                    {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                    {isCurrent ? "Plano atual" : current ? "Trocar para este" : "Assinar"}
                  </Button>
                </article>
              );
            })}
          </div>
          {!allowed && canManage.isFetched ? (
            <p className="mt-3 text-xs text-warn">
              Seu papel não permite contratar nesta organização.
            </p>
          ) : null}
        </Panel>
      </Rise>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
        {label}
      </p>
      {children}
    </div>
  );
}
