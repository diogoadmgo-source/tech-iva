import { Bell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertItem = {
  id: string;
  kind: string;
  severity: AlertSeverity;
  title: string;
  created_at: string;
  read_at?: string | null | undefined;
  resolved_at?: string | null | undefined;
};

const SEVERITY: Record<AlertSeverity, { label: string; className: string }> = {
  info: { label: "Info", className: "border-border text-muted-foreground" },
  warning: { label: "Atenção", className: "border-warn/40 bg-warn/10 text-warn" },
  critical: { label: "Crítico", className: "border-destructive/40 bg-destructive/10 text-destructive" },
};

function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}

export function AlertList({
  alerts,
  onOpen,
  onResolve,
}: {
  alerts: AlertItem[];
  onOpen?: ((alert: AlertItem) => void) | undefined;
  onResolve?: ((alert: AlertItem) => void) | undefined;
}) {
  if (alerts.length === 0) {
    return <EmptyState title="Nenhum alerta" hint="Você será avisado quando algo exigir atenção." />;
  }
  const groups = alerts.reduce<Record<string, AlertItem[]>>((acc, a) => {
    const k = dayKey(a.created_at);
    (acc[k] ||= []).push(a);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {Object.entries(groups).map(([day, items]) => (
        <section key={day}>
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">{day}</h4>
          <ul className="space-y-2">
            {items.map((a) => (
              <li
                key={a.id}
                className={cn(
                  "rounded-lg border border-border bg-surface-1 p-3",
                  !a.read_at && "border-l-2 border-l-primary",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className="text-left text-sm font-medium hover:underline"
                    onClick={() => onOpen?.(a)}
                  >
                    {a.title}
                  </button>
                  <Badge variant="outline" className={SEVERITY[a.severity].className}>
                    {SEVERITY[a.severity].label}
                  </Badge>
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="font-mono tabular">{a.kind}</span>
                  {!a.resolved_at && onResolve && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => onResolve(a)}>
                      Resolver
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function AlertBell({
  alerts,
  onOpen,
  onResolve,
}: {
  alerts: AlertItem[];
  onOpen?: ((alert: AlertItem) => void) | undefined;
  onResolve?: ((alert: AlertItem) => void) | undefined;
}) {
  const unread = alerts.filter((a) => !a.read_at && !a.resolved_at).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={`Alertas (${unread} não lidos)`}>
          <span className="relative">
            <Bell className="size-4" aria-hidden />
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 bg-surface-1 p-3">
        <AlertList alerts={alerts.slice(0, 8)} onOpen={onOpen} onResolve={onResolve} />
      </PopoverContent>
    </Popover>
  );
}
