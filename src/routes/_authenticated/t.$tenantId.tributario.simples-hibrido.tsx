import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Building2, CheckCircle2, ExternalLink, Loader2, Puzzle, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ModuleTabs } from "@/components/tax-intel/module-tabs";
import { EmptyState, ErrorState } from "@/components/techiva/empty-state";
import { Page, PageHeader, Rise, Segmented } from "@/components/techiva/page";
import { Pager } from "@/components/techiva/pager";
import { SideSheet } from "@/components/techiva/side-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatCnpj } from "@/lib/tax-intel/cnpj";
import {
  CONSULTA_OPTANTES_URL,
  ibsCbsText,
  loadConsultas,
  parseConsultaOptantes,
  raizOf,
  registrarConsulta,
  type ConsultaRegistrada,
} from "@/lib/tax-intel/consulta-optantes";
import { n } from "@/lib/tax-intel/labels";
import { EMPTY_FILTERS, loadPortfolioAll, type PortfolioRow } from "@/lib/tax-intel/portfolio";
import { useShellData } from "@/lib/tenant-shell-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/t/$tenantId/tributario/simples-hibrido")({
  head: () => ({
    meta: [
      { title: "Simples híbrido · Inteligência Tributária · TECH-IVA" },
      {
        name: "description",
        content: "Opção dos optantes do Simples pelo regime regular de IBS e CBS.",
      },
    ],
  }),
  component: SimplesHibridoPage,
});

type Empresa = { raiz: string; row: PortfolioRow; consulta: ConsultaRegistrada | null };
type Filtro = "pendentes" | "consultadas" | "todas";

const ORIGEM_APP = "techiva-app";
const ORIGEM_EXT = "techiva-consulta-optantes";

/** Extensão do navegador: anuncia-se por postMessage (ver extensao-consulta-optantes/). */
function useExtensao(onResultado: (m: { requestId: string; cnpj: string; texto: string }) => void) {
  const [versao, setVersao] = useState<string | null>(null);
  const cb = useRef(onResultado);
  cb.current = onResultado;
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const m = e.data as {
        source?: string;
        tipo?: string;
        versao?: string;
        requestId?: string;
        cnpj?: string;
        texto?: string;
      };
      if (m?.source !== ORIGEM_EXT) return;
      if (m.tipo === "pronta") setVersao(m.versao ?? "?");
      if (m.tipo === "resultado" && m.requestId && m.cnpj && typeof m.texto === "string")
        cb.current({ requestId: m.requestId, cnpj: m.cnpj, texto: m.texto });
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ source: ORIGEM_APP, tipo: "ping" }, window.location.origin);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  const consultar = (cnpj: string, requestId: string) =>
    window.postMessage(
      { source: ORIGEM_APP, tipo: "consultar", cnpj, requestId },
      window.location.origin,
    );
  return { versao, consultar };
}

