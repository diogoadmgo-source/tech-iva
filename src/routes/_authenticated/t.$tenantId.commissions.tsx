import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Percent, Save } from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/techiva/data-table";
import { ErrorState, NoPermissionState } from "@/components/techiva/empty-state";
import { KpiCard } from "@/components/techiva/metrics";
import { Page, PageHeader, Panel, Rise } from "@/components/techiva/page";
import { CnpjText, MoneyText, formatPct } from "@/components/techiva/money";
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
import {
  currentMonth,
  formatMonth,
  recentMonths,
  useCommissionStatement,
  useSetCommissionRule,
  type CommissionLine,
} from "@/lib/commissions";
import { useShellData } from "@/lib/tenant-shell-data";
import { useFeatureInScope } from "@/lib/features";

export const Route = createFileRoute("/_authenticated/t/$tenantId/commissions")({
  head: () => ({
    meta: [
      { title: "Comissões do canal — TECH-IVA" },
      {
        name: "description",
        content:
          "Extrato mensal de comissões do canal contábil: base faturável por empresa, percentual vigente e total a receber.",
      },
      { property: "og:title", content: "Comissões do canal — TECH-IVA" },
      {
        property: "og:description",
        content: "Acompanhe a comissão recorrente do canal por empresa e por mês.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CommissionsPage,
});

function CommissionsPage() {
  const { tenantId } = Route.useParams();
  const shell = useShellData(tenantId);
  const [month, setMonth] = useState(currentMonth());
  const statement = useCommissionStatement(tenantId, month);
  // Sem nenhuma empresa da carteira com o módulo de crédito ligado, a comissão
  // sobre crédito é uma promessa que o canal não pode cumprir: fica oculta.
  const creditInScope = useFeatureInScope("credit");
  const showCredit = creditInScope.data === true;
  const months = useMemo(() => recentMonths(12), []);

  const isPlatform = shell.data?.tenant.kind === "platform";
  const canSeeChannel =
    shell.data?.tenant.kind === "channel" || isPlatform;

  const rows = useMemo(
    () =>
      [...(statement.data?.lines ?? [])].sort(
        (a, b) => b.commission_cents - a.commission_cents,
      ),
    [statement.data],
  );

  const columns = useMemo<ColumnDef<CommissionLine, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Empresa",
        cell: ({ row }) => (
          <Link
            to="/t/$tenantId/cash"
            params={{ tenantId: row.original.tenant_id }}
            className="font-medium hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "cnpj",
        header: "CNPJ",
        cell: ({ row }) =>
          row.original.cnpj ? <CnpjText value={row.original.cnpj} /> : <span>—</span>,
      },
      {
        accessorKey: "plan_name",
        header: "Plano",
        cell: ({ row }) => row.original.plan_name ?? "sem plano",
      },
      {
        accessorKey: "status",
        header: "Assinatura",
        cell: ({ row }) => (
          <span
            className={
              row.original.billable ? "text-flow-in" : "text-muted-foreground"
            }
          >
            {row.original.billable ? "faturável" : (row.original.status ?? "sem assinatura")}
          </span>
        ),
      },
      {
        accessorKey: "mrr_cents",
        header: "Mensalidade",
        cell: ({ row }) => <MoneyText cents={row.original.mrr_cents} />,
      },
      {
        accessorKey: "commission_cents",
        header: "Comissão",
        cell: ({ row }) => (
          <MoneyText
            cents={row.original.billable ? row.original.commission_cents : 0}
            className={row.original.billable ? "text-flow-in" : "text-muted-foreground"}
          />
        ),
      },
    ],
    [],
  );

  if (shell.isSuccess && !canSeeChannel) {
    return (
      <NoPermissionState hint="Comissões existem no contexto de um canal contábil ou da plataforma." />
    );
  }

  if (statement.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar o extrato"
        message={(statement.error as Error)?.message}
        onRetry={() => void statement.refetch()}
      />
    );
  }

  const rule = statement.data?.rule;
  const totals = statement.data?.totals;

  return (
    <Page>
      <PageHeader
        eyebrow="canal · comissões"
        title="Comissões"
        help={
          <p>
            Comissão recorrente do canal sobre a mensalidade das empresas da carteira
            {showCredit ? " e sobre o crédito antecipado" : ""}. O percentual vigente aparece
            abaixo, em "Regra vigente".
          </p>
        }
        actions={
          <div className="w-48">
            <Label className="text-xs text-muted-foreground">Mês de referência</Label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger aria-label="Mês de referência">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m} value={m}>
                    {formatMonth(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      <Rise index={1} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Comissão do mês"
          value={<MoneyText cents={totals?.commission_cents ?? 0} className="text-flow-in" />}
          hint={rule ? `${formatPct(rule.mrr_pct)} da mensalidade` : undefined}
          loading={statement.isLoading}
        />
        <KpiCard
          label="Base faturável"
          value={<MoneyText cents={totals?.mrr_cents ?? 0} />}
          hint="Soma das mensalidades ativas"
          loading={statement.isLoading}
        />
        <KpiCard
          label="Empresas faturáveis"
          value={`${totals?.billable ?? 0}`}
          hint={`de ${totals?.companies ?? 0} na carteira`}
          loading={statement.isLoading}
        />
        {showCredit ? (
          <KpiCard
            label="Comissão sobre crédito"
            value={rule ? formatPct(rule.credit_pct) : "—"}
            hint="Aplicada quando o crédito é antecipado"
            loading={statement.isLoading}
          />
        ) : null}
      </Rise>

      <Rise index={2}>
        <Panel
          title="Regra vigente"
          icon={Percent}
          help={
            <p>
              {rule
                ? showCredit
                  ? `${formatPct(rule.mrr_pct)} sobre a mensalidade de cada empresa ativa e ${formatPct(
                      rule.credit_pct,
                    )} sobre o crédito antecipado.`
                  : `${formatPct(rule.mrr_pct)} sobre a mensalidade de cada empresa ativa.`
                : "Carregando…"}
              {rule?.note ? ` — ${rule.note}` : ""}
              {!isPlatform ? " A regra é definida pela plataforma." : ""}
            </p>
          }
        >
          {isPlatform && rule ? (
            <RuleEditor
              tenantId={tenantId}
              mrrPct={rule.mrr_pct}
              creditPct={rule.credit_pct}
              showCredit={showCredit}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              {formatPct(rule?.mrr_pct ?? 0)} sobre a mensalidade
              {showCredit ? ` · ${formatPct(rule?.credit_pct ?? 0)} sobre o crédito` : ""}
            </p>
          )}
        </Panel>
      </Rise>

      <Rise index={3} className="overflow-x-auto">
        <DataTable
          columns={columns}
          data={rows}
          loading={statement.isLoading}
          searchPlaceholder="Buscar empresa, CNPJ ou plano…"
          emptyTitle="Nenhuma empresa na carteira"
          emptyHint="Cadastre empresas em Empresas para gerar comissão."
          exportName={`comissoes-${month}`}
        />
      </Rise>
    </Page>
  );
}

function RuleEditor({
  tenantId,
  mrrPct,
  creditPct,
  showCredit,
}: {
  tenantId: string;
  mrrPct: number;
  creditPct: number;
  showCredit: boolean;
}) {
  const [mrr, setMrr] = useState(String(mrrPct));
  const [credit, setCredit] = useState(String(creditPct));
  const [note, setNote] = useState("");
  const save = useSetCommissionRule(tenantId);

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const mrrValue = Number(mrr.replace(",", "."));
        const creditValue = Number(credit.replace(",", "."));
        if (Number.isNaN(mrrValue) || Number.isNaN(creditValue)) {
          toast.error("Informe percentuais válidos.");
          return;
        }
        save.mutate(
          { mrr_pct: mrrValue, credit_pct: creditValue, note },
          {
            onSuccess: () => toast.success("Regra de comissão atualizada."),
            onError: (error) => toast.error((error as Error).message),
          },
        );
      }}
    >
      <div className="w-32">
        <Label htmlFor="mrr-pct" className="text-xs text-muted-foreground">
          % mensalidade
        </Label>
        <Input id="mrr-pct" value={mrr} onChange={(e) => setMrr(e.target.value)} inputMode="decimal" />
      </div>
      {showCredit ? (
        <div className="w-32">
          <Label htmlFor="credit-pct" className="text-xs text-muted-foreground">
            % crédito
          </Label>
          <Input
            id="credit-pct"
            value={credit}
            onChange={(e) => setCredit(e.target.value)}
            inputMode="decimal"
          />
        </div>
      ) : null}
      <div className="min-w-48 flex-1">
        <Label htmlFor="rule-note" className="text-xs text-muted-foreground">
          Observação
        </Label>
        <Input
          id="rule-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex.: contrato 2026 renegociado"
        />
      </div>
      <Button type="submit" disabled={save.isPending}>
        <Save className="mr-2 size-4" aria-hidden />
        Salvar regra
      </Button>
    </form>
  );
}
