import BrainCircuit from "lucide-react/dist/esm/icons/brain-circuit";
import Plus from "lucide-react/dist/esm/icons/plus";

interface IdleLandingViewProps {
  onAdd: () => void;
}

export function IdleLandingView({ onAdd }: IdleLandingViewProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      {/* Large centered Claude brain icon */}
      <BrainCircuit
        size={56}
        strokeWidth={1.2}
        className="motion-safe:animate-breathe motion-reduce:animate-none text-violet-500 drop-shadow-[0_0_10px_rgba(139,92,246,0.6)]"
      />

      {/* Prompt text */}
      <div className="flex flex-col items-center gap-1.5">
        <p className="text-sm text-maestro-muted">Select branch and click Launch</p>
        <p className="text-xs text-maestro-muted/50">Using current branch</p>
      </div>

      {/* Centered blue + button */}
      <button
        type="button"
        onClick={onAdd}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-maestro-accent text-white shadow-lg shadow-maestro-accent/25 transition-all duration-200 hover:bg-maestro-accent/90 hover:shadow-maestro-accent/35 hover:scale-105 active:scale-95"
        aria-label="Launch new session"
        title="Launch new session"
      >
        <Plus size={28} strokeWidth={1.5} />
      </button>
    </div>
  );
}