function SimplesHibridoPage() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const kind = shell.data?.tenant.kind;
  const allowedKind = kind === "company" || kind === "unit";
  const qc = useQueryClient();

  const base = useQuery({
    enabled: allowedKind,
    queryKey: ["tax-simples-optantes", tenantId],
    queryFn: () =>
      loadPortfolioAll(
        tenantId,
        { ...EMPTY_FILTERS, classe: "simples_nacional" },
        { key: "cnpj", desc: false },
      ),
  });
  const consultas = useQuery({
    enabled: allowedKind,
    queryKey: ["tax-consultas-optantes", tenantId],
    queryFn: () => loadConsultas(tenantId),
  });

  // Uma linha por empresa (raiz): a opção abrange todos os estabelecimentos.
  const empresas = useMemo<Empresa[]>(() => {
    const map = new Map<string, PortfolioRow>();
    for (const r of base.data ?? []) {
      const k = raizOf(r.cnpj);
      const cur = map.get(k);
      if (!cur || (r.tax_entities.is_matriz && !cur.tax_entities.is_matriz)) map.set(k, r);
    }
    return [...map.entries()].map(([raiz, row]) => ({
      raiz,
      row,
      consulta: consultas.data?.get(raiz) ?? null,
    }));
  }, [base.data, consultas.data]);

  const [filtro, setFiltro] = useState<Filtro>("pendentes");
  const [busca, setBusca] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [ativa, setAtiva] = useState<Empresa | null>(null);
  const [aguardando, setAguardando] = useState<{ requestId: string; empresa: Empresa } | null>(
    null,
  );
  const [salvando, setSalvando] = useState(false);

  const visiveis = useMemo(() => {
    const t = busca.trim().toUpperCase().replace(/[./-]/g, "");
    return empresas.filter((e) => {
      if (filtro === "pendentes" && e.consulta) return false;
      if (filtro === "consultadas" && !e.consulta) return false;
      if (!t) return true;
      return (
        e.row.cnpj.startsWith(t) ||
        (e.row.tax_entities.razao_social ?? e.row.declared_razao_social ?? "")
          .toUpperCase()
          .includes(t)
      );
    });
  }, [empresas, filtro, busca]);
  const pagina = visiveis.slice(page * pageSize, page * pageSize + pageSize);
  const consultadas = empresas.filter((e) => e.consulta).length;
  const regular = empresas.filter(
    (e) => e.consulta?.ibs === "sim" || e.consulta?.cbs === "sim",
  ).length;
  const proxima = empresas.find((e) => !e.consulta && e.raiz !== aguardando?.empresa.raiz) ?? null;

  async function gravar(empresa: Empresa, texto: string, arquivo?: File | null) {
    const p = parseConsultaOptantes(texto);
    if (!p.ok) {
      toast.error(p.erro);
      return false;
    }
    setSalvando(true);
    try {
      await registrarConsulta(tenantId, empresa.row.cnpj, p.value, arquivo);
      toast.success(
        `${formatCnpj(empresa.row.cnpj)} gravado: ${ibsCbsText({
          raiz: empresa.raiz,
          ibs: p.value.ibs.valor,
          cbs: p.value.cbs.valor,
          ibsDesde: p.value.ibs.desde ?? p.value.consultadoEm.slice(0, 10),
          cbsDesde: p.value.cbs.desde ?? p.value.consultadoEm.slice(0, 10),
          consultadoEm: p.value.consultadoEm.slice(0, 10),
          descricao: "",
          temArquivo: !!arquivo,
        })}.`,
      );
      await qc.invalidateQueries({ queryKey: ["tax-consultas-optantes", tenantId] });
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setSalvando(false);
    }
  }

  const ext = useExtensao((m) => {
    if (!aguardando || m.requestId !== aguardando.requestId) return;
    const empresa = aguardando.empresa;
    setAguardando(null);
    void gravar(empresa, m.texto);
  });

  async function consultar(e: Empresa) {
    if (ext.versao) {
      const requestId = crypto.randomUUID();
      setAguardando({ requestId, empresa: e });
      ext.consultar(e.row.cnpj, requestId);
      return;
    }
    try {
      await navigator.clipboard.writeText(e.row.cnpj);
    } catch {
      /* sem permissão de cópia: o CNPJ aparece no painel */
    }
    window.open(CONSULTA_OPTANTES_URL, "consulta-optantes");
    setAtiva(e);
  }

  if (shell.data && !allowedKind) {
    return (
      <Page>
        <PageHeader eyebrow="inteligência tributária" title="Simples híbrido" />
        <EmptyState
          icon={Building2}
          title="Disponível em empresa ou unidade"
          hint="Abra a empresa."
        />
      </Page>
    );
  }

  const erro = base.error ?? consultas.error;
  return (
    <Page className="max-w-7xl">
      <PageHeader
        eyebrow="inteligência tributária"
        title="Simples híbrido (IBS/CBS)"
        helpTitle="Por que a consulta é feita por uma pessoa"
        help={
          <>
            <p>
              A opção do Simples pelo regime regular de IBS e de CBS não está nos dados abertos da
              Receita. Ela só aparece na Consulta Optantes do Portal do Simples, um CNPJ por vez e
              protegida por captcha. Por isso a consulta é feita por você; o sistema preenche, lê o
              resultado e grava com a data e o seu usuário.
            </p>
            <p className="mt-2">
              Com a extensão TECH-IVA, o botão Consultar abre a Receita com o CNPJ preenchido; você
              clica em Consultar lá e o resultado volta e é gravado. Sem ela, o botão copia o CNPJ e
              abre a Receita; depois copie a página do resultado (Ctrl+A, Ctrl+C) e cole aqui.
            </p>
            <p className="mt-2">
              Só aparecem as empresas que a Receita aponta como optantes do Simples (MEI não tem
              essa opção). A opção vale para todos os estabelecimentos da empresa.
            </p>
          </>
        }
        meta={
          base.data ? (
            <span>
              <span className="font-mono tabular text-foreground">{n(consultadas)}</span> de{" "}
              {n(empresas.length)} empresas consultadas · {n(regular)} no regime regular
            </span>
          ) : null
        }
        actions={
          proxima ? (
            <Button
              size="sm"
              disabled={!!aguardando || salvando}
              onClick={() => void consultar(proxima)}
            >
              <ExternalLink className="mr-2 size-4" aria-hidden />
              Consultar a próxima
            </Button>
          ) : null
        }
      />
      <ModuleTabs tenantId={tenantId} />

      <Rise index={1}>
        <div
          className={cn(
            "flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm",
            ext.versao ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-surface-1",
          )}
        >
          <Puzzle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {ext.versao ? (
            <span>Extensão ativa: o CNPJ vai preenchido e o resultado volta sozinho.</span>
          ) : (
            <span>Sem a extensão: cole o CNPJ na Receita e traga o texto do resultado.</span>
          )}
        </div>
      </Rise>

      {aguardando && (
        <Rise index={2}>
          <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Aguardando a consulta de {formatCnpj(aguardando.empresa.row.cnpj)} na aba da Receita.
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setAguardando(null)}
            >
              Cancelar
            </Button>
          </div>
        </Rise>
      )}

      <Rise index={3} className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Filtro"
          value={filtro}
          onChange={(v) => {
            setFiltro(v);
            setPage(0);
          }}
          options={[
            { value: "pendentes", label: `A consultar (${n(empresas.length - consultadas)})` },
            { value: "consultadas", label: `Consultadas (${n(consultadas)})` },
            { value: "todas", label: "Todas" },
          ]}
        />
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPage(0);
            }}
            placeholder="CNPJ ou razão social"
            className="pl-8"
          />
        </div>
      </Rise>

      {erro ? (
        <ErrorState
          title="Não foi possível carregar"
          message={(erro as Error).message}
          onRetry={() => {
            void base.refetch();
            void consultas.refetch();
          }}
        />
      ) : base.isLoading || consultas.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : empresas.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Nenhum optante do Simples na base"
          hint="Processe a base primeiro: só os optantes do Simples entram nesta consulta."
        />
      ) : (
        <Rise index={4} className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">CNPJ</th>
                <th className="px-3 py-2 font-medium">Razão social</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Município/UF</th>
                <th className="px-3 py-2 font-medium">Regime regular IBS/CBS</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {pagina.map((e) => {
                const ent = e.row.tax_entities;
                const esperando = aguardando?.empresa.raiz === e.raiz;
                return (
                  <tr key={e.raiz} className="border-t border-border/60">
                    <td className="px-3 py-2 font-mono tabular">{formatCnpj(e.row.cnpj)}</td>
                    <td className="px-3 py-2">
                      {ent.razao_social ?? e.row.declared_razao_social ?? "—"}
                    </td>
                    <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">
                      {[ent.municipio, ent.uf].filter(Boolean).join("/") || "—"}
                    </td>
                    <td className="px-3 py-2">
                      {e.consulta ? (
                        <span className="inline-flex items-center gap-1.5">
                          <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden />
                          {ibsCbsText(e.consulta)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">A confirmar</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant={e.consulta ? "ghost" : "outline"}
                        size="sm"
                        disabled={!!aguardando || salvando}
                        onClick={() => void consultar(e)}
                      >
                        {esperando ? (
                          <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />
                        ) : null}
                        {e.consulta ? "Consultar de novo" : "Consultar"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pager
            page={page}
            pageSize={pageSize}
            total={visiveis.length}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(0);
            }}
            unit="empresa(s)"
            className="border-t border-border/60"
          />
        </Rise>
      )}

      <ColarResultado
        empresa={ativa}
        salvando={salvando}
        onClose={() => setAtiva(null)}
        onGravar={async (texto, arquivo) => {
          if (ativa && (await gravar(ativa, texto, arquivo))) setAtiva(null);
        }}
      />
    </Page>
  );
}

function ColarResultado({
  empresa,
  salvando,
  onClose,
  onGravar,
}: {
  empresa: Empresa | null;
  salvando: boolean;
  onClose: () => void;
  onGravar: (texto: string, arquivo: File | null) => Promise<void>;
}) {
  const [texto, setTexto] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  useEffect(() => {
    setTexto("");
    setArquivo(null);
  }, [empresa?.raiz]);
  const p = texto.trim() ? parseConsultaOptantes(texto) : null;
  const outra = p?.ok && empresa && raizOf(p.value.cnpj) !== empresa.raiz;
  return (
    <SideSheet
      open={!!empresa}
      onOpenChange={(o) => !o && onClose()}
      title={empresa ? `Resultado de ${formatCnpj(empresa.row.cnpj)}` : "Resultado"}
      description="Na aba da Receita: cole o CNPJ (já copiado), clique em Consultar, copie a página do resultado (Ctrl+A, Ctrl+C) e cole abaixo."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!p?.ok || !!outra || salvando}
            onClick={() => void onGravar(texto, arquivo)}
          >
            {salvando && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
            Gravar
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open(CONSULTA_OPTANTES_URL, "consulta-optantes")}
        >
          <ExternalLink className="mr-2 size-4" aria-hidden />
          Abrir a Consulta Optantes
        </Button>
        <Textarea
          autoFocus
          rows={10}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Cole aqui o texto da página de resultado"
          className="font-mono text-xs"
        />
        {p && !p.ok && <p className="text-destructive">{p.erro}</p>}
        {outra && (
          <p className="text-destructive">
            O resultado é de outra empresa ({formatCnpj(p.ok ? p.value.cnpj : "")}).
          </p>
        )}
        {p?.ok && !outra && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-border p-3">
            <dt className="text-muted-foreground">Consulta</dt>
            <dd>{new Date(p.value.consultadoEm).toLocaleString("pt-BR")}</dd>
            <dt className="text-muted-foreground">Simples</dt>
            <dd>{p.value.simples ?? "—"}</dd>
            <dt className="text-muted-foreground">IBS</dt>
            <dd>{p.value.ibs.texto}</dd>
            <dt className="text-muted-foreground">CBS</dt>
            <dd>{p.value.cbs.texto}</dd>
          </dl>
        )}
        <label className="block text-xs text-muted-foreground">
          Print ou PDF da consulta (opcional)
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            className="mt-1 block w-full text-xs"
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>
    </SideSheet>
  );
}
