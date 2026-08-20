import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { BrandLogo } from "@/components/brand/brand-logo";
import { AmbientBackdrop } from "@/components/visual/ambient-backdrop";
import { LEGAL_UPDATED_AT, type LegalSection } from "@/lib/legal";

type Props = {
  title: string;
  intro: string;
  sections: LegalSection[];
};

export function LegalPage({ title, intro, sections }: Props) {
  return (
    <main className="ambient min-h-screen overflow-hidden">
      <AmbientBackdrop />

      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-7">
        <Link to="/" aria-label="Voltar para a página inicial">
          <BrandLogo className="h-8 w-auto" />
        </Link>
        <Link
          to="/"
          className="focus-glow inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Início
        </Link>
      </header>

      <article className="mx-auto max-w-3xl px-6 pb-20">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          documento legal
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          Atualizado em {LEGAL_UPDATED_AT}
        </p>
        <p className="mt-6 text-base leading-relaxed text-muted-foreground">{intro}</p>

        <div className="mt-10 space-y-10">
          {sections.map((section, index) => (
            <section key={section.heading} className="space-y-3">
              <h2 className="text-lg font-semibold text-foreground">
                <span className="mr-2 font-mono text-sm text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {section.heading}
              </h2>
              {(section.paragraphs ?? []).map((paragraph) => (
                <p key={paragraph} className="text-sm leading-relaxed text-muted-foreground">
                  {paragraph}
                </p>
              ))}
              {section.bullets?.length ? (
                <ul className="ml-5 list-disc space-y-2 text-sm leading-relaxed text-muted-foreground">
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>

        <div className="hairline mt-14" />
        <nav className="mt-6 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <Link to="/termos" className="hover:text-foreground">
            Termos e condições
          </Link>
          <Link to="/reembolso" className="hover:text-foreground">
            Política de reembolso
          </Link>
          <Link to="/privacidade" className="hover:text-foreground">
            Aviso de privacidade
          </Link>
        </nav>
      </article>
    </main>
  );
}
