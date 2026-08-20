import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, FileText, History } from "lucide-react";

import { EmptyState } from "@/components/techiva/empty-state";
import { Panel, Rise } from "@/components/techiva/page";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { BILLING_STATUS } from "@/lib/billing";
import { listScopeInvoices } from "@/lib/billing-history.functions";
import { getPaddleEnvironment } from "@/lib/paddle";

type ScopeSubscription = {
  tenant_id: string;
  tenant_name: string;
  tenant_kind: string;
  cnpj: string | null;
  subscription_id: string | null;
  plan_code: string | null;
  plan_name: string | null;
  status: string | null;
  started_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  environment: string | null;
  paddle_subscription_id: string | null;
  price_cents: number | null;
};

type ScopeEvent = {
  event_id: number;
  tenant_id: string;
  tenant_name: string;
  at: string;
  action: string;
  actor_role: string | null;
  status_before: string | null;
  status_after: string | null;
  amount: string | null;
  currency: string | null;
  reference: string | null;
};

const ACTION_LABEL: Record<string, string> = {
  "subscription.created": "Assinatura criada",
  "subscription.updated": "Assinatura atualizada",
  "subscription.canceled": "Assinatura cancelada",
  "subscription.plan_changed": "Troca de plano",
  "subscription.resumed": "Assinatura retomada",
  "payment.completed": "Pagamento aprovado",
  "payment.failed": "Pagamento recusado",
  "subscriptions.insert": "Assinatura registrada",
  "subscriptions.update": "Assinatura alterada",
  "subscriptions.delete": "Assinatura removida",
};

const INVOICE_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "neutral" }> = {
  completed: { label: "Paga", tone: "ok" },
  billed: { label: "Em aberto", tone: "warn" },
  ready: { label: "Em aberto", tone: "warn" },
  draft: { label: "Rascunho", tone: "neutral" },
  past_due: { label: "Em atraso", tone: "bad" },
  canceled: { label: "Cancelada", tone: "bad" },
};

function toneVariant(tone: "ok" | "warn" | "bad" | "neutral") {
  if (tone === "ok") return "secondary" as const;
  if (tone === "bad") return "destructive" as const;
  return "outline" as const;
}

