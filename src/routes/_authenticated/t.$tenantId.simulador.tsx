import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Calculator, Link2, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/techiva/empty-state";
import { InfoHint } from "@/components/techiva/info-hint";
import { formatCents } from "@/components/techiva/money";
import { NoticeBoard } from "@/components/techiva/notices";
import { Page, PageHeader, Panel, Rise } from "@/components/techiva/page";
import { ClassTribFeedback } from "@/components/techiva/rtc";
import {
  CalcResultPanel,
  EngineBanner,
  MotorOficialNote,
  PrintButton,
} from "@/components/techiva/simulator";
import { ClassTribCombobox, CstCombobox } from "@/components/techiva/cst-combobox";
import { NbsCombobox, nbsCapitulo } from "@/components/techiva/nbs-combobox";
import { MunicipioCombobox } from "@/components/techiva/municipio-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useValidateClassTrib } from "@/lib/rtc";
import {
  UF_LIST,
  engineUnavailableMessage,
  parseMoneyToCents,
  shareIsActive,
  shareUrl,
  todayIso,
  useCalculate,
  useEngineStatus,
  useSaveSimulation,
  useShareSimulation,
  useUnshareSimulation,
  useSimulations,
  type CalcResult,
  type SimulationRow,
  type SimulatorInputs,
} from "@/lib/simulator";

