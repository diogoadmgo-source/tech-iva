import { HelpCircle } from "lucide-react";
import type { ReactNode } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Micro balão de ajuda: o texto explicativo sai da tela e entra aqui.
 * Padrão único do produto — nunca escrever parágrafos de instrução na página.
 */
export function InfoHint({
  title,
  children,
  className,
  label = "O que é isto?",
}: {
  title?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
  label?: string | undefined;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "focus-glow inline-grid size-5 shrink-0 place-items-center rounded-full border border-border/70 bg-surface-2/70 text-muted-foreground transition-all duration-200 hover:scale-110 hover:border-primary/50 hover:text-primary",
            className,
          )}
        >
          <HelpCircle className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="panel w-[min(22rem,calc(100vw-2rem))] border-border/70 p-4 text-xs leading-relaxed text-muted-foreground"
      >
        {title ? (
          <p className="mb-1.5 text-[11px] font-semibold tracking-[0.12em] text-primary uppercase">
            {title}
          </p>
        ) : null}
        <div className="space-y-2 [&_strong]:text-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
