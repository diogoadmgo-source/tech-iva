import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Check, FileCheck2, Lock, Scale, TrendingDown } from "lucide-react";

import { BrandLogo } from "@/components/brand/brand-logo";
import { CashPreview } from "@/components/marketing/cash-preview";
import { Reveal } from "@/components/marketing/reveal";
import { formatCents } from "@/components/techiva/money";
import { Segmented } from "@/components/techiva/page";
import { AmbientBackdrop } from "@/components/visual/ambient-backdrop";
import { SpotlightCard } from "@/components/visual/spotlight-card";
import { PlanGem } from "@/components/techiva/plan-gem";
import { BILLING_CATALOG, type BillingCycle } from "@/lib/billing";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TECH-IVA — quanto o IBS e a CBS vão tirar do seu caixa" },
      {
        name: "description",
        content:
          "Lemos as notas fiscais da empresa, calculamos com o motor oficial da Receita Federal e mostramos, semana a semana, quanto vai faltar no caixa.",
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
  const [cycle, setCycle] = useState<BillingCycle>("month");
  return (
    <main className="ambient min-h-screen overflow-hidden">
      <AmbientBackdrop />
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
            className="focus-glow cta-lift rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground"
          >
            Criar conta
          </Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-14 px-6 pt-12 pb-20 lg:grid-cols-[1.05fr_0.95fr] lg:pt-20">
        <div>
          <Reveal as="p" className="font-display text-xs tracking-[0.3em] text-primary uppercase">
            reforma tributária · ibs e cbs
          </Reveal>
          <Reveal
            as="h1"
            index={1}
            className="mt-6 max-w-2xl text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.02em] text-foreground sm:text-5xl lg:text-[3.5rem]"
          >
            Descubra quanto o IBS e a CBS vão tirar do seu caixa.
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
              className="focus-glow cta-lift group inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground"
            >
              Ver como funciona
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </a>
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
        <Reveal as="h2" className="text-[2rem] leading-tight font-semibold tracking-[-0.015em] text-foreground sm:text-4xl">
          O que você recebe
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {BENEFITS.map((item, i) => (
            <Reveal key={item.label} index={i + 1}>
              <SpotlightCard as="article" className="panel-hover h-full rounded-xl border border-border bg-surface p-6 transition-[transform,border-color,box-shadow] duration-200 ease-out">
                <item.icon className="size-5 text-primary" aria-hidden />
                <p className="mt-4 font-display text-[10px] tracking-[0.28em] text-primary uppercase">
                  {item.label}
                </p>
                <h3 className="mt-2 text-base font-medium text-foreground">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <Reveal>
          <SpotlightCard className="surface-lit sheen rounded-2xl p-8 sm:p-10">
            <p className="font-display text-[10px] tracking-[0.28em] text-primary uppercase">
              teste agora, sem conectar nada
            </p>
            <h2 className="mt-4 max-w-2xl text-[2rem] leading-tight font-semibold tracking-[-0.015em] text-foreground sm:text-4xl">
              O validador de XML e o simulador funcionam antes de você conectar qualquer coisa.
            </h2>
            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              <div>
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
              className="focus-glow cta-lift mt-8 inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground"
            >
              Criar conta e testar
              <ArrowRight className="size-4" />
            </Link>
          </SpotlightCard>
        </Reveal>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <Reveal>
          <SpotlightCard className="card-lift sheen flex flex-col gap-4 rounded-xl bg-surface/60 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-display text-[10px] tracking-[0.28em] text-warn uppercase">
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
          </SpotlightCard>
        </Reveal>
      </section>

      <section id="planos" className="mx-auto max-w-6xl scroll-mt-16 px-6 py-20">
        <Reveal as="h2" className="text-[2rem] leading-tight font-semibold tracking-[-0.015em] text-foreground sm:text-4xl">
          Planos para cada fase da empresa
        </Reveal>
        <Reveal
          index={1}
          as="p"
          className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base"
        >
          Comece pelo que precisa hoje e suba de plano quando o volume de notas crescer. Sem
          fidelidade — cancele quando quiser.
        </Reveal>

        <Reveal index={2} className="mt-6">
          <Segmented
            label="Ciclo de cobrança"
            value={cycle}
            onChange={setCycle}
            options={[
              { value: "month", label: "Mensal" },
              { value: "year", label: "Anual · 2 meses grátis" },
            ]}
          />
        </Reveal>

        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {BILLING_CATALOG.map((plan, i) => {
            const isPro = plan.code === "pro";
            const monthlyEquiv = plan.price.year / 12;
            const savePct = Math.round((1 - monthlyEquiv / plan.price.month) * 100);
            return (
              <Reveal key={plan.code} index={i + 1}>
                <SpotlightCard
                  className={cn(
                    "panel-hover sheen h-full rounded-xl border bg-surface p-6 transition-[transform,border-color,box-shadow] duration-200 ease-out",
                    isPro ? "border-primary shadow-e2" : "border-border",
                  )}
                >
                  <div className="flex flex-col items-center text-center">
                    <PlanGem code={plan.code} size={72} className="mb-2" />
                    <p className="font-display text-[10px] tracking-[0.28em] text-primary uppercase">
                      {plan.name}
                    </p>
                  </div>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="font-mono tabular text-3xl font-semibold tracking-tight text-foreground">
                      {formatCents(plan.price[cycle])}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      /{cycle === "month" ? "mês" : "ano"}
                    </span>
                  </div>
                  {cycle === "year" ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      equivale a {formatCents(monthlyEquiv)}/mês · {savePct}% de economia
                    </p>
                  ) : null}
                  <p className="mt-2 text-sm text-muted-foreground">{plan.resumo}</p>
                  <ul className="mt-4 space-y-2 text-sm">
                    {plan.itens.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-foreground">
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    to="/signup"
                    className={cn(
                      "focus-glow cta-lift mt-6 inline-flex w-full items-center justify-center rounded-md px-5 py-2.5 text-sm font-medium",
                      isPro
                        ? "bg-primary text-primary-foreground"
                        : "border border-border text-foreground transition-colors hover:bg-accent",
                    )}
                  >
                    Criar conta
                    <ArrowRight className="ml-1.5 size-4" />
                  </Link>
                </SpotlightCard>
              </Reveal>
            );
          })}
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-6 pb-12">
        <div className="hairline" />
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
          <BrandLogo className="h-6 w-auto" />
          <nav className="flex flex-wrap items-center gap-4">
            <Link to="/termos" className="hover:text-foreground">
              Termos e condições
            </Link>
            <Link to="/reembolso" className="hover:text-foreground">
              Reembolso
            </Link>
            <Link to="/privacidade" className="hover:text-foreground">
              Privacidade
            </Link>
          </nav>
          <p>Cálculo com o motor oficial da Receita Federal. Sem telemetria.</p>
        </div>
      </footer>

    </main>
  );
}
