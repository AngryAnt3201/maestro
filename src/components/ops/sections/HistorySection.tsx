import { useMemo } from "react";
import { useOpsStore } from "@/stores/useOpsStore";
import { OpsSection } from "../OpsSection";

interface Props {
  projectHash?: string;
}

function statusIcon(s: string): string {
  switch (s) {
    case "succeeded":
      return "✓";
    case "failed":
      return "✗";
    case "cancelled":
    case "interrupted":
      return "⏸";
    case "running":
      return "●";
    default:
      return "•";
  }
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function HistorySection({ projectHash }: Props) {
  const map = useOpsStore((s) => s.dispatchesByScope);
  const all = useMemo(() => {
    const g = map.global ?? [];
    const p = projectHash ? (map[`project:${projectHash}`] ?? []) : [];
    return [...g, ...p].sort((a, b) => b.startedAt - a.startedAt).slice(0, 30);
  }, [map, projectHash]);

  return (
    <OpsSection
      title="History"
      count={all.length ? `last ${all.length}` : "empty"}
      defaultOpen={false}
    >
      {all.length === 0 ? (
        <div className="px-4 py-3 text-center text-[11px] text-maestro-muted/60">
          No dispatches yet.
        </div>
      ) : (
        <ul>
          {all.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-2 border-t border-maestro-border/20 px-3 py-1 text-[11px]"
            >
              <span
                className={`w-3 text-center ${d.status === "failed" ? "text-maestro-red" : d.status === "succeeded" ? "text-maestro-green" : "text-maestro-muted"}`}
              >
                {statusIcon(d.status)}
              </span>
              <span className="w-20 tabular-nums text-maestro-muted">{timeAgo(d.startedAt)}</span>
              <span className="flex-1 truncate font-mono text-[10.5px] text-maestro-muted/80">
                {d.outputHead.split("\n")[0] || d.jobId}
              </span>
            </li>
          ))}
        </ul>
      )}
    </OpsSection>
  );
}
