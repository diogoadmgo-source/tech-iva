import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type { AlertItem, AlertSeverity } from "@/components/techiva/alerts";
import { supabase } from "@/integrations/supabase/client";

/** Bloco 3.10 — central de alertas e preferências de notificação. */

export type AlertStatusFilter = "open" | "resolved" | "all";

export type AlertRow = AlertItem & {
  payload: Record<string, unknown> | null;
  resolved_by: string | null;
};

export const ALERT_KIND_LABELS: Record<string, string> = {
  gap_over_limit: "Buraco de caixa acima do limite",
  ingest_failed: "Falha na leitura de notas",
  option_window: "Janela de opção de regime",
  credit_lost: "Crédito perdido na cadeia",
  price_below_floor: "Preço abaixo do piso",
  offer_available: "Oferta de crédito disponível",
  inconsistent_item: "Item de nota com classificação inconsistente",
  credential_expiring: "Credencial perto de vencer",
  regime_changed: "Regime da contraparte mudou",
};

export function alertKindLabel(kind: string) {
  return ALERT_KIND_LABELS[kind] ?? kind;
}

export type AlertPrefs = {
  email_kinds: string[];
  gap_critical_cents: number;
  digest_enabled: boolean;
  digest_weekday: number;
};

export const WEEKDAYS = [
  { value: 1, label: "Segunda" },
  { value: 2, label: "Terça" },
  { value: 3, label: "Quarta" },
  { value: 4, label: "Quinta" },
  { value: 5, label: "Sexta" },
] as const;

export const ALERT_KINDS_FOR_EMAIL = [
  "gap_over_limit",
  "ingest_failed",
  "option_window",
  "credit_lost",
  "price_below_floor",
  "offer_available",
] as const;

/** Lista completa da central, com filtros de severidade/tipo/status. */
export function useAlertCenter(
  tenantId: string,
  filters: { status: AlertStatusFilter; severity?: AlertSeverity | "all"; kind?: string | "all" },
) {
  const queryClient = useQueryClient();
  const key = ["alert-center", tenantId, filters.status, filters.severity ?? "all", filters.kind ?? "all"] as const;

  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<AlertRow[]> => {
      let q = supabase
        .from("alerts")
        .select("id, kind, severity, title, payload, created_at, read_at, resolved_at, resolved_by")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(300);

      if (filters.status === "open") q = q.is("resolved_at", null);
      if (filters.status === "resolved") q = q.not("resolved_at", "is", null);
      if (filters.severity && filters.severity !== "all") q = q.eq("severity", filters.severity);
      if (filters.kind && filters.kind !== "all") q = q.eq("kind", filters.kind);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((a) => ({
        id: a.id,
        kind: a.kind,
        severity: a.severity as AlertSeverity,
        title: a.title,
        payload: (a.payload as Record<string, unknown> | null) ?? null,
        created_at: a.created_at ?? new Date().toISOString(),
        read_at: a.read_at,
        resolved_at: a.resolved_at,
        resolved_by: a.resolved_by ?? null,
      }));
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel(`alert-center-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts", filter: `tenant_id=eq.${tenantId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["alert-center", tenantId] });
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

export function useAlertPrefs(tenantId: string) {
  return useQuery({
    queryKey: ["alert-prefs", tenantId],
    queryFn: async (): Promise<AlertPrefs> => {
      const { data, error } = await supabase.rpc("get_alert_prefs", { p_tenant: tenantId });
      if (error) throw error;
      const raw = (data ?? {}) as Partial<AlertPrefs>;
      return {
        email_kinds: Array.isArray(raw.email_kinds) ? raw.email_kinds : [],
        gap_critical_cents: Number(raw.gap_critical_cents ?? 0),
        digest_enabled: Boolean(raw.digest_enabled),
        digest_weekday: Number(raw.digest_weekday ?? 1),
      };
    },
  });
}

export function useSetAlertPrefs(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (prefs: Partial<AlertPrefs>) => {
      const { data, error } = await supabase.rpc("set_alert_prefs", {
        p_tenant: tenantId,
        p_prefs: prefs as never,
      });
      if (error) throw error;
      return data as unknown as AlertPrefs;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alert-prefs", tenantId] }),
  });
}
