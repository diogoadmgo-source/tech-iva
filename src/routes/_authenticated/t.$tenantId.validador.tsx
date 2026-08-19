import { useCallback, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/techiva/empty-state";
import { NoticeBoard } from "@/components/techiva/notices";
import { useValidateClassTrib } from "@/lib/rtc";
import { KpiCard } from "@/components/techiva/metrics";
import { Page, PageHeader, Panel, Rise } from "@/components/techiva/page";
import {
  EngineBanner,
  MotorOficialNote,
  TopIssuesPanel,
} from "@/components/techiva/simulator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  VALIDADOR_PITCH,
  engineUnavailableMessage,
  useEngineStatus,
  useValidateXml,
  useValidationSummary,
  useValidationTopIssues,
  useXmlValidations,
  type XmlIssue,
} from "@/lib/simulator";

export const Route = createFileRoute("/_authenticated/t/$tenantId/validador")({
  head: () => ({
    meta: [
      { title: "Validador de XML fiscal — TECH-IVA" },
      {
        name: "description",
        content:
          "Valide XML de NF-e e NFS-e no componente oficial da Receita, veja as inconsistências de CST × cClassTrib e descubra seus erros recorrentes.",
      },
      { property: "og:title", content: "Validador de XML fiscal — TECH-IVA" },
      {
        property: "og:description",
        content:
          "Taxa de erro, ranking de inconsistências recorrentes e sugestão de classificação para corrigir a parametrização do emissor.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ValidadorPage,
});

type FileResult =
  | {
      filename: string;
      ok: true;
      valido: boolean;
      access_key: string | null;
      modelo: string | null;
      total_itens: number | null;
      inconsistencias: XmlIssue[];
    }
  | { filename: string; ok: false; message: string };

function ValidadorPage() {
  const { tenantId } = Route.useParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<FileResult[]>([]);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const engine = useEngineStatus();
  const summary = useValidationSummary(tenantId);
  const topIssues = useValidationTopIssues(tenantId);
  const recent = useXmlValidations(tenantId);
  const validate = useValidateXml(tenantId);

  const engineReady = engine.data?.available === true;

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      if (!engineReady) {
        toast.error("Calculadora não disponível — validação desabilitada.");
        return;
      }
      const files = Array.from(fileList).slice(0, 25);
      const payload: Array<{ filename: string; xml: string }> = [];
      for (const file of files) {
        if (file.size > 4_000_000) {
          toast.error(`${file.name}: arquivo maior que 4 MB.`);
          continue;
        }
        payload.push({ filename: file.name, xml: await file.text() });
      }
      if (payload.length === 0) return;

      setUnavailable(null);
      validate.mutate(payload, {
        onSuccess: (outcome) => {
          if (!outcome.available) {
            setUnavailable(outcome.message || engineUnavailableMessage(outcome.reason));
            void engine.refetch();
            return;
          }
          setResults(
            outcome.results.map((r) =>
              r.ok
                ? {
                    filename: r.filename,
                    ok: true as const,
                    valido: r.validation.valido,
                    access_key: r.validation.access_key,
                    modelo: r.validation.modelo,
                    total_itens: r.validation.total_itens,
                    inconsistencias: r.validation.inconsistencias,
                  }
                : { filename: r.filename, ok: false as const, message: r.message },
            ),
          );
          const invalidos = outcome.results.filter((r) => r.ok && !r.validation.valido).length;
          toast.success(
            invalidos === 0
              ? "Todos os arquivos válidos."
              : `${invalidos} arquivo(s) com inconsistência.`,
          );
        },
        onError: (error) => toast.error((error as Error).message),
      });
    },
    [engine, engineReady, validate],
  );

  const s = summary.data;

  return (
    <Page>
      <PageHeader
        eyebrow="ferramentas · validador"
        title="Validador de XML"
        helpTitle="Como usar o validador"
        help={<p>{VALIDADOR_PITCH}</p>}
        actions={<EngineBanner status={engine.data} loading={engine.isLoading} />}
      />

      {/* avisos mantidos pela plataforma (notices_for) */}
      <Rise index={1}>
        <NoticeBoard scope="validador" highlightKeys={["conformidade_2026"]} />
      </Rise>

      <Rise index={2} className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Documentos validados (30 dias)"
          value={s ? String(s.total) : "—"}
          hint={s?.ultima ? `Último em ${new Date(s.ultima).toLocaleDateString("pt-BR")}` : undefined}
        />
        <KpiCard label="Válidos" value={s ? String(s.validos) : "—"} />
        <KpiCard
          label="Taxa de erro"
          value={s ? `${Number(s.taxa_erro).toFixed(1).replace(".", ",")}%` : "—"}
          hint={s ? `${s.invalidos} documento(s) com inconsistência` : undefined}
        />
      </Rise>

      <Rise index={3}>
        <Panel
          title="Seus erros recorrentes"
          help={<p>Corrigir a parametrização do emissor resolve o erro em lote, não uma nota por vez.</p>}
        >
          <TopIssuesPanel issues={topIssues.data} loading={topIssues.isLoading} />
        </Panel>
      </Rise>

      {(unavailable || engine.data?.available === false) && (
        <Rise index={4}>
          <EngineBanner status={engine.data} message={unavailable} />
        </Rise>
      )}

      <Rise index={5}>
        <Panel bodyClassName="p-0">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void handleFiles(e.dataTransfer.files);
            }}
            className={cn(
              "rounded-lg border-2 border-dashed p-8 text-center transition-colors",
              dragging ? "border-primary bg-primary/5" : "border-border/70",
            )}
          >
            <FileUp className="mx-auto size-6 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm font-medium">Arraste seus XML aqui</p>
            <p className="mt-1 text-xs text-muted-foreground">
              NF-e ou NFS-e, vários arquivos de uma vez (até 25 por lote).
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xml,text/xml,application/xml"
              multiple
              className="hidden"
              onChange={(e) => void handleFiles(e.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={!engineReady || validate.isPending}
              onClick={() => inputRef.current?.click()}
            >
              {validate.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <FileUp className="size-4" aria-hidden />
              )}
              Selecionar arquivos
            </Button>
            {!engineReady && !engine.isLoading && (
              <p className="mt-2 text-xs text-muted-foreground">
                Validação desabilitada enquanto o componente oficial estiver fora do ar.
              </p>
            )}
          </div>
        </Panel>
      </Rise>

      {results.length > 0 && (
        <Rise index={6}>
          <Panel title="Resultado do lote">
            <ul className="space-y-3">
              {results.map((r) => (
                <li
                  key={r.filename}
                  className="rounded-lg border border-border bg-surface-2 p-4 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-2 font-medium">
                      {!r.ok ? (
                        <AlertTriangle className="size-4 text-flow-out" aria-hidden />
                      ) : r.valido ? (
                        <CheckCircle2 className="size-4 text-flow-in" aria-hidden />
                      ) : (
                        <XCircle className="size-4 text-flow-out" aria-hidden />
                      )}
                      {r.filename}
                    </p>
                    {r.ok && (
                      <span className="text-xs text-muted-foreground">
                        {r.modelo ? `modelo ${r.modelo} · ` : ""}
                        {r.total_itens ?? 0} item(ns)
                        {r.access_key ? ` · ${r.access_key}` : ""}
                      </span>
                    )}
                  </div>
                  {!r.ok ? (
                    <p className="mt-2 text-xs text-muted-foreground">{r.message}</p>
                  ) : r.inconsistencias.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Nenhuma inconsistência encontrada pelo componente oficial.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {r.inconsistencias.map((issue, i) => (
                        <li
                          key={`${issue.codigo}-${issue.item ?? i}`}
                          className="rounded-lg border border-flow-out/40 bg-flow-out/10 p-3 text-xs"
                        >
                          <p className="font-medium">
                            {issue.item !== null && <>Item {issue.item} · </>}
                            <code className="font-mono">{issue.codigo}</code>
                            {issue.severidade && (
                              <Badge variant="outline" className="ml-2 text-[10px]">
                                {issue.severidade}
                              </Badge>
                            )}
                          </p>
                          {issue.descricao && (
                            <p className="mt-1 text-muted-foreground">{issue.descricao}</p>
                          )}
                          {(issue.cst || issue.cclasstrib) && (
                            <p className="mt-1 font-mono text-muted-foreground">
                              CST {issue.cst ?? "—"} × cClassTrib {issue.cclasstrib ?? "—"}
                            </p>
                          )}
                          {issue.cst && (
                            <IssueSuggestion cst={issue.cst} cclasstrib={issue.cclasstrib} />
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </Rise>
      )}

      <Rise index={7} className="grid gap-4 lg:grid-cols-2">
        <Panel title="Validações recentes">
          {recent.isLoading ? (
            <p className="text-xs text-muted-foreground">Carregando…</p>
          ) : (recent.data ?? []).length === 0 ? (
            <EmptyState title="Nenhuma validação ainda" hint="Envie um XML para começar." />
          ) : (
            <ul className="space-y-2 text-xs">
              {(recent.data ?? []).slice(0, 10).map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-2 last:border-0"
                >
                  <span className="font-medium">{row.filename ?? "sem nome"}</span>
                  <span className="text-muted-foreground">
                    {row.valido ? "válido" : `${row.inconsistencias?.length ?? 0} inconsistência(s)`}{" "}
                    · {new Date(row.created_at).toLocaleDateString("pt-BR")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <MotorOficialNote />
      </Rise>
    </Page>
  );
}

/** Sugestão de classificação vinda da matriz da Receita (validate_class_trib). */
function IssueSuggestion({ cst, cclasstrib }: { cst: string; cclasstrib: string | null }) {
  const validation = useValidateClassTrib(cst, cclasstrib ?? "0");
  const result = validation.data;
  if (!result || result.valida || result.sugestoes.length === 0) return null;
  return (
    <p className="mt-2 text-muted-foreground">
      Combinações válidas para o CST {cst}:{" "}
      {result.sugestoes.slice(0, 4).map((s) => (
        <code key={s.cclasstrib} className="mr-2 font-mono text-foreground">
          {s.cclasstrib}
        </code>
      ))}
    </p>
  );
}
