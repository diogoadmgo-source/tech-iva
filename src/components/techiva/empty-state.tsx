import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  hint,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-1/60 px-6 py-12 text-center",
        className,
      )}
    >
      <Icon className="size-5 text-muted-foreground" aria-hidden />
      <p className="mt-3 text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-muted-foreground">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Não foi possível carregar",
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm",
        className,
      )}
    >
      <p className="font-medium text-destructive">{title}</p>
      {message && <p className="mt-1 text-xs text-muted-foreground">{message}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-surface-2"
        >
          Tentar de novo
        </button>
      )}
    </div>
  );
}

export function NoPermissionState({ hint }: { hint?: string }) {
  return (
    <EmptyState
      title="Sem permissão"
      hint={hint ?? "Seu papel neste tenant não permite acessar esta área. Fale com um administrador."}
    />
  );
}
