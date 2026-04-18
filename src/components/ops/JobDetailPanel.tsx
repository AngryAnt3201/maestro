import { X } from "lucide-react";
import type { Job } from "@/types/ops";
import { useOpsStore } from "@/stores/useOpsStore";

interface Props {
  job: Job;
  onClose: () => void;
}

export function JobDetailPanel({ job, onClose }: Props) {
  const deleteJob = useOpsStore((s) => s.deleteJob);
  const runNow = useOpsStore((s) => s.runNow);

  return (
    <div className="flex min-w-[320px] flex-1 flex-col">
      <header className="flex items-center border-b border-maestro-border px-4 py-2">
        <h2 className="text-[13px] font-semibold text-maestro-text">{job.name}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-maestro-muted hover:text-maestro-text">
          <X size={14} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-4 text-[11px] text-maestro-text">
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
          <dt className="text-maestro-muted">Driver</dt><dd>{job.driver}</dd>
          <dt className="text-maestro-muted">Scope</dt><dd>{job.scope}{job.projectHash ? ` (${job.projectHash.slice(0, 8)})` : ""}</dd>
          <dt className="text-maestro-muted">Schedule</dt><dd className="font-mono">{job.schedule ?? "—"}</dd>
          <dt className="text-maestro-muted">Enabled</dt><dd>{job.enabled ? "yes" : "no"}</dd>
          {job.driver === "maestro" && job.maestro && (
            <>
              <dt className="text-maestro-muted">Command</dt><dd className="font-mono">{job.maestro.command}</dd>
              <dt className="text-maestro-muted">Args</dt><dd className="font-mono">{job.maestro.args.join(" ")}</dd>
              {job.maestro.cwd && (<><dt className="text-maestro-muted">Cwd</dt><dd className="font-mono">{job.maestro.cwd}</dd></>)}
            </>
          )}
          {job.driver === "claude-trigger" && job.claudeTrigger && (
            <>
              <dt className="text-maestro-muted">Trigger ID</dt><dd className="font-mono text-[10.5px]">{job.claudeTrigger.triggerId ?? "—"}</dd>
              <dt className="text-maestro-muted">Prompt</dt><dd className="whitespace-pre-wrap">{job.claudeTrigger.prompt}</dd>
              <dt className="text-maestro-muted">Connectors</dt><dd>{job.claudeTrigger.mcpConnectors.join(", ") || "—"}</dd>
            </>
          )}
        </dl>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => runNow(job.scope, job.id, job.projectHash)}
            className="rounded bg-maestro-accent/20 px-3 py-1.5 text-[11px] text-maestro-accent"
          >
            Run now
          </button>
          {job.driver === "claude-trigger" && (
            <a
              href="https://claude.ai/code/scheduled"
              target="_blank"
              rel="noreferrer"
              className="rounded border border-maestro-border px-3 py-1.5 text-[11px] text-maestro-muted"
            >
              Manage on claude.ai →
            </a>
          )}
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm(`Delete job "${job.name}"?`)) return;
              try {
                await deleteJob(job.scope, job.id, job.projectHash);
                onClose();
              } catch (e) {
                window.alert(String(e));
              }
            }}
            className="ml-auto rounded border border-maestro-red/50 bg-maestro-red/10 px-3 py-1.5 text-[11px] text-maestro-red"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
