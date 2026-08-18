import { useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Superfície com brilho suave que acompanha o cursor.
 * Escreve apenas variáveis CSS (--mx/--my) — nada de re-render.
 */
export function SpotlightCard({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "article" | "section";
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  return (
    <Tag
      ref={ref as never}
      className={cn("spotlight", className)}
      onPointerMove={(event: React.PointerEvent<HTMLElement>) => {
        const node = ref.current;
        if (!node) return;
        const rect = node.getBoundingClientRect();
        node.style.setProperty("--mx", `${event.clientX - rect.left}px`);
        node.style.setProperty("--my", `${event.clientY - rect.top}px`);
      }}
    >
      {children}
    </Tag>
  );
}
