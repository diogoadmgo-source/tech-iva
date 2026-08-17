import { Activity, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
  JOB_STATUS_LABELS,
  jobKindLabel,
  useActiveJobs,
  useCancelJob,
  useRetryJob,
  type Job,
} from "@/lib/jobs";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  queued: "secondary",
  running: "default",
  done: "outline",
  failed: "destructive",
  canceled: "outline",
};

function relative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

export function JobCenter({ tenantId }: { tenantId: string }) {
  const { jobs, active } = useActiveJobs(tenantId);
  const cancel = useCancelJob(tenantId);
  const retry = useRetryJob(tenantId);

  const onCancel = (job: Job) =>
    cancel.mutate(job.id, {
      onSuccess: () => toast.success("Processamento cancelado"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao cancelar"),
    });

  const onRetry = (job: Job) =>
    retry.mutate(job, {
      onSuccess: () => toast.success("Processamento reenfileirado"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao reenfileirar"),
    });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Processamentos">
          <Activity className="size-4" />
          {active.length > 0 ? (
            <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-primary font-mono text-[9px] text-primary-foreground">
              {active.length}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-medium text-foreground">Processamentos</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {active.length > 0
              ? `${active.length} em andamento nesta organização`
              : "Nenhum processamento em andamento"}
          </p>
        </div>

        <div className="max-h-80 divide-y divide-border overflow-y-auto">
          {jobs.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              Nada por aqui ainda. Importações e cálculos aparecem nesta lista em tempo real.
            </p>
          ) : (
            jobs.map((job) => (
              <div key={job.id} className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{jobKindLabel(job.kind)}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {relative(job.queued_at)} · {JOB_STATUS_LABELS[job.status]}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant={STATUS_VARIANT[job.status] ?? "outline"}>
                      {JOB_STATUS_LABELS[job.status]}
                    </Badge>
                    {job.status === "queued" || job.status === "running" ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label="Cancelar"
                        onClick={() => onCancel(job)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    ) : null}
                    {job.status === "failed" ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label="Tentar de novo"
                        onClick={() => onRetry(job)}
                      >
                        <RotateCcw className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>

                {job.status === "running" ? (
                  <Progress value={Number(job.progress ?? 0)} className="h-1.5" />
                ) : null}

                {job.message ? (
                  <p className="text-xs text-muted-foreground">{job.message}</p>
                ) : null}
                {job.error ? (
                  <p className="font-mono text-[11px] text-destructive">{job.error}</p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
