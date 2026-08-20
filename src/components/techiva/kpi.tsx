import type { ReactNode } from "react";

import { Panel } from "@/components/techiva/page";
import { MoneyText } from "@/components/techiva/money";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Indicador padrão do produto: usa o Panel do sistema (não o Card do shadcn)
 * e o MoneyText para qualquer valor monetário.
 */
export function Kpi({
  label,
  valueCents,
  value,
  hint,
  help,
  loading,
  interactive = true,
  className,
}: {
  label: string;
  valueCents?: number | undefined;
  value?: ReactNode | undefined;
  hint?: string | undefined;
  help?: ReactNode | undefined;
  loading?: boolean | undefined;
  interactive?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <Panel
      title={label}
      help={help}
      interactive={interactive}
      className={className}
      bodyClassName="p-4"
    >
      {loading ? (
        <Skeleton className="h-7 w-32" />
      ) : (
        <p className={cn("text-xl font-semibold tracking-[-0.01em]")}>
          {valueCents !== undefined ? <MoneyText cents={valueCents} /> : value}
        </p>
      )}
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </Panel>
  );
}
