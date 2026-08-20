import { Building2, Layers } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/techiva/empty-state";
import { Panel, Rise } from "@/components/techiva/page";
import {
  LIMIT_LABELS,
  formatCents,
  statusLabel,
  useScopePlans,
  useTenantPlan,
  type EffectivePlan,
  type PlanLimits,
} from "@/lib/plans";

const LIMIT_KEYS: (keyof PlanLimits)[] = ["companies", "users", "invoices_month"];

function statusVariant(status: string): "secondary" | "outline" | "destructive" {
  if (status === "active" || status === "trialing") return "secondary";
  if (status === "past_due") return "destructive";
  return "outline";
}

function LimitBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const excedido = used > limit;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span
          className={`font-mono text-xs ${excedido ? "text-destructive" : "text-foreground"}`}
        >
          {used.toLocaleString("pt-BR")} / {limit.toLocaleString("pt-BR")}
        </span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

/** Cartão do plano vigente do tenant aberto, com herança e consumo. */
export function PlanEntitlementCard({ tenantId }: { tenantId: string }) {
  const query = useTenantPlan(tenantId);
  const data = query.data;

  return (
    <Panel
      title="Plano desta organização"
      icon={Layers}
      help={
        <p>
          O plano vale para a empresa e suas unidades. Quando a assinatura está no canal ou na
          plataforma acima, a empresa herda o mesmo plano e os limites são medidos no conjunto de
          empresas cobertas por aquela assinatura.
        </p>
      }
    >
      {query.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : !data?.plano ? (
        <EmptyState title="Sem assinatura vinculada" />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-lg font-medium text-foreground">{data.plano.name}</span>
            <span className="font-mono text-sm text-muted-foreground">
              {formatCents(data.plano.price_cents)}
            </span>
            {data.assinatura ? (
              <Badge variant={statusVariant(data.assinatura.status)}>
                {statusLabel(data.assinatura.status)}
              </Badge>
            ) : null}
            {data.herdado_de ? (
              <Badge variant="outline">herdado de {data.herdado_de.name}</Badge>
            ) : null}
          </div>

          {data.assinatura?.ends_at ? (
            <p className="font-mono text-xs text-muted-foreground">
              acesso até {new Date(data.assinatura.ends_at).toLocaleDateString("pt-BR")}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-3">
            {LIMIT_KEYS.filter((k) => typeof data.plano?.limits?.[k] === "number").map((key) => (
              <LimitBar
                key={key}
                label={LIMIT_LABELS[key]}
                used={data.uso?.[key] ?? 0}
                limit={data.plano?.limits?.[key] ?? 0}
              />
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {Object.entries(data.plano.features ?? {}).map(([key, on]) => (
              <Badge key={key} variant={on ? "secondary" : "outline"}>
                {key}
                {on ? "" : " · off"}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

function planSummary(p: EffectivePlan): string {
  if (!p.plano) return "sem plano";
  return p.herdado_de ? `${p.plano.name} (via ${p.herdado_de.name})` : p.plano.name;
}

/** Empresas do escopo e o plano efetivo de cada uma (visão canal/plataforma). */
export function ScopePlansTable({ tenantId }: { tenantId: string }) {
  const query = useScopePlans(tenantId);
  const rows = query.data ?? [];

  return (
    <Panel
      title="Empresas e planos"
      icon={Building2}
      help={
        <p>
          Cada empresa do escopo com o plano que enxerga no app. Empresas sem assinatura própria
          aparecem com o plano herdado da organização acima.
        </p>
      }
    >
      {query.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState title="Nenhuma empresa no escopo" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Notas no mês</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <span className="text-foreground">{row.name}</span>
                    {row.cnpj ? (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {row.cnpj}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm">{planSummary(row.plano)}</TableCell>
                  <TableCell>
                    {row.plano.assinatura ? (
                      <Badge variant={statusVariant(row.plano.assinatura.status)}>
                        {statusLabel(row.plano.assinatura.status)}
                      </Badge>
                    ) : (
                      <Badge variant="outline">sem assinatura</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {(row.plano.uso?.invoices_month ?? 0).toLocaleString("pt-BR")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}

/** Bloco pronto para a tela de assinatura: plano do tenant + escopo. */
export function PlanEntitlementSection({
  tenantId,
  showScope,
}: {
  tenantId: string;
  showScope: boolean;
}) {
  return (
    <>
      <Rise index={1}>
        <PlanEntitlementCard tenantId={tenantId} />
      </Rise>
      {showScope ? (
        <Rise index={2}>
          <ScopePlansTable tenantId={tenantId} />
        </Rise>
      ) : null}
    </>
  );
}
