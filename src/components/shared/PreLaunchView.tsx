import FolderOpen from "lucide-react/dist/esm/icons/folder-open";

interface PreLaunchViewProps {
  onSelectProject: () => void;
}

export function PreLaunchView({ onSelectProject }: PreLaunchViewProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      <div className="flex flex-col items-center gap-3">
        <div className="rounded-2xl bg-maestro-surface p-6">
          <FolderOpen size={48} className="text-maestro-accent" />
        </div>
        <h1 className="text-2xl font-bold text-maestro-text">Welcome to Maestro</h1>
        <p className="max-w-md text-center text-sm text-maestro-muted">
          Multi-session AI orchestrator for Linux. Open a project to get started with Claude,
          Gemini, or Codex sessions.
        </p>
      </div>

      <button
        type="button"
        onClick={onSelectProject}
        className="flex items-center gap-2 rounded-lg bg-maestro-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500"
      >
        <FolderOpen size={16} />
        Open Project
      </button>

      <div className="mt-8 grid grid-cols-3 gap-6 text-center text-xs text-maestro-muted">
        <div>
          <div className="mb-1 text-lg font-bold text-maestro-text">12</div>
          <div>Max Sessions</div>
        </div>
        <div>
          <div className="mb-1 text-lg font-bold text-maestro-text">4</div>
          <div>AI Modes</div>
        </div>
        <div>
          <div className="mb-1 text-lg font-bold text-maestro-text">Git</div>
          <div>Worktrees</div>
        </div>
      </div>
    </div>
  );
}
