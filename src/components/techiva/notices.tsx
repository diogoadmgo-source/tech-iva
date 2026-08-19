import { AlertTriangle, Info } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotices, type Notice } from "@/lib/notices";
import { cn } from "@/lib/utils";

/** Corpo do aviso: texto vem do banco, respeitando quebras de linha e passos. */
export function NoticeBody({ body, className = "" }: { body: string; className?: string }) {
  return (
    <div className={`space-y-1 whitespace-pre-line text-xs text-muted-foreground ${className}`}>
      {body}
    </div>
  );
}

/**
 * Chip de aviso: na tela aparece só o título; o texto inteiro fica no balão.
 * Nenhum parágrafo de aviso ocupa a página.
 */
function NoticeChip({ notice, highlight = false }: { notice: Notice; highlight?: boolean }) {
  const warning = notice.severity === "warning" || notice.severity === "critical" || highlight;
  const Icon = warning ? AlertTriangle : Info;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "focus-glow inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-left text-xs font-medium transition-all duration-200 hover:-translate-y-px",
            warning
              ? "border-amber-400/40 bg-amber-400/10 text-amber-200 hover:border-amber-400/70"
              : "border-border/70 bg-surface-2/60 text-muted-foreground hover:border-primary/50 hover:text-foreground",
          )}
        >
          <Icon
            className={cn("size-3.5 shrink-0", warning ? "text-amber-400" : "text-muted-foreground")}
            aria-hidden
          />
          <span className="truncate">{notice.title}</span>
          <span
            aria-hidden
            className="grid size-4 shrink-0 place-items-center rounded-full border border-current/40 text-[9px] leading-none opacity-70"
          >
            ?
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="panel w-[min(24rem,calc(100vw-2rem))] border-border/70 p-4"
      >
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] uppercase">
          <Icon className={cn("size-3.5", warning ? "text-amber-400" : "text-primary")} aria-hidden />
          <span className={warning ? "text-amber-300" : "text-primary"}>{notice.title}</span>
        </p>
        <NoticeBody body={notice.body} className="leading-relaxed" />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Avisos ativos de um escopo (notices_for) em uma única linha de chips.
 * Warning ganha cor de atenção e vem primeiro. Nenhum texto é hardcoded aqui.
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

  if (notices.isLoading) return <Skeleton className={`h-8 w-64 ${className}`} />;
  if (notices.isError || (notices.data?.length ?? 0) === 0) return null;

  const isHighlighted = (key: string) => highlightKeys.includes(key);
  const ordered = [...(notices.data ?? [])].sort(
    (a, b) => Number(isHighlighted(b.key)) - Number(isHighlighted(a.key)),
  );

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {ordered.map((n) => (
        <NoticeChip key={n.key} notice={n} highlight={isHighlighted(n.key)} />
      ))}
    </div>
  );
}
