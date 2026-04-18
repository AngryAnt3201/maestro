import { useEffect, useState, useCallback } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { HookEntry, HooksSnapshot } from "@/types/ops";
import { readHooks, toggleHook } from "@/lib/ops";

interface Props { projectPath?: string }

export function HooksSubSection({ projectPath }: Props) {
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState<HooksSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSnap(await readHooks(projectPath));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [projectPath]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const all: HookEntry[] = snap ? [...snap.global, ...snap.project] : [];

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-default items-center gap-1.5 px-4 py-1.5 text-left text-[11px] text-maestro-muted hover:bg-maestro-card/30"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="flex-1">Hooks</span>
        <span className="text-[10.5px] text-maestro-muted/60">{snap ? all.length : "…"}</span>
      </button>
      {open && (
        <div>
          {error && <p className="px-4 py-1 text-[10.5px] text-maestro-red">{error}</p>}
          {snap && all.length === 0 && (
            <p className="px-4 py-2 text-[10.5px] text-maestro-muted/60">No hooks configured.</p>
          )}
          <ul>
            {all.map((h) => (
              <li key={h.id} className="flex items-center gap-2 border-t border-maestro-border/10 px-4 py-1">
                <span className={`h-1.5 w-1.5 rounded-full ${h.enabled ? "bg-maestro-green" : "bg-maestro-muted/40"}`} />
                <span className="w-16 text-[9.5px] uppercase tracking-wider text-maestro-muted">{h.scope}</span>
                <span className="w-28 text-[10.5px] text-maestro-text">{h.event}</span>
                <span className="flex-1 truncate font-mono text-[10.5px] text-maestro-muted/80">{h.command}</span>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await toggleHook(h.scope === "project" ? projectPath : undefined, h.id, !h.enabled);
                      await load();
                    } catch (e) {
                      window.alert(String(e));
                    }
                  }}
                  className="text-[10.5px] text-maestro-accent hover:underline"
                >
                  {h.enabled ? "disable" : "enable"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
