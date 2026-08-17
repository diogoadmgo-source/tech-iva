import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="auth-backdrop flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className={wide ? "w-full max-w-2xl" : "w-full max-w-md"}>
        <div className="mb-8 flex justify-center">
          <Link to="/" aria-label="TECH-IVA — início">
            <BrandLogo className="h-9 w-auto" />
          </Link>
        </div>


        <section className="rounded-xl border border-border bg-surface p-8 shadow-[0_24px_60px_-30px_oklch(0_0_0/0.9)]">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          {subtitle ? (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
          ) : null}
          <div className="mt-6">{children}</div>
        </section>

        {footer ? (
          <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>
        ) : null}
      </div>
    </main>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground"
    >
      {message}
    </p>
  );
}

export function FormSuccess({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-foreground">
      {message}
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
