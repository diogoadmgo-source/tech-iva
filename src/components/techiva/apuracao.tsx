import { useState } from "react";
import { ChevronDown, ChevronRight, Circle } from "lucide-react";

import { EmptyState } from "@/components/techiva/empty-state";
import { InfoHint } from "@/components/techiva/info-hint";
import { formatCents } from "@/components/techiva/money";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  APURACAO_VISOES,
  NATUREZA_LABEL,
  NATUREZA_SIGLA,
  SITUACAO_LABEL,
  SITUACAO_ORDEM,
  type ApuracaoConta,
  type ApuracaoNatureza,
  type ApuracaoSituacao,
} from "@/lib/rtc";

/* -------------------------------------------------------- natureza C / D */

/**
 * A Receita apresenta o valor com sufixo C (credor) ou D (devedor), nunca com
 * sinal negativo. O contador reconhece por esse formato — mantemos igual.
 */
export function NaturezaMoney({
  cents,
  natureza,
  className,
}: {
  cents: number | null;
  natureza: ApuracaoNatureza | null;
  className?: string;
}) {
  const sigla = natureza ? NATUREZA_SIGLA[natureza] : "";
  return (
    <span className={cn("font-mono tabular", className)}>
      {formatCents(cents ?? 0)}
      {sigla && (
        <span
          className={cn(
            "ml-1.5 text-[0.8em] font-semibold",
            natureza === "credor" ? "text-flow-in" : natureza === "devedor" ? "text-flow-out" : "",
          )}
          title={natureza ? NATUREZA_LABEL[natureza] : undefined}
        >
          {sigla}
        </span>
      )}
    </span>
  );
}

/** Total em destaque, com a natureza escrita por extenso abaixo. */
export function TotalCard({
  label,
  cents,
  natureza,
  hint,
}: {
  label: string;
  cents: number | null;
  natureza: ApuracaoNatureza | null;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">
        <NaturezaMoney cents={cents} natureza={natureza} />
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {natureza ? NATUREZA_LABEL[natureza] : "Sem natureza informada"}
        {hint ? ` · ${hint}` : ""}
      </p>
    </div>
  );
}

/* ---------------------------------------------------- stepper de situação */

export function SituacaoStepper({ situacao }: { situacao: ApuracaoSituacao | null }) {
  const current = situacao ? SITUACAO_ORDEM.indexOf(situacao) : -1;
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Situação da apuração">
      {SITUACAO_ORDEM.map((step, i) => {
        const done = current > i;
        const active = current === i;
        return (
          <li key={step} className="flex items-center gap-2">
            <span
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
                active
                  ? "border-primary/60 bg-primary/10 font-medium text-foreground"
                  : done
                    ? "border-border bg-surface-2 text-muted-foreground"
                    : "border-dashed border-border text-muted-foreground/70",
              )}
            >
              <Circle
                className={cn("size-2.5", active ? "fill-primary text-primary" : done ? "fill-muted-foreground text-muted-foreground" : "")}
                aria-hidden
              />
              {SITUACAO_LABEL[step]}
            </span>
            {i < SITUACAO_ORDEM.length - 1 && (
              <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------- árvore de contas */

type TreeNode = ApuracaoConta & { children: TreeNode[] };

/** Reconstrói a hierarquia preservando a ORDEM em que a Receita apresentou. */
function buildTree(contas: ApuracaoConta[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const stack: TreeNode[] = [];
  for (const conta of contas) {
    const node: TreeNode = { ...conta, children: [] };
    while (stack.length > 0 && (stack[stack.length - 1] as TreeNode).nivel >= node.nivel) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

function ContaNode({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  return (
    <li>
      <div
        className="flex items-center justify-between gap-3 rounded-lg py-2 pr-2 hover:bg-surface-2"
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? `Recolher ${node.conta}` : `Expandir ${node.conta}`}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
          ) : (
            <span className="w-4" aria-hidden />
          )}
          <span className={cn("truncate text-sm", depth === 0 && "font-medium")}>{node.conta}</span>
          {node.tem_detalhe && (
            <Badge variant="outline" className="ml-1 shrink-0 text-[10px]">
              detalhe
            </Badge>
          )}
        </div>
        <NaturezaMoney cents={node.valor_cents} natureza={node.natureza} className="shrink-0 text-sm" />
      </div>
      {hasChildren && open && (
        <ul>
          {node.children.map((child, i) => (
            <li key={`${child.caminho}-${i}`} className="contents">
              <ContaNode node={child} depth={depth + 1} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function ContaTree({ contas }: { contas: ApuracaoConta[] | undefined }) {
  if (!contas || contas.length === 0) {
    return (
      <EmptyState
        title="Nenhuma conta nesta visão"
        hint="A Receita não trouxe linhas para esta aba nesta competência."
      />
    );
  }
  const tree = buildTree(contas);
  return (
    <ul className="divide-y divide-border/60">
      {tree.map((node, i) => (
        <ContaNode key={`${node.caminho}-${i}`} node={node} depth={0} />
      ))}
    </ul>
  );
}

/** As seis abas do portal, na mesma ordem e com os mesmos nomes. */
export function VisoesTabs({ visoes }: { visoes: Record<string, ApuracaoConta[]> }) {
  const first = APURACAO_VISOES.find((v) => (visoes[v.key]?.length ?? 0) > 0)?.key ?? "resultado";
  return (
    <Tabs defaultValue={first}>
      <TabsList className="flex h-auto flex-wrap justify-start">
        {APURACAO_VISOES.map((v) => {
          const n = visoes[v.key]?.length ?? 0;
          return (
            <TabsTrigger key={v.key} value={v.key} className="gap-1.5 text-xs">
              {v.label}
              {n > 0 && <span className="font-mono text-[10px] text-muted-foreground">{n}</span>}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {APURACAO_VISOES.map((v) => (
        <TabsContent key={v.key} value={v.key} className="mt-3">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{v.label}</span>
            <InfoHint title={v.label}>
              <p>{v.hint}</p>
            </InfoHint>
          </div>
          <ContaTree contas={visoes[v.key]} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
