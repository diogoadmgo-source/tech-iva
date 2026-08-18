import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import iconAsset from "@/assets/techiva-icon.png.asset.json";
import { Toaster } from "@/components/ui/sonner";
import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Falha de carregamento de módulo (deploy/atualização no meio da navegação). */
function isChunkLoadError(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError|Failed to fetch dynamically/i.test(
    message,
  );
}

const RELOAD_KEY = "techiva:chunk-reload";

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const chunk = isChunkLoadError(error);

  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  // Recuperação automática (uma única vez) quando o app foi atualizado durante a navegação.
  useEffect(() => {
    if (!chunk || typeof window === "undefined") return;
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY) ?? "0");
    if (Date.now() - last < 20_000) return;
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    window.location.reload();
  }, [chunk]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {chunk ? "Recarregando a aplicação…" : "Esta tela não carregou"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {chunk
            ? "O app foi atualizado durante a navegação. Estamos recarregando automaticamente."
            : "Algo falhou do nosso lado. Você pode tentar novamente ou voltar ao início."}
        </p>
        {!chunk && error?.message ? (
          <p className="mt-3 break-words font-mono text-xs text-muted-foreground/80">
            {error.message}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Tentar novamente
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Ir para o início
          </a>
        </div>
      </div>
    </div>
  );
}


export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "TECH-IVA — IBS e CBS no seu caixa" },
      { name: "description", content: "Projeção de IBS e CBS no caixa da sua empresa, com cálculo oficial da Receita Federal." },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "TECH-IVA — IBS e CBS no seu caixa" },
      { property: "og:description", content: "Projeção de IBS e CBS no caixa da sua empresa, com cálculo oficial da Receita Federal." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "apple-touch-icon", href: iconAsset.url },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes.
          Sem wrapper com key por rota: remontar a árvore a cada navegação apagava o
          shell (sidebar) e refazia as consultas — era isso que causava a "piscada". */}
      <Outlet />
      <Toaster />
    </QueryClientProvider>
  );
}
