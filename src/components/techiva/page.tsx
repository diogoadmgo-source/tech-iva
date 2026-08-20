import type { ElementType, ReactNode } from "react";

import { InfoHint } from "@/components/techiva/info-hint";
import { cn } from "@/lib/utils";

/**
 * Primitivos de página do TECH-IVA. Toda tela usa estes blocos — é o que
 * garante que um botão, um cartão e um título sejam iguais em qualquer lugar.
 */

/** Container padrão de uma tela. */
export function Page({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cn("mx-auto max-w-6xl space-y-5 pb-4", className)}>{children}</div>
  );
}

/** Entrada em cascata: envolve cada bloco da página. */
export function Rise({
  index = 0,
  as: Tag = "div",
  className,
  children,
}: {
  index?: number | undefined;
  as?: ElementType | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <Tag className={cn("rise", className)} style={{ ["--rise-i" as string]: index }}>
      {children}
    </Tag>
  );
}

/** Cabeçalho de tela: título, balão de ajuda e ações à direita. */
export function PageHeader({
  eyebrow,
  title,
  help,
  helpTitle,
  actions,
}: {
  eyebrow?: string | undefined;
  title: string;
  /** Explicação da tela — vive no balão "?", não na página. */
  help?: ReactNode | undefined;
  helpTitle?: string | undefined;
  actions?: ReactNode | undefined;
}) {
  return (
    <Rise className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="font-display text-[10px] tracking-[0.28em] text-primary uppercase">
            {eyebrow}
          </p>
        ) : null}
        <div className="mt-1 flex items-center gap-2">
          <h1 className="truncate text-xl font-semibold tracking-[-0.01em] text-foreground sm:text-2xl">
            {title}
          </h1>
          {help ? <InfoHint title={helpTitle ?? title}>{help}</InfoHint> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </Rise>
  );
}

/** Painel padrão: profundidade, hover discreto e cabeçalho opcional com "?". */
export function Panel({
  title,
  icon: Icon,
  help,
  actions,
  children,
  className,
  bodyClassName,
  interactive = false,
}: {
  title?: string | undefined;
  icon?: ElementType | undefined;
  help?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
  bodyClassName?: string | undefined;
  interactive?: boolean | undefined;
}) {
  return (
    <section className={cn("panel sheen", interactive && "panel-hover", className)}>
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {Icon ? <Icon className="size-4 shrink-0 text-primary" aria-hidden /> : null}
            <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
            {help ? <InfoHint title={title}>{help}</InfoHint> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Controle segmentado único do produto (horizontes, abas curtas, etc.). */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-lg border border-border/70 bg-surface-2/60 p-1 shadow-[0_1px_0_0_oklch(1_0_0_/_5%)_inset]"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "focus-glow rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200",
              active
                ? "bg-primary text-primary-foreground shadow-[0_6px_16px_-10px_oklch(0.55_0.22_264_/_90%)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
