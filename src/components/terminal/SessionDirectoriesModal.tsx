import { FolderOpen, Plus, Shield, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { pickProjectFolder } from "@/lib/dialog";

interface SessionDirectoriesModalProps {
  projectPath: string;
  additionalDirs: string[];
  onClose: () => void;
  onAddDir: (path: string) => void;
}

/** Shortens a path for display, showing the last 2 segments. */
function shortenPath(fullPath: string): string {
  const parts = fullPath.split("/").filter(Boolean);
  if (parts.length <= 2) return fullPath;
  return `.../${parts.slice(-2).join("/")}`;
}

/**
 * Modal for viewing and adding directories to a Claude Code session.
 * Shows the primary project directory and any additional directories added via /add-dir.
 */
export function SessionDirectoriesModal({
  projectPath,
  additionalDirs,
  onClose,
  onAddDir,
}: SessionDirectoriesModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleAddDirectory = async () => {
    const selected = await pickProjectFolder();
    if (!selected) return;
    // Deduplicate: skip if already the project path or already added
    if (selected === projectPath) return;
    if (additionalDirs.includes(selected)) return;
    onAddDir(selected);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        ref={modalRef}
        className="w-full max-w-md rounded-lg border border-maestro-border bg-maestro-bg shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-maestro-border px-4 py-3">
          <div className="flex items-center gap-2">
            <FolderOpen size={16} className="text-maestro-accent" />
            <h2 className="text-sm font-semibold text-maestro-text">Session Directories</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-maestro-border/40"
          >
            <X size={16} className="text-maestro-muted" />
          </button>
        </div>

        {/* Directory List */}
        <div className="max-h-64 overflow-y-auto p-4">
          <div className="space-y-2">
            {/* Primary directory */}
            <div className="flex items-center gap-2 rounded-lg border border-maestro-border bg-maestro-card p-2.5">
              <FolderOpen size={14} className="shrink-0 text-maestro-accent" />
              <span className="flex-1 truncate text-sm text-maestro-text" title={projectPath}>
                {shortenPath(projectPath)}
              </span>
              <span className="flex items-center gap-1 rounded bg-maestro-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-maestro-accent">
                <Shield size={8} />
                Primary
              </span>
            </div>

            {/* Additional directories */}
            {additionalDirs.map((dir) => (
              <div
                key={dir}
                className="flex items-center gap-2 rounded-lg border border-maestro-border bg-maestro-card p-2.5"
              >
                <FolderOpen size={14} className="shrink-0 text-maestro-green" />
                <span className="flex-1 truncate text-sm text-maestro-text" title={dir}>
                  {shortenPath(dir)}
                </span>
                <span className="rounded bg-maestro-green/20 px-1.5 py-0.5 text-[10px] font-medium text-maestro-green">
                  Added
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-maestro-border px-4 py-3">
          <button
            type="button"
            onClick={handleAddDirectory}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-maestro-border px-3 py-2 text-xs font-medium text-maestro-muted transition-colors hover:border-maestro-accent hover:bg-maestro-accent/10 hover:text-maestro-accent"
          >
            <Plus size={12} />
            Add Directory
          </button>
          <p className="mt-2 text-center text-[10px] text-maestro-muted">
            Sends <code className="rounded bg-maestro-border/40 px-1">/add-dir</code> to the session
          </p>
        </div>
      </div>
    </div>
  );
}
