import { ChevronDown, ChevronRight, Pause, Pencil, Play, ScrollText, Trash2 } from "lucide-react";
import { useState } from "react";
import { useOpsStore } from "@/stores/useOpsStore";
import type { DispatchStatus, Job } from "@/types/ops";
import { DispatchViewer } from "./DispatchViewer";
import { JobDetailPanel } from "./JobDetailPanel";

function driverBadge(j: Job) {
  if (j.driver === "claude-trigger") {
    return (
      <span className="rounded bg-[#2b1a35] px-1 py-[1px] text-[9.5px] uppercase tracking-wider text-[#c587e8]">
        Claude
      </span>
    );
  }
  return (
    <span className="rounded bg-[#1a2b3a] px-1 py-[1px] text-[9.5px] uppercase tracking-wider text-maestro-accent">
      Job
    </span>
  );
}

function statusDot(status?: DispatchStatus, enabled?: boolean) {
  const cls = "h-1.5 w-1.5 rounded-full shrink-0";
  if (!enabled) return <span className={`${cls} bg-maestro-muted/40`} />;
  switch (status) {
    case "running":
      return <span className={`${cls} bg-maestro-green animate-pulse`} />;
    case "succeeded":
      return <span className={`${cls} bg-maestro-green`} />;
    case "failed":
      return <span className={`${cls} bg-maestro-red`} />;
    case "cancelled":
    case "interrupted":
      return <span className={`${cls} bg-maestro-yellow`} />;
    default:
      return <span className={`${cls} bg-maestro-muted/60`} />;
  }
}

function nextFireLabel(j: Job): string {
  if (!j.enabled) return "paused";
  if (!j.schedule) return "manual";
  return `cron: ${j.schedule}`;
}

export function JobRow({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const { runNow, deleteJob } = useOpsStore();

  const onRun = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await runNow(job.scope, job.id, job.projectHash);
  };
  const onDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete job "${job.name}"?`)) return;
    try {
      await deleteJob(job.scope, job.id, job.projectHash);
    } catch (err) {
      window.alert(String(err));
    }
  };

  return (
    <li>
      <div
        className={`flex cursor-default select-none items-center gap-2 border-t border-maestro-border/20 px-3 py-1.5 hover:bg-maestro-card/40 ${
          open ? "bg-maestro-card/40" : ""
        }`}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown size={11} className="text-maestro-muted" />
        ) : (
          <ChevronRight size={11} className="text-maestro-muted" />
        )}
        {statusDot(job.lastDispatch?.status, job.enabled)}
        <span className="flex-1 truncate text-[12px] text-maestro-text">{job.name}</span>
        {driverBadge(job)}
        <span className="text-[10.5px] text-maestro-muted/70">{nextFireLabel(job)}</span>
        <button
          type="button"
          onClick={onRun}
          aria-label="Run now"
          className="rounded p-0.5 text-maestro-accent hover:bg-maestro-accent/10"
        >
          <Play size={11} />
        </button>
      </div>
      {open && (
        <div className="border-t border-maestro-border/20 bg-maestro-card/20 px-6 py-2 text-[11px] text-maestro-text">
          <dl className="grid grid-cols-[70px_1fr] gap-x-3 gap-y-1">
            <dt className="text-maestro-muted/70 uppercase text-[9.5px]">Driver</dt>
            <dd>{job.driver}</dd>
            <dt className="text-maestro-muted/70 uppercase text-[9.5px]">Scope</dt>
            <dd>
              {job.scope}
              {job.projectHash ? ` (${job.projectHash.slice(0, 8)})` : ""}
            </dd>
            <dt className="text-maestro-muted/70 uppercase text-[9.5px]">Schedule</dt>
            <dd>{job.schedule ?? "—"}</dd>
            {job.driver === "maestro" && job.maestro && (
              <>
                <dt className="text-maestro-muted/70 uppercase text-[9.5px]">Command</dt>
                <dd className="font-mono text-[10.5px]">
                  {job.maestro.command} {job.maestro.args.join(" ")}
                </dd>
              </>
            )}
            {job.driver === "claude-trigger" && job.claudeTrigger && (
              <>
                <dt className="text-maestro-muted/70 uppercase text-[9.5px]">Prompt</dt>
                <dd className="whitespace-pre-wrap text-[10.5px] text-[#c587e8]">
                  {job.claudeTrigger.prompt}
                </dd>
              </>
            )}
            {job.lastDispatch && (
              <>
                <dt className="text-maestro-muted/70 uppercase text-[9.5px]">Last run</dt>
                <dd>
                  {new Date(job.lastDispatch.startedAt * 1000).toLocaleString()} —{" "}
                  {job.lastDispatch.status}
                </dd>
              </>
            )}
            {job.lastDispatch?.tokens != null && (
              <>
                <dt className="text-maestro-muted/70 uppercase text-[9.5px]">Tokens</dt>
                <dd>{job.lastDispatch.tokens.toLocaleString()}</dd>
              </>
            )}
          </dl>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={onRun}
              className="rounded border border-maestro-border bg-maestro-accent/10 px-2 py-0.5 text-[10.5px] text-maestro-accent"
            >
              <Play size={11} className="inline mr-1" /> Run now
            </button>
            <button
              type="button"
              className="rounded border border-maestro-border px-2 py-0.5 text-[10.5px] text-maestro-muted"
              aria-label="Pause (Stage 2)"
            >
              <Pause size={11} className="inline mr-1" /> {job.enabled ? "Pause" : "Resume"}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDetailOpen(true);
              }}
              className="rounded border border-maestro-border px-2 py-0.5 text-[10.5px] text-maestro-muted"
            >
              <Pencil size={11} className="inline mr-1" /> Edit
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setViewerOpen(true);
              }}
              className="rounded border border-maestro-border px-2 py-0.5 text-[10.5px] text-maestro-muted"
            >
              <ScrollText size={11} className="inline mr-1" /> Log
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label="Delete job"
              className="ml-auto rounded border border-maestro-red/50 bg-maestro-red/10 px-2 py-0.5 text-[10.5px] text-maestro-red"
            >
              <Trash2 size={11} className="inline mr-1" /> Delete
            </button>
          </div>
        </div>
      )}
      {detailOpen && (
        <div
          className="fixed inset-0 z-40 flex items-stretch justify-end bg-black/40"
          onClick={() => setDetailOpen(false)}
        >
          <div
            className="w-[420px] bg-maestro-surface border-l border-maestro-border"
            onClick={(e) => e.stopPropagation()}
          >
            <JobDetailPanel job={job} onClose={() => setDetailOpen(false)} />
          </div>
        </div>
      )}
      {viewerOpen && (
        <DispatchViewer
          job={job}
          dispatchId={job.lastDispatch?.id}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </li>
  );
}
