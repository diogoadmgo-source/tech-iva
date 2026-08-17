import { Progress } from "@/components/ui/progress";
import { jobKindLabel, JOB_STATUS_LABELS, type JobStatus } from "@/lib/jobs";
import { cn } from "@/lib/utils";

export type JobLike = {
  id: string;
  kind: string;
  status: JobStatus | string;
  progress?: number | null | undefined;
  message?: string | null | undefined;
  error?: string | null | undefined;
  started_at?: string | null | undefined;
};

function eta(job: JobLike) {
  const pct = Number(job.progress ?? 0);
  if (!job.started_at || pct <= 2 || pct >= 100) return null;
  const elapsed = (Date.now() - new Date(job.started_at).getTime()) / 1000;
  const remaining = Math.round((elapsed / pct) * (100 - pct));
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  return remaining > 90 ? `~${Math.round(remaining / 60)} min restantes` : `~${remaining}s restantes`;
}

export function JobProgress({ job, className }: { job: JobLike; className?: string | undefined }) {
  const pct = Number(job.progress ?? 0);
  const failed = job.status === "failed";
  const remaining = eta(job);
  return (
    <div className={cn("rounded-lg border border-border bg-surface-1 p-3", className)}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{jobKindLabel(job.kind)}</span>
        <span className={cn("text-xs", failed ? "text-destructive" : "text-muted-foreground")}>
          {JOB_STATUS_LABELS[job.status as JobStatus] ?? job.status}
        </span>
      </div>
      <Progress value={pct} className={cn("mt-2 h-1.5", failed && "[&>div]:bg-destructive")} />
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="truncate">{job.error ?? job.message ?? "—"}</span>
        <span className="font-mono tabular whitespace-nowrap">
          {remaining ?? `${pct.toFixed(0)}%`}
        </span>
      </div>
    </div>
  );
}
