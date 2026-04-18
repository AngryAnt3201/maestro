import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { readLogTail } from "@/lib/ops";
import type { DispatchOutputEvent, DispatchFinishedEvent, Job } from "@/types/ops";

interface Props {
  job: Job;
  /** dispatchId to watch live, or the latest dispatch id to read from disk */
  dispatchId?: string;
  onClose: () => void;
}

export function DispatchViewer({ job, dispatchId, onClose }: Props) {
  const [lines, setLines] = useState<string>("");
  const [live, setLive] = useState<boolean>(!!dispatchId);
  const prev = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!dispatchId) return;
      try {
        const tail = await readLogTail(job.scope, dispatchId, job.projectHash, 64 * 1024);
        if (!cancelled) { setLines(tail); prev.current = tail; }
      } catch (_e) {
        // file might not exist yet
      }
    })();
    return () => { cancelled = true; };
  }, [dispatchId, job.scope, job.projectHash]);

  useEffect(() => {
    if (!dispatchId) return;
    let unlistenOut: (() => void) | null = null;
    let unlistenFin: (() => void) | null = null;
    (async () => {
      unlistenOut = await listen<DispatchOutputEvent>("ops://dispatch-output", (e) => {
        if (e.payload.dispatchId === dispatchId) {
          prev.current += e.payload.chunk;
          setLines(prev.current);
        }
      });
      unlistenFin = await listen<DispatchFinishedEvent>("ops://dispatch-finished", (e) => {
        if (e.payload.dispatchId === dispatchId) setLive(false);
      });
    })();
    return () => { unlistenOut?.(); unlistenFin?.(); };
  }, [dispatchId]);

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-end bg-black/40" onClick={onClose}>
      <div className="flex w-[560px] flex-col border-l border-maestro-border bg-maestro-surface" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-2 border-b border-maestro-border px-4 py-2">
          <h2 className="text-[12px] font-semibold text-maestro-text">{job.name}</h2>
          {live && <span className="rounded bg-maestro-green/15 px-1.5 py-[1px] text-[9.5px] uppercase tracking-wider text-maestro-green">Live</span>}
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-maestro-muted hover:text-maestro-text">
            <X size={14} />
          </button>
        </header>
        <pre className="flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] text-maestro-text">
          {lines || <span className="text-maestro-muted">No output yet.</span>}
        </pre>
        {job.driver === "claude-trigger" && (
          <div className="border-t border-maestro-border px-4 py-2 text-[10.5px] text-maestro-muted">
            Full trigger logs live on{" "}
            <a href="https://claude.ai/code/scheduled" target="_blank" rel="noreferrer" className="text-maestro-accent underline">
              claude.ai/code/scheduled
            </a>.
          </div>
        )}
      </div>
    </div>
  );
}
