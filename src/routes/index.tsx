import { createFileRoute, Link } from "@tanstack/react-router";
import { BrandLogo } from "@/components/brand/brand-logo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TECH-IVA — controle multi-tenant para PMEs" },
      {
        name: "description",
        content:
          "TECH-IVA organiza plataforma, canais, empresas e unidades em uma hierarquia única, com isolamento garantido no banco, papéis por escopo e auditoria completa.",
      },
      { property: "og:title", content: "TECH-IVA — controle multi-tenant para PMEs" },
      {
        property: "og:description",
        content:
          "Hierarquia platform > canal > empresa > unidade, isolamento no banco, papéis por escopo e auditoria.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const PILLARS = [
  {
    label: "hierarquia",
    title: "Plataforma, canal, empresa, unidade",
    body: "Cada organização carrega seu caminho completo na árvore. Leitura desce para os descendentes; escrita fica no próprio nível.",
  },
  {
    label: "isolamento",
    title: "Garantido no banco",
    body: "Row Level Security em todas as tabelas e nenhuma política de escrita aberta. O front nunca é a fronteira de segurança.",
  },
  {
    label: "governança",
    title: "MFA e auditoria",
    body: "Papéis de plataforma e admin de canal só operam com verificação em duas etapas. Toda ação sensível vira registro imutável.",
  },
];

function Index() {
  return (
    <main className="auth-backdrop min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-8">
        <BrandLogo className="h-8 w-auto" />
        <nav className="flex items-center gap-6 text-sm">
          <Link to="/login" className="text-muted-foreground transition-colors hover:text-foreground">
            Entrar
          </Link>
          <Link
            to="/signup"
            className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Criar conta
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-5xl px-6 pt-16 pb-24">
        <p className="font-mono text-xs tracking-[0.3em] text-primary uppercase">
          fundação multi-tenant
        </p>
        <h1 className="mt-6 max-w-3xl text-4xl leading-tight font-semibold tracking-tight text-foreground sm:text-5xl">
          Uma hierarquia só, do canal contábil até a filial da empresa.
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground">
          O TECH-IVA modela plataforma, canais, empresas e unidades em uma árvore única e resolve
          escopo, papéis e auditoria diretamente no banco de dados.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            to="/login"
            className="rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Acessar o painel
          </Link>
          <Link
            to="/signup"
            className="rounded-md border border-border px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Criar conta
          </Link>
        </div>

        <div className="mt-20 grid gap-4 sm:grid-cols-3">
          {PILLARS.map((pillar) => (
            <article
              key={pillar.label}
              className="rounded-xl border border-border bg-surface p-6"
            >
              <p className="font-mono text-xs tracking-[0.25em] text-primary uppercase">
                {pillar.label}
              </p>
              <h2 className="mt-3 text-base font-medium text-foreground">{pillar.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{pillar.body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
