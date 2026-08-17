import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { AlertBell } from "@/components/techiva/alerts";
import { useAckAlert, useAlerts, useResolveAlert } from "@/lib/cash";

/** Sino de alertas do header, ligado ao Realtime da tabela alerts. */
export function ShellAlertBell({ tenantId }: { tenantId: string }) {
  const navigate = useNavigate();
  const alerts = useAlerts(tenantId);
  const ack = useAckAlert(tenantId);
  const resolve = useResolveAlert(tenantId);

  return (
    <AlertBell
      alerts={alerts.data ?? []}
      onOpen={(alert) => {
        if (!alert.read_at) ack.mutate(alert.id);
        void navigate({ to: "/t/$tenantId/alerts", params: { tenantId } });
      }}
      onResolve={(alert) =>
        resolve.mutate(
          { alertId: alert.id },
          {
            onSuccess: () => toast.success("Alerta resolvido."),
            onError: (error) => toast.error((error as Error).message),
          },
        )
      }
    />
  );
}
