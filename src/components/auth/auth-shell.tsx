import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/marketing/reveal";
import { cn } from "@/lib/utils";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  wide = false,
  aside,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Bloco discreto de prova exibido à direita em telas grandes. */
  aside?: ReactNode;
}) {
  return (
    <main className="ambient flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div
        className={cn(
          "grid w-full gap-12",
          aside ? "max-w-5xl lg:grid-cols-[minmax(0,26rem)_1fr]" : wide ? "max-w-2xl" : "max-w-md",
        )}
      >
        <div className="w-full">
          <Reveal className="mb-8 flex justify-center lg:justify-start">
            <Link to="/" aria-label="TECH-IVA — início" className="focus-glow rounded-md">
              <BrandLogo className="h-9 w-auto" />
            </Link>
          </Reveal>

          <Reveal index={1}>
            <div className="lit-halo">
              <section className="surface-lit lit-sheen overflow-hidden rounded-2xl p-8">
                <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
                  {title}
                </h1>
                {subtitle ? (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
                ) : null}
                <div className="mt-6">{children}</div>
              </section>
            </div>
          </Reveal>



          {footer ? (
            <Reveal
              index={2}
              className="mt-6 text-center text-sm text-muted-foreground lg:text-left"
            >
              {footer}
            </Reveal>
          ) : null}
        </div>

        {aside ? (
          <Reveal index={2} className="hidden lg:flex lg:items-center">
            {aside}
          </Reveal>
        ) : null}
      </div>
    </main>
  );
}

/** Bloco de prova do produto ao lado do formulário (desktop). */
export function AuthProof({
  label,
  title,
  body,
  icon: Icon,
}: {
  label: string;
  title: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="max-w-sm">
      <div className="hairline" />
      <Icon className="mt-8 size-5 text-primary" />
      <p className="mt-4 font-mono text-[10px] tracking-[0.28em] text-primary uppercase">{label}</p>
      <h2 className="mt-2 text-lg font-medium tracking-[-0.01em] text-foreground">{title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

/** Segmentado com indicador deslizante (Senha / Link mágico). */
export function AuthSegmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <div
      role="tablist"
      className="relative grid rounded-lg border border-border bg-secondary/50 p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 rounded-md bg-surface-2 shadow-e1 transition-transform duration-200 ease-out"
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "focus-glow relative z-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            option.value === value
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Botão de envio com spinner interno e desabilitado durante a requisição. */
export function SubmitButton({
  loading,
  loadingLabel,
  children,
  variant,
}: {
  loading: boolean;
  loadingLabel: string;
  children: ReactNode;
  variant?: "default" | "secondary";
}) {
  return (
    <Button
      type="submit"
      variant={variant ?? "default"}
      className="focus-glow w-full"
      disabled={loading}
      aria-busy={loading}
    >
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {loadingLabel}
        </span>
      ) : (
        children
      )}
    </Button>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2.5 text-sm text-foreground"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <span>{message}</span>
    </p>
  );
}

export function FormSuccess({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="flex items-start gap-2 rounded-md border border-primary/35 bg-primary/10 px-3 py-2.5 text-sm text-foreground">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <span>{message}</span>
    </p>
  );
}

/** Erro de um campo específico, exibido logo abaixo do input. */
export function FieldError({ message }: { message?: string | null | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  );
}
