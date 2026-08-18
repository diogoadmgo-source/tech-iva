import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BellRing, Check, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { AlertList, type AlertSeverity } from "@/components/techiva/alerts";
import { ErrorState } from "@/components/techiva/empty-state";
import { KpiCard } from "@/components/techiva/metrics";
import { MoneyText } from "@/components/techiva/money";
import { SideSheet } from "@/components/techiva/side-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAckAlert, useResolveAlert } from "@/lib/cash";
import {
  ALERT_KINDS_FOR_EMAIL,
  WEEKDAYS,
  alertKindLabel,
  useAlertCenter,
  useAlertPrefs,
  useSetAlertPrefs,
  type AlertRow,
  type AlertStatusFilter,
} from "@/lib/alerts";
import { InconsistentItemValidation } from "@/components/techiva/alert-inconsistency";
import { Pager } from "@/components/techiva/pager";
import { DEFAULT_PAGE_SIZE } from "@/lib/paginate";
import { useShellData } from "@/lib/tenant-shell-data";
import { useFeature } from "@/lib/features";

const ADMIN_ROLES = ["platform_admin", "channel_admin", "owner"];

export const Route = createFileRoute("/_authenticated/t/$tenantId/alerts")({
  head: () => ({
    meta: [
      { title: "Central de alertas — TECH-IVA" },
      {
        name: "description",
        content:
          "Acompanhe alertas de caixa, leitura fiscal e janelas de regime, resolva com histórico e configure o resumo semanal.",
      },
      { property: "og:title", content: "Central de alertas — TECH-IVA" },
      {
        property: "og:description",
        content: "Alertas em tempo real com preferências de e-mail e resumo semanal por organização.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AlertsPage,
});

function AlertsPage() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const canAdmin = ADMIN_ROLES.includes(shell.data?.role ?? "");

  const [status, setStatus] = useState<AlertStatusFilter>("open");
  const [severity, setSeverity] = useState<AlertSeverity | "all">("all");
  const [kind, setKind] = useState<string>("all");
  const [detail, setDetail] = useState<AlertRow | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const alerts = useAlertCenter(tenantId, { status, severity, kind }, page, pageSize);
  // Módulo de crédito desligado: nada de "oferta de crédito disponível".
  const credit = useFeature(tenantId, "credit");
  const alertKinds = ALERT_KINDS_FOR_EMAIL.filter(
    (k) => k !== "offer_available" || credit.enabled,
  );
  const ack = useAckAlert(tenantId);
  const resolve = useResolveAlert(tenantId);
  const prefs = useAlertPrefs(tenantId);
  const savePrefs = useSetAlertPrefs(tenantId);

  const rows: AlertRow[] = (alerts.data?.rows ?? []).filter(
    (a) => a.kind !== "offer_available" || credit.enabled,
  );
  // contagem exibida = contagem exata do servidor (não o tamanho da página)
  const total = alerts.data?.total ?? 0;
  const critical = rows.filter((a) => a.severity === "critical" && !a.resolved_at).length;
  const unread = rows.filter((a) => !a.read_at && !a.resolved_at).length;

  if (alerts.isError) {
    return <ErrorState message={(alerts.error as Error).message} onRetry={() => void alerts.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Central de alertas</h1>
          <p className="text-sm text-muted-foreground">
            Atualiza em tempo real. Resolver registra autor e nota na auditoria.
          </p>
        </div>
        <Button type="button" variant="outline" className="gap-2" onClick={() => setPrefsOpen(true)}>
          <Settings2 className="size-4" aria-hidden />
          Preferências
        </Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Alertas listados" value={String(rows.length)} loading={alerts.isLoading} />
        <KpiCard label="Não lidos" value={String(unread)} loading={alerts.isLoading} />
        <KpiCard label="Críticos abertos" value={String(critical)} loading={alerts.isLoading} />
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface-1 p-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Situação</Label>
          <Select value={status} onValueChange={(v) => { setPage(0); setStatus(v as AlertStatusFilter); }}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Abertos</SelectItem>
              <SelectItem value="resolved">Resolvidos</SelectItem>
              <SelectItem value="all">Todos</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Severidade</Label>
          <Select value={severity} onValueChange={(v) => { setPage(0); setSeverity(v as AlertSeverity | "all"); }}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="critical">Crítico</SelectItem>
              <SelectItem value="warning">Atenção</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Tipo</Label>
          <Select value={kind} onValueChange={(v) => { setPage(0); setKind(v); }}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              {alertKinds.map((k) => (
                <SelectItem key={k} value={k}>
                  {alertKindLabel(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <AlertList
        alerts={rows}
        onOpen={(a) => {
          const row = rows.find((r) => r.id === a.id) ?? null;
          setDetail(row);
          if (row && !row.read_at) ack.mutate(row.id);
        }}
        onResolve={(a) =>
          resolve.mutate(
            { alertId: a.id },
            {
              onSuccess: () => toast.success("Alerta resolvido."),
              onError: (error) => toast.error((error as Error).message),
            },
          )
        }
      />

      <Pager
        page={page}
        pageSize={pageSize}
        total={total}
        loading={alerts.isFetching}
        unit="alerta(s) no filtro"
        onPageChange={setPage}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(0);
        }}
        className="rounded-xl border border-border bg-surface-1"
      />

      <SideSheet
        open={Boolean(detail)}
        onOpenChange={(open) => !open && setDetail(null)}
        title={detail?.title ?? "Alerta"}
        description={detail ? alertKindLabel(detail.kind) : undefined}
        footer={
          detail && !detail.resolved_at ? (
            <Button
              type="button"
              className="w-full gap-2"
              disabled={resolve.isPending}
              onClick={() =>
                resolve.mutate(
                  { alertId: detail.id, note: "Resolvido na central de alertas." },
                  {
                    onSuccess: () => {
                      toast.success("Alerta resolvido.");
                      setDetail(null);
                    },
                    onError: (error) => toast.error((error as Error).message),
                  },
                )
              }
            >
              <Check className="size-4" aria-hidden />
              Marcar como resolvido
            </Button>
          ) : undefined
        }
      >
        {detail && (
          <div className="space-y-4 text-sm">
            <Badge variant="outline" className="font-mono text-xs">
              {detail.severity}
            </Badge>
            {detail.kind === "inconsistent_item" && (
              <InconsistentItemValidation payload={detail.payload} />
            )}
            {typeof detail.payload?.["amount_cents"] === "number" && (
              <p>
                Valor envolvido: <MoneyText cents={detail.payload["amount_cents"] as number} />
              </p>
            )}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Dados do alerta</p>
              <pre className="overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs">
                {JSON.stringify(detail.payload ?? {}, null, 2)}
              </pre>
            </div>
            <p className="text-xs text-muted-foreground">
              Criado em {new Date(detail.created_at).toLocaleString("pt-BR")}
              {detail.resolved_at ? ` · resolvido em ${new Date(detail.resolved_at).toLocaleString("pt-BR")}` : ""}
            </p>
          </div>
        )}
      </SideSheet>

      <SideSheet
        open={prefsOpen}
        onOpenChange={setPrefsOpen}
        title="Preferências de alerta"
        description={canAdmin ? "Valem para toda a organização." : "Somente leitura: apenas administradores alteram."}
      >
        {prefs.data && (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label className="text-xs">Alertas enviados por e-mail</Label>
              {alertKinds.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={prefs.data.email_kinds.includes(k)}
                    disabled={!canAdmin || savePrefs.isPending}
                    onCheckedChange={(checked) => {
                      const next = checked
                        ? [...prefs.data.email_kinds, k]
                        : prefs.data.email_kinds.filter((x) => x !== k);
                      savePrefs.mutate(
                        { email_kinds: next },
                        { onError: (error) => toast.error((error as Error).message) },
                      );
                    }}
                  />
                  {alertKindLabel(k)}
                </label>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gap" className="text-xs">
                Buraco de caixa crítico (R$)
              </Label>
              <Input
                id="gap"
                type="number"
                min={0}
                step={100}
                disabled={!canAdmin}
                defaultValue={prefs.data.gap_critical_cents / 100}
                onBlur={(e) => {
                  const cents = Math.round(Number(e.target.value) * 100);
                  if (!Number.isFinite(cents) || cents === prefs.data.gap_critical_cents) return;
                  savePrefs.mutate(
                    { gap_critical_cents: cents },
                    {
                      onSuccess: () => toast.success("Limite atualizado."),
                      onError: (error) => toast.error((error as Error).message),
                    },
                  );
                }}
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 p-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <BellRing className="size-4" aria-hidden />
                  Resumo semanal por e-mail
                </p>
                <p className="text-xs text-muted-foreground">Enviado ao responsável e ao financeiro.</p>
              </div>
              <Switch
                checked={prefs.data.digest_enabled}
                disabled={!canAdmin}
                onCheckedChange={(checked) =>
                  savePrefs.mutate(
                    { digest_enabled: checked },
                    { onError: (error) => toast.error((error as Error).message) },
                  )
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Dia do envio</Label>
              <Select
                value={String(prefs.data.digest_weekday)}
                disabled={!canAdmin}
                onValueChange={(v) =>
                  savePrefs.mutate(
                    { digest_weekday: Number(v) },
                    { onError: (error) => toast.error((error as Error).message) },
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((d) => (
                    <SelectItem key={d.value} value={String(d.value)}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </SideSheet>
    </div>
  );
}
