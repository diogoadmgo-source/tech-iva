import { AlertTriangle, Info } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { useNotices, type Notice } from "@/lib/notices";

/** Corpo do aviso: texto vem do banco, respeitando quebras de linha e passos. */
export function NoticeBody({ body, className = "" }: { body: string; className?: string }) {
  return (
    <div className={`space-y-1 whitespace-pre-line text-xs text-muted-foreground ${className}`}>
      {body}
    </div>
  );
}

function NoticeCard({ notice }: { notice: Notice }) {
  const warning = notice.severity === "warning" || notice.severity === "critical";
  return (
    <section
      className={
        warning
          ? "rounded-xl border border-amber-400/40 bg-amber-400/10 p-4"
          : "rounded-xl border border-border bg-surface-1 p-4"
      }
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        {warning ? (
          <AlertTriangle className="size-4 shrink-0 text-amber-400" aria-hidden />
        ) : (
          <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        {notice.title}
      </p>
      <NoticeBody body={notice.body} className="mt-1" />
    </section>
  );
}

/**
 * Renderiza os avisos ativos de um escopo (notices_for). Warning em destaque,
 * info discreto. Nenhum texto é hardcoded aqui.
 */
export function NoticeBoard({ scope, className = "" }: { scope: string; className?: string }) {
  const notices = useNotices(scope);

  if (notices.isLoading) return <Skeleton className={`h-16 w-full ${className}`} />;
  if (notices.isError || (notices.data?.length ?? 0) === 0) return null;

  return (
    <div className={`space-y-3 ${className}`}>
      {notices.data?.map((n) => (
        <NoticeCard key={n.key} notice={n} />
      ))}
    </div>
  );
}
