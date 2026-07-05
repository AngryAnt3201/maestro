import type { WorktreeMode } from "@/components/terminal/PreLaunchCard/PreLaunchCard.types";

const WORKTREE_MODE_LABELS: Record<WorktreeMode, string> = {
  auto: "Current Worktree",
  project: "Original Path",
  new: "New Worktree",
};

const WORKTREE_MODES: WorktreeMode[] = ["auto", "project", "new"];

interface WorktreeModeSelectorProps {
  mode: WorktreeMode;
  hasManagedWorktree: boolean;
  onChange: (mode: WorktreeMode) => void;
}

export function WorktreeModeSelector({
  mode,
  hasManagedWorktree,
  onChange,
}: WorktreeModeSelectorProps) {
  return (
    <div>
      <div className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-maestro-muted">
        Working Directory
      </div>
      <div className="flex gap-1">
        {WORKTREE_MODES.map((nextMode) => {
          const isActive = mode === nextMode;
          const isDisabled = nextMode === "auto" && !hasManagedWorktree;
          return (
            <button
              key={nextMode}
              type="button"
              disabled={isDisabled}
              onClick={() => !isDisabled && onChange(nextMode)}
              title={isDisabled ? "No managed worktree exists for this project" : undefined}
              className={`flex-1 rounded px-2 py-1.5 text-[11px] font-medium transition-colors ${
                isDisabled
                  ? "border border-maestro-border bg-maestro-card text-maestro-muted opacity-40 cursor-not-allowed"
                  : isActive
                    ? "bg-maestro-accent text-white"
                    : "border border-maestro-border bg-maestro-card text-maestro-muted hover:text-maestro-text hover:border-maestro-accent/50"
              }`}
            >
              {WORKTREE_MODE_LABELS[nextMode]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
