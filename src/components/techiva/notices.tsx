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

function NoticeCard({ notice, highlight = false }: { notice: Notice; highlight?: boolean }) {
  const warning = notice.severity === "warning" || notice.severity === "critical" || highlight;
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
 *
 * `highlightKeys` promove avisos específicos (ex.: conformidade_2026 no
 * validador, split_adiado no caixa) ao tratamento de destaque e os põe no topo,
 * mesmo quando a plataforma os cadastrou como severidade info.
 */
export function NoticeBoard({
  scope,
  className = "",
  highlightKeys = [],
}: {
  scope: string;
  className?: string;
  highlightKeys?: string[];
}) {
  const notices = useNotices(scope);

  if (notices.isLoading) return <Skeleton className={`h-16 w-full ${className}`} />;
  if (notices.isError || (notices.data?.length ?? 0) === 0) return null;

  const isHighlighted = (key: string) => highlightKeys.includes(key);
  const ordered = [...(notices.data ?? [])].sort(
    (a, b) => Number(isHighlighted(b.key)) - Number(isHighlighted(a.key)),
  );

  return (
    <div className={`space-y-3 ${className}`}>
      {ordered.map((n) => (
        <NoticeCard key={n.key} notice={n} highlight={isHighlighted(n.key)} />
      ))}
    </div>
  );
}
