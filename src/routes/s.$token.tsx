import { createFileRoute } from "@tanstack/react-router";

import { CalcResultPanel, MotorOficialNote } from "@/components/techiva/simulator";
import { getSharedSimulation } from "@/lib/share.functions";
import type { CalcResult, SimulatorInputs } from "@/lib/simulator";

type SharedRow = {
  nome: string | null;
  inputs: SimulatorInputs;
  results: CalcResult;
  calc_version: string | null;
  created_at: string;
} | null;

export const Route = createFileRoute("/s/$token")({
  loader: async ({ params }) =>
    (await getSharedSimulation({ data: { token: params.token } })) as SharedRow,
  head: () => ({
    meta: [
      { title: "Simulação compartilhada de CBS e IBS — TECH-IVA" },
      {
        name: "description",
        content:
          "Simulação de CBS, IBS e Imposto Seletivo calculada pelo motor oficial da Receita Federal, com memória de cálculo e base legal.",
      },
      { property: "og:title", content: "Simulação compartilhada de CBS e IBS — TECH-IVA" },
      {
        property: "og:description",
        content: "Veja cada tributo separado e a memória de cálculo desta operação.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: () => (
    <Shell>
      <p className="text-sm text-muted-foreground">Não foi possível carregar esta simulação.</p>
    </Shell>
  ),
  notFoundComponent: () => (
    <Shell>
      <p className="text-sm text-muted-foreground">Simulação não encontrada.</p>
    </Shell>
  ),
  component: SharedSimulation,
});

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">{children}</main>;
}

function SharedSimulation() {
  const row = Route.useLoaderData();
  if (!row) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">Simulação não encontrada</h1>
        <p className="text-sm text-muted-foreground">
          O link pode ter expirado ou o compartilhamento foi desfeito.
        </p>
      </Shell>
    );
  }
  return (
    <Shell>
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Simulação compartilhada
        </p>
        <h1 className="text-2xl font-semibold">{row.nome ?? "Simulação"}</h1>
        <p className="text-sm text-muted-foreground">
          CST {row.inputs?.cst ?? "—"} × cClassTrib {row.inputs?.cclasstrib ?? "—"} ·{" "}
          {row.inputs?.uf_origem ?? "—"} → {row.inputs?.uf_destino ?? "—"} ·{" "}
          {new Date(row.created_at).toLocaleDateString("pt-BR")}
        </p>
      </header>
      <CalcResultPanel result={row.results} />
      <MotorOficialNote />
    </Shell>
  );
}
