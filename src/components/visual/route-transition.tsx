import { useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * Transição de página do sistema: a cada mudança de rota o conteúdo entra
 * com fade + subida curta. A `key` no pathname força a reanimação.
 * O CSS respeita prefers-reduced-motion.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div key={pathname} className="route-enter">
      {children}
    </div>
  );
}
