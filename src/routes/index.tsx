import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, FileCheck2, Lock, Scale, TrendingDown } from "lucide-react";

import { BrandLogo } from "@/components/brand/brand-logo";
import { CashPreview } from "@/components/marketing/cash-preview";
import { Reveal } from "@/components/marketing/reveal";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TECH-IVA — quanto o IBS e a CBS vão tirar do seu caixa" },
      {
        name: "description",
        content:
          "Lemos as notas fiscais da empresa, calculamos com o motor oficial da Receita Federal e mostramos, semana a semana, quanto vai faltar no caixa antes de 2027.",
      },
      { property: "og:title", content: "TECH-IVA — quanto o IBS e a CBS vão tirar do seu caixa" },
      {
        property: "og:description",
        content:
          "Projeção semanal do imposto que sai e do crédito que volta, com cálculo oficial da Receita e base legal em cada número.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const BENEFITS = [
  {
    icon: TrendingDown,
    label: "caixa",
    title: "Seu caixa, semana a semana",
    body: "A projeção do imposto que sai e do crédito que volta, com a diferença explícita em cada semana — não só um total no fim do mês.",
  },
  {
    icon: Scale,
    label: "prova",
    title: "Cálculo oficial, com base legal",
    body: "Usamos a Calculadora da Receita Federal. Cada número tem memória de cálculo e o artigo da lei por trás dele.",
  },
  {
    icon: Lock,
    label: "sigilo",
    title: "Seus dados não saem daqui",
    body: "O motor roda na nossa infraestrutura, sem telemetria, conforme o manual da RFB. Nada do seu movimento é enviado para fora.",
  },
];

function Index() {
  return (
    <main className="ambient min-h-screen overflow-hidden">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-7">
        <BrandLogo className="h-8 w-auto" />
        <nav className="flex items-center gap-2 text-sm sm:gap-5">
          <Link
            to="/login"
            className="focus-glow rounded-md px-3 py-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            Entrar
          </Link>
          <Link
            to="/signup"
            className="focus-glow rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Criar conta
          </Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-14 px-6 pt-12 pb-20 lg:grid-cols-[1.05fr_0.95fr] lg:pt-20">
        <div>
          <Reveal as="p" className="font-mono text-xs tracking-[0.3em] text-primary uppercase">
            reforma tributária · ibs e cbs
          </Reveal>
          <Reveal
            as="h1"
            index={1}
            className="mt-6 max-w-2xl text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.02em] text-foreground sm:text-5xl lg:text-[3.5rem]"
          >
            Descubra quanto o IBS e a CBS vão tirar do seu caixa — antes de 2027.
          </Reveal>
          <Reveal
            as="p"
            index={2}
            className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg"
          >
            Lemos as notas fiscais da empresa, calculamos com o motor oficial da Receita Federal e
            mostramos, semana a semana, quanto vai faltar.
          </Reveal>

          <Reveal index={3} className="mt-9 flex flex-wrap gap-3">
            <a
              href="#como-funciona"
              className="focus-glow group inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Ver como funciona
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <Link
              to="/login"
              className="focus-glow inline-flex items-center rounded-md border border-border px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Entrar
            </Link>
          </Reveal>
        </div>

        <Reveal index={2} className="lg:pl-4">
          <CashPreview />
        </Reveal>
      </section>

      <div className="mx-auto max-w-6xl px-6">
        <div className="hairline" />
      </div>

      <section id="como-funciona" className="mx-auto max-w-6xl scroll-mt-16 px-6 py-20">
        <Reveal as="h2" className="text-2xl font-semibold tracking-[-0.01em] text-foreground">
          O que você recebe
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {BENEFITS.map((item, i) => (
            <Reveal key={item.label} index={i + 1}>
              <article className="card-lift h-full rounded-xl bg-surface p-6">
                <item.icon className="size-5 text-primary" aria-hidden />
                <p className="mt-4 font-mono text-[10px] tracking-[0.28em] text-primary uppercase">
                  {item.label}
                </p>
                <h3 className="mt-2 text-base font-medium text-foreground">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <Reveal>
          <div className="surface-lit rounded-2xl p-8 sm:p-10">
            <p className="font-mono text-[10px] tracking-[0.28em] text-primary uppercase">
              teste agora, sem conectar nada
            </p>
            <h2 className="mt-4 max-w-2xl text-2xl leading-snug font-semibold tracking-[-0.01em] text-foreground sm:text-3xl">
              O validador de XML e o simulador funcionam antes de você conectar qualquer coisa.
            </h2>
            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              <div className="reveal" data-shown="true">
                <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <FileCheck2 className="size-4 text-primary" aria-hidden />
                  Validador de XML
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Solte os XMLs que você já emite e veja o ranking dos erros que se repetem — o
                  mesmo NCM classificado errado quarenta vezes aparece no topo.
                </p>
              </div>
              <div>
                <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Scale className="size-4 text-primary" aria-hidden />
                  Simulador
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Informe uma operação e veja CBS, IBS estadual e municipal com a memória de
                  cálculo e a base legal de cada linha.
                </p>
              </div>
            </div>
            <Link
              to="/signup"
              className="focus-glow mt-8 inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Criar conta e testar
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </Reveal>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <Reveal>
          <div className="card-lift flex flex-col gap-4 rounded-xl bg-surface/60 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-mono text-[10px] tracking-[0.28em] text-warn uppercase">
                programa nacional de conformidade
              </p>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Inconsistências corrigidas até o fim do exercício evitam sanções. Quanto antes as
                falhas de classificação aparecem, menor o custo de arrumá-las.
              </p>
            </div>
            <Link
              to="/signup"
              className="focus-glow shrink-0 rounded-md border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Revisar meus XMLs
            </Link>
          </div>
        </Reveal>
      </section>

      <footer className="mx-auto max-w-6xl px-6 pb-12">
        <div className="hairline" />
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
          <BrandLogo className="h-6 w-auto" />
          <p>Cálculo com o motor oficial da Receita Federal. Sem telemetria.</p>
        </div>
      </footer>
    </main>
  );
}
