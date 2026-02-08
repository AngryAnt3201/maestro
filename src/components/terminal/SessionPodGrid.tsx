import { BrainCircuit } from "lucide-react";

interface SessionPodGridProps {
  sessionCount?: number;
}

export function SessionPodGrid({ sessionCount = 6 }: SessionPodGridProps) {
  const count = Math.max(1, sessionCount);
  const pods = Array.from({ length: count }, (_, i) => i + 1);

  const gridClass = count <= 1 ? "grid-cols-1" : count <= 4 ? "grid-cols-2" : "grid-cols-3";

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      {/* Pod grid in dashed container */}
      <div className="rounded-2xl border-2 border-dashed border-maestro-border/60 p-5">
        <div className={`grid ${gridClass} gap-4`}>
          {pods.map((n) => (
            <div
              key={n}
              className="pod-grid-card group flex w-24 flex-col items-center gap-2 rounded-xl border border-maestro-border bg-maestro-card p-5 shadow-[0_2px_8px_rgb(0_0_0/0.2)] transition-all hover:border-maestro-muted/40 hover:shadow-[0_4px_16px_rgb(0_0_0/0.3)]"
            >
              <BrainCircuit
                size={28}
                strokeWidth={1.5}
                className="motion-safe:animate-breathe motion-reduce:animate-none text-violet-500 drop-shadow-[0_0_6px_rgba(139,92,246,0.6)]"
              />
              <span className="text-lg font-semibold text-maestro-text">#{n}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Status labels below each pod */}
      {/* TODO: Replace static "Idle" with actual per-pod status from session store */}
      <div className={`grid ${gridClass} gap-4`}>
        {pods.map((n) => (
          <div key={n} className="w-24 text-center">
            <span className="text-[11px] text-maestro-muted">Idle</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-maestro-muted/70">
        Select a directory to launch Claude Code instances
      </p>
    </div>
  );
}