function money(cents: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function dateOnly(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

function useScopeSubscriptions(tenantId: string) {
  return useQuery({
    queryKey: ["billing-scope-subscriptions", tenantId, getPaddleEnvironment()],
    enabled: Boolean(tenantId),
    staleTime: 60_000,
    queryFn: async (): Promise<ScopeSubscription[]> => {
      const { data, error } = await supabase.rpc("billing_subscriptions_scope", {
        p_tenant: tenantId,
      });
      if (error) throw error;
      return (data ?? []) as unknown as ScopeSubscription[];
    },
  });
}

function useScopeEvents(tenantId: string) {
  return useQuery({
    queryKey: ["billing-scope-events", tenantId],
    enabled: Boolean(tenantId),
    staleTime: 30_000,
    queryFn: async (): Promise<ScopeEvent[]> => {
      const { data, error } = await supabase.rpc("billing_events_scope", {
        p_tenant: tenantId,
        p_limit: 200,
      });
      if (error) throw error;
      return (data ?? []) as unknown as ScopeEvent[];
    },
  });
}

function useScopeInvoices(tenantId: string) {
  const fetchInvoices = useServerFn(listScopeInvoices);
  return useQuery({
    queryKey: ["billing-scope-invoices", tenantId, getPaddleEnvironment()],
    enabled: Boolean(tenantId),
    staleTime: 60_000,
    queryFn: () => fetchInvoices({ data: { tenantId } }),
  });
}

export function BillingHistorySection({ tenantId }: { tenantId: string }) {
  const subs = useScopeSubscriptions(tenantId);
  const events = useScopeEvents(tenantId);
  const invoices = useScopeInvoices(tenantId);

  const rows = (subs.data ?? []).filter((r) => r.subscription_id !== null);
  const currentEnv = getPaddleEnvironment();
  const envRows = rows.filter((r) => (r.environment ?? "sandbox") === currentEnv);

  return (
    <div className="space-y-5">
      <Rise index={1}>
        <Panel
          title="Assinatura por empresa"
          icon={History}
          help={
            <p>
              Uma linha por empresa do escopo desta organização, com o plano vigente, o período
              já pago e o valor do plano. Empresas sem assinatura não aparecem aqui.
            </p>
          }
        >
          {subs.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : envRows.length === 0 ? (
            <EmptyState title="Nenhuma empresa deste escopo tem assinatura ainda" />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Plano</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Período vigente</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {envRows.map((row) => {
                    const status = BILLING_STATUS[row.status ?? ""] ?? {
                      label: row.status ?? "—",
                      tone: "neutral" as const,
                    };
                    return (
                      <TableRow key={row.subscription_id ?? row.tenant_id}>
                        <TableCell>
                          <span className="block text-sm text-foreground">{row.tenant_name}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {row.cnpj ?? row.tenant_kind}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">{row.plan_name ?? "—"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge variant={toneVariant(status.tone)}>{status.label}</Badge>
                            {row.cancel_at_period_end ? (
                              <Badge variant="outline">cancela no fim</Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {dateOnly(row.current_period_start ?? row.started_at)} →{" "}
                          {dateOnly(row.current_period_end)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {row.price_cents === null ? "—" : money(row.price_cents)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Panel>
      </Rise>

      <Rise index={2}>
        <Panel
          title="Faturas"
          icon={FileText}
          help={
            <p>
              Faturas emitidas pelo provedor de pagamento para as assinaturas do escopo, com data
              de cobrança, valor cobrado e situação. O PDF e o comprovante ficam no portal de
              cobrança, na aba “Assinar”.
            </p>
          }
        >
          {invoices.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : invoices.data?.indisponivel ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-3 text-sm text-muted-foreground">
              <AlertTriangle className="size-4 text-amber-400" aria-hidden />
              {invoices.data.motivo}
            </div>
          ) : (invoices.data?.invoices ?? []).length === 0 ? (
            <EmptyState title="Nenhuma fatura emitida até agora" />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Fatura</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(invoices.data?.invoices ?? []).map((inv) => {
                    const status = INVOICE_STATUS[inv.status] ?? {
                      label: inv.status,
                      tone: "neutral" as const,
                    };
                    return (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono text-xs">{dateOnly(inv.billedAt)}</TableCell>
                        <TableCell className="text-sm">{inv.tenantName}</TableCell>
                        <TableCell className="font-mono text-[11px] text-muted-foreground">
                          {inv.invoiceNumber ?? inv.id}
                        </TableCell>
                        <TableCell>
                          <Badge variant={toneVariant(status.tone)}>{status.label}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {money(inv.amountCents, inv.currency)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Panel>
      </Rise>

      <Rise index={3}>
        <Panel
          title="Eventos de assinatura"
          icon={History}
          help={
            <p>
              Trilha de auditoria: cada criação, troca de plano, cancelamento, retomada e
              pagamento registrado pelo provedor, com autor e mudança de status.
            </p>
          }
        >
          {events.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (events.data ?? []).length === 0 ? (
            <EmptyState title="Nenhum evento de assinatura registrado" />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Evento</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Autor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(events.data ?? []).map((ev) => (
                    <TableRow key={ev.event_id}>
                      <TableCell className="font-mono text-xs">{dateTime(ev.at)}</TableCell>
                      <TableCell className="text-sm">{ev.tenant_name}</TableCell>
                      <TableCell className="text-sm">
                        {ACTION_LABEL[ev.action] ?? ev.action}
                        {ev.amount ? (
                          <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                            {money(Number(ev.amount) || 0, ev.currency ?? "BRL")}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {ev.status_before && ev.status_before !== ev.status_after
                          ? `${ev.status_before} → ${ev.status_after ?? "—"}`
                          : (ev.status_after ?? "—")}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {ev.actor_role === "payments_webhook"
                          ? "provedor de pagamento"
                          : (ev.actor_role ?? "—")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Panel>
      </Rise>
    </div>
  );
}
