import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { useOpsStore } from "@/stores/useOpsStore";

function timeAgo(ms: number): string {
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function LiveTriggersList() {
  const triggers = useOpsStore((s) => s.externalTriggers);
  const loadedAt = useOpsStore((s) => s.externalTriggersLoadedAt);
  const load = useOpsStore((s) => s.loadExternalTriggers);
  const jobsByScope = useOpsStore((s) => s.jobsByScope);

  useEffect(() => {
    if (!loadedAt) load();
    const iv = globalThis.setInterval(() => load(), 5 * 60 * 1000);
    return () => globalThis.clearInterval(iv);
  }, [loadedAt, load]);

  // IDs of triggers we already manage locally — hide duplicates.
  const locallyKnown = new Set<string>();
  for (const list of Object.values(jobsByScope)) {
    for (const j of list) {
      if (j.driver === "claude-trigger" && j.claudeTrigger?.triggerId) {
        locallyKnown.add(j.claudeTrigger.triggerId);
      }
    }
  }
  const unmanaged = triggers.filter((t) => !locallyKnown.has(t.externalId));

  return (
    <div className="border-b border-maestro-border/20">
      <div className="flex items-center gap-2 px-3 py-1.5 text-[10.5px] uppercase tracking-wider text-maestro-muted">
        <span>Live /schedule triggers</span>
        <span className="text-maestro-muted/60">{triggers.length}</span>
        <button
          type="button"
          onClick={() => load()}
          aria-label="Refresh triggers"
          className="ml-auto rounded p-0.5 text-maestro-accent hover:bg-maestro-accent/10"
        >
          <RefreshCw size={11} />
        </button>
        {loadedAt && <span className="text-maestro-muted/50">{timeAgo(loadedAt)}</span>}
      </div>
      {triggers.length === 0 ? (
        <p className="px-4 pb-2 text-[10.5px] text-maestro-muted/60">No remote triggers.</p>
      ) : (
        <ul>
          {unmanaged.map((t) => (
            <li key={t.externalId} className="flex items-center gap-2 px-3 py-1 text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#c587e8]" />
              <span className="flex-1 truncate text-maestro-text">{t.name}</span>
              <span className="font-mono text-[10.5px] text-maestro-muted/70">
                {t.schedule ?? "—"}
              </span>
              <span className="text-[9.5px] uppercase tracking-wider text-maestro-muted/60">
                unmanaged
              </span>
            </li>
          ))}
          {locallyKnown.size > 0 && (
            <li className="px-3 py-1 text-[10.5px] text-maestro-muted/50">
              {locallyKnown.size} trigger{locallyKnown.size === 1 ? "" : "s"} shown above as managed
              jobs
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