export const Route = createFileRoute("/_authenticated/t/$tenantId/simulador")({
  head: () => ({
    meta: [
      { title: "Simulador de CBS, IBS e IS — TECH-IVA" },
      {
        name: "description",
        content:
          "Simule CBS, IBS estadual, IBS municipal e Imposto Seletivo pelo motor oficial da Receita Federal, com memória de cálculo e base legal.",
      },
      { property: "og:title", content: "Simulador de CBS, IBS e IS — TECH-IVA" },
      {
        property: "og:description",
        content:
          "Cálculo pelo motor oficial da Receita, validação de CST × cClassTrib e memória de cálculo rastreável.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SimuladorPage,
});

function SimuladorPage() {
  const { tenantId } = Route.useParams();

  const [cst, setCst] = useState("000");
  const [cclasstrib, setCclasstrib] = useState("");
  const [ncm, setNcm] = useState("");
  const [nbs, setNbs] = useState("");
  const [nbsDescricao, setNbsDescricao] = useState("");
  const [base, setBase] = useState("1.000,00");
  const [ufOrigem, setUfOrigem] = useState("DF");
  const [ufDestino, setUfDestino] = useState("DF");
  const [municipio, setMunicipio] = useState("");
  // Código IBGE do município escolhido — exibido na tela para conferência.
  const [municipioCodigo, setMunicipioCodigo] = useState("");
  const [data, setData] = useState(todayIso());
  const [nome, setNome] = useState("");
  const [result, setResult] = useState<CalcResult | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const engine = useEngineStatus();
  const classTrib = useValidateClassTrib(cst, cclasstrib, data);
  const calculate = useCalculate(tenantId);
  const save = useSaveSimulation(tenantId);
  const share = useShareSimulation(tenantId);
  const unshare = useUnshareSimulation(tenantId);
  const history = useSimulations(tenantId);

  const baseCents = useMemo(() => parseMoneyToCents(base), [base]);
  const engineReady = engine.data?.available === true;

  const inputs: SimulatorInputs = {
    cst: cst.trim(),
    cclasstrib: cclasstrib.trim(),
    ...(ncm.trim() ? { ncm: ncm.trim() } : {}),
    ...(nbs.trim() ? { nbs: nbs.trim() } : {}),
    base_cents: baseCents,
    uf_origem: ufOrigem,
    uf_destino: ufDestino,
    ...(municipio.trim() ? { municipio_destino: municipio.trim() } : {}),
    ...(municipioCodigo.trim() ? { municipio_codigo: municipioCodigo.trim() } : {}),
    data_fato_gerador: data,
  };

  function onCalculate() {
    if (baseCents <= 0) {
      toast.error("Informe uma base de cálculo válida.");
      return;
    }
    if (!cst.trim() || !cclasstrib.trim()) {
      toast.error("Informe CST e cClassTrib.");
      return;
    }
    setUnavailable(null);
    calculate.mutate(inputs, {
      onSuccess: (outcome) => {
        if (!outcome.available) {
          setResult(null);
          setUnavailable(outcome.message || engineUnavailableMessage(outcome.reason));
          void engine.refetch();
          return;
        }
        setResult(outcome.result);
      },
      onError: (error) => toast.error((error as Error).message),
    });
  }

  function loadSimulation(row: SimulationRow) {
    const i = row.inputs;
    setCst(i.cst ?? "");
    setCclasstrib(i.cclasstrib ?? "");
    setNcm(i.ncm ?? "");
    setNbs(i.nbs ?? "");
    setNbsDescricao("");
    setBase(((i.base_cents ?? 0) / 100).toFixed(2).replace(".", ","));
    setUfOrigem(i.uf_origem ?? "DF");
    setUfDestino(i.uf_destino ?? "DF");
    setMunicipio(i.municipio_destino ?? "");
    setMunicipioCodigo("");
    setData(i.data_fato_gerador ?? todayIso());
    setNome(row.nome ?? "");
    setResult(row.results ?? null);
    setUnavailable(null);
  }

  return (
    <Page>
      <PageHeader
        eyebrow="ferramentas · simulador"
        title="Simulador de CBS, IBS e IS"
        helpTitle="Como usar o simulador"
        help={
          <p>
            Monte a operação, valide a classificação e veja cada tributo separado com a memória de
            cálculo. Serve antes de conectar qualquer nota.
          </p>
        }
        actions={<EngineBanner status={engine.data} loading={engine.isLoading} />}
      />

      {/* posicionamento e avisos mantidos pela plataforma (notices_for) */}
      <Rise index={1}>
        <NoticeBoard scope="simulador" />
      </Rise>

      <Rise index={2} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <Panel title="Operação">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cst">CST</Label>
                <CstCombobox id="cst" value={cst} onChange={(row) => setCst(row?.[0] ?? "")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cclasstrib">cClassTrib</Label>
                <ClassTribCombobox
                  id="cclasstrib"
                  value={cclasstrib}
                  cst={cst}
                  onChange={(row) => setCclasstrib(row?.[0] ?? "")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ncm">NCM (mercadoria)</Label>
                <Input
                  id="ncm"
                  value={ncm}
                  maxLength={8}
                  className="font-mono"
                  onChange={(e) => setNcm(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="nbs">NBS (serviço)</Label>
                  <InfoHintNbs />
                </div>
                <NbsCombobox
                  id="nbs"
                  value={nbs}
                  onChange={(item) => {
                    setNbs(item?.codigo ?? "");
                    setNbsDescricao(item?.descricao ?? "");
                  }}
                />
                {nbs && (
                  <p className="text-xs text-muted-foreground">
                    {nbsCapitulo(nbs) ? `Capítulo: ${nbsCapitulo(nbs)}. ` : ""}
                    {nbsDescricao}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="base">Base de cálculo</Label>
                <Input
                  id="base"
                  value={base}
                  className="font-mono"
                  onChange={(e) => setBase(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{formatCents(baseCents)}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="data">Data do fato gerador</Label>
                <Input
                  id="data"
                  type="date"
                  value={data}
                  onChange={(e) => setData(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="uf-origem">UF de origem</Label>
                <Select value={ufOrigem} onValueChange={setUfOrigem}>
                  <SelectTrigger id="uf-origem">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UF_LIST.map((uf) => (
                      <SelectItem key={uf} value={uf}>
                        {uf}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="uf-destino">UF de destino</Label>
                <Select value={ufDestino} onValueChange={setUfDestino}>
                  <SelectTrigger id="uf-destino">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UF_LIST.map((uf) => (
                      <SelectItem key={uf} value={uf}>
                        {uf}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="municipio">Município de destino</Label>
                  <InfoHintMunicipio />
                </div>
                <MunicipioCombobox
                  id="municipio"
                  value={municipio}
                  uf={ufDestino}
                  onChange={(m) => {
                    setMunicipio(m?.nome ?? "");
                    setMunicipioCodigo(m?.codigo ?? "");
                    if (m?.uf) setUfDestino(m.uf);
                  }}
                />
                {municipioCodigo ? (
                  <p className="text-xs text-muted-foreground">Código IBGE {municipioCodigo}</p>
                ) : null}
              </div>
            </div>

            <div className="mt-3">
              <ClassTribFeedback
                result={classTrib.data}
                loading={classTrib.isFetching}
                onPickSuggestion={setCclasstrib}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button onClick={onCalculate} disabled={calculate.isPending || !engineReady}>
                {calculate.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Calculator className="size-4" aria-hidden />
                )}
                Calcular no motor oficial
              </Button>
              {!engineReady && !engine.isLoading && (
                <span className="text-xs text-muted-foreground">
                  Cálculo desabilitado enquanto a calculadora oficial estiver fora do ar.
                </span>
              )}
            </div>
          </Panel>

          {(unavailable || engine.data?.available === false) && (
            <EngineBanner status={engine.data} message={unavailable} />
          )}

          {result && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-52 flex-1 space-y-1.5">
                  <Label htmlFor="nome">Nome da simulação</Label>
                  <Input
                    id="nome"
                    value={nome}
                    placeholder="Venda interestadual — item X"
                    onChange={(e) => setNome(e.target.value)}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={save.isPending}
                  onClick={() =>
                    save.mutate(
                      { nome: nome.trim() || "Simulação sem nome", inputs, result },
                      {
                        onSuccess: () => toast.success("Simulação salva."),
                        onError: (e) => toast.error((e as Error).message),
                      },
                    )
                  }
                >
                  <Save className="size-4" aria-hidden />
                  Salvar simulação
                </Button>
                <PrintButton />
              </div>
              <CalcResultPanel result={result} />
            </div>
          )}

          <MotorOficialNote />
        </div>

        <aside className="min-w-0 space-y-3">
          <Panel title="Simulações salvas">
            {history.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (history.data ?? []).length === 0 ? (
              <EmptyState
                title="Nenhuma simulação salva"
                hint="Calcule uma operação e salve para reaproveitar depois."
              />
            ) : (
              <ul className="space-y-2">
                {(history.data ?? []).map((row) => (
                  <li
                    key={row.id}
                    className="rounded-lg border border-border bg-surface-2 p-3 text-xs"
                  >
                    <button
                      type="button"
                      className="text-left font-medium hover:underline"
                      onClick={() => loadSimulation(row)}
                    >
                      {row.nome ?? "Simulação sem nome"}
                    </button>
                    <p className="mt-1 text-muted-foreground">
                      {new Date(row.created_at).toLocaleString("pt-BR")}
                      {row.calc_version && (
                        <>
                          {" · "}
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {row.calc_version}
                          </Badge>
                        </>
                      )}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        disabled={share.isPending}
                        onClick={() =>
                          share.mutate(row.id, {
                            onSuccess: ({ token, expires_at }) => {
                              void navigator.clipboard?.writeText(shareUrl(token));
                              toast.success(
                                `Link copiado. Vale até ${new Date(expires_at).toLocaleDateString("pt-BR")}.`,
                              );
                            },
                            onError: (e) => toast.error((e as Error).message),
                          })
                        }
                      >
                        <Link2 className="size-3.5" aria-hidden />
                        {shareIsActive(row) ? "Copiar link" : "Compartilhar"}
                      </Button>
                      {row.share_token ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-muted-foreground"
                          disabled={unshare.isPending}
                          onClick={() =>
                            unshare.mutate(row.id, {
                              onSuccess: () => toast.success("Link revogado."),
                              onError: (e) => toast.error((e as Error).message),
                            })
                          }
                        >
                          Revogar link
                        </Button>
                      ) : null}
                    </div>
                    {row.share_token ? (
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        {shareIsActive(row)
                          ? `Link público válido até ${new Date(row.share_expires_at ?? row.created_at).toLocaleDateString("pt-BR")}`
                          : "Link público expirado — compartilhe de novo para gerar outro"}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </Rise>
    </Page>
  );
}

function InfoHintNbs() {
  return (
    <InfoHint title="NBS">
      <p>Busque pela descrição do serviço ou pelo código. Tabela NBS 2.0 (Anexo I).</p>
      <p>O nível usado na nota fiscal é o subitem, com 9 dígitos.</p>
    </InfoHint>
  );
}

function InfoHintMunicipio() {
  return (
    <InfoHint title="Município de destino">
      <p>Busque por nome (sem acento serve) ou pelo código IBGE. Lista oficial DTB/IBGE 2024.</p>
    </InfoHint>
  );
}
