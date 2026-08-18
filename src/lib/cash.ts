import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { supabase } from "@/integrations/supabase/client";
import type { AlertItem, AlertSeverity } from "@/components/techiva/alerts";
import type { CashTimelinePoint } from "@/components/techiva/cash-timeline-chart";

export type CashHorizon = 30 | 60 | 90 | 120;
export const CASH_HORIZONS: CashHorizon[] = [30, 60, 90, 120];

export type DashboardCash = {
  hero: {
    gap_30_cents: number;
    gap_60_cents: number;
    gap_90_cents: number;
    trend: number;
  };
  kpis: {
    tax_out_month_cents: number;
    credit_in_month_cents: number;
    credit_backlog_cents: number;
    credit_avg_days: number;
    provision_month_cents: number;
    provision_horizon_cents: number;
  };
  timeline: CashTimelinePoint[];
  next_gap: { week: string; amount_cents: number; offer_available: boolean } | null;
  confidence?: { bank_connected?: boolean; receipt_history?: boolean; score?: number } | undefined;
};

const EMPTY: DashboardCash = {
  hero: { gap_30_cents: 0, gap_60_cents: 0, gap_90_cents: 0, trend: 0 },
  kpis: {
    tax_out_month_cents: 0,
    credit_in_month_cents: 0,
    credit_backlog_cents: 0,
    credit_avg_days: 0,
    provision_month_cents: 0,
    provision_horizon_cents: 0,
  },

  timeline: [],
  next_gap: null,
};

function normalize(raw: unknown): DashboardCash {
  if (!raw || typeof raw !== "object") return EMPTY;
  const r = raw as Partial<DashboardCash>;
  return {
    hero: { ...EMPTY.hero, ...(r.hero ?? {}) },
    kpis: { ...EMPTY.kpis, ...(r.kpis ?? {}) },
    timeline: Array.isArray(r.timeline) ? r.timeline : [],
    next_gap: r.next_gap ?? null,
    confidence: r.confidence,
  };
}

export function cashKey(tenantId: string, horizon: CashHorizon) {
  return ["dashboard-cash", tenantId, horizon] as const;
}

export function useDashboardCash(tenantId: string, horizon: CashHorizon) {
  return useQuery({
    queryKey: cashKey(tenantId, horizon),
    queryFn: async (): Promise<DashboardCash> => {
      const { data, error } = await supabase.rpc("dashboard_cash", {
        p_tenant: tenantId,
        p_horizon_days: horizon,
      });
      if (error) throw error;
      return normalize(data);
    },
    staleTime: 60_000,
  });
}

/** Eventos de caixa de uma semana (drill-down da barra do gráfico). */
export function useWeekEvents(tenantId: string, week: string | null) {
  return useQuery({
    queryKey: ["cash-week", tenantId, week],
    enabled: Boolean(week),
    queryFn: async () => {
      const start = week!;
      const end = new Date(new Date(`${start}T00:00:00Z`).getTime() + 7 * 864e5)
        .toISOString()
        .slice(0, 10);
      const { data, error } = await supabase
        .from("tax_cash_events")
        .select("id, kind, event_date, amount_cents, confidence, ref_invoice_id")
        .eq("tenant_id", tenantId)
        .gte("event_date", start)
        .lt("event_date", end)
        .order("event_date", { ascending: true })
        .order("id", { ascending: true })
        .range(0, 999); // uma semana não passa disso; range explícito e ordenação estável
      if (error) throw error;
      return data;
    },
  });
}

export function useAlerts(tenantId: string, limit = 20) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["alerts", tenantId, limit],
    queryFn: async (): Promise<AlertItem[]> => {
      const { data, error } = await supabase
        .from("alerts")
        .select("id, kind, severity, title, created_at, read_at, resolved_at")
        .eq("tenant_id", tenantId)
        .is("resolved_at", null)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((a) => ({
        id: a.id,
        kind: a.kind,
        severity: a.severity as AlertSeverity,
        title: a.title,
        created_at: a.created_at ?? new Date().toISOString(),
        read_at: a.read_at,
        resolved_at: a.resolved_at,
      }));
    },
  });

  useEffect(() => {
    // nome único por assinante: o sino do shell também escuta alerts deste tenant
    const channel = supabase
      .channel(`alerts-${tenantId}-${Math.random().toString(36).slice(2)}`)

      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts", filter: `tenant_id=eq.${tenantId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["alerts", tenantId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tenantId, queryClient]);

  return query;
}

export function useAckAlert(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase.rpc("ack_alert", { p_alert: alertId });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts", tenantId] }),
  });
}

export function useResolveAlert(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ alertId, note }: { alertId: string; note?: string }) => {
      const { error } = await supabase.rpc("resolve_alert", {
        p_alert: alertId,
        ...(note ? { p_note: note } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts", tenantId] }),
  });
}

/** Revalida o caixa quando um job `project_cash` conclui (Realtime). */
export function useCashAutoRefresh(tenantId: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`cash-jobs-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "jobs", filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          const row = payload.new as { kind?: string; status?: string };
          if (row.status === "done" && (row.kind === "project_cash" || row.kind === "compute_taxes")) {
            void queryClient.invalidateQueries({ queryKey: ["dashboard-cash", tenantId] });
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tenantId, queryClient]);
}
