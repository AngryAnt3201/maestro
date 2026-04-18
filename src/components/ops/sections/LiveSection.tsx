import { useEffect, useState } from "react";
import { useOpsStore } from "@/stores/useOpsStore";
import { OpsSection } from "../OpsSection";

function formatElapsed(startedAt: number): string {
  const ms = Math.max(0, Date.now() - startedAt);
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

export function LiveSection() {
  const live = useOpsStore((s) => s.live);
  const jobsByScope = useOpsStore((s) => s.jobsByScope);
  const [, force] = useState(0);

  useEffect(() => {
    if (Object.keys(live).length === 0) return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [live]);

  const entries = Object.values(live);
  if (entries.length === 0) return null;

  const jobName = (id: string): string => {
    for (const list of Object.values(jobsByScope)) {
      const j = list.find((j) => j.id === id);
      if (j) return j.name;
    }
    return id;
  };

  return (
    <OpsSection title="Live" count={`${entries.length} running`}>
      <ul>
        {entries.map((r) => (
          <li key={r.dispatchId} className="flex items-center gap-2 px-3 py-1.5 hover:bg-maestro-card/40">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-maestro-green" />
            <span className="flex-1 truncate text-[12px] text-maestro-text">{jobName(r.jobId)}</span>
            {r.lastLine && (
              <span className="truncate font-mono text-[10.5px] text-maestro-muted/70 max-w-[240px]">
                {r.lastLine}
              </span>
            )}
            <span className="text-[10.5px] tabular-nums text-maestro-muted/80">{formatElapsed(r.startedAt)}</span>
          </li>
        ))}
      </ul>
    </OpsSection>
  );
}
