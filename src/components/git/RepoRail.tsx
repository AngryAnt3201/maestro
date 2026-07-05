import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RepositoryInfo } from "../../stores/useWorkspaceStore";

interface RepoRailProps {
  repositories: RepositoryInfo[];
  selectedRepoPath: string | null;
  onSelectRepo: (repoPath: string) => void;
}

function getRepoAbbreviation(name: string): string {
  const parts = name.split(/[-_\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

interface TooltipInfo {
  name: string;
  top: number;
  right: number;
}

export function RepoRail({ repositories, selectedRepoPath, onSelectRepo }: RepoRailProps) {
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  if (repositories.length <= 1) return null;

  const handleMouseEnter = (repo: RepositoryInfo) => {
    const el = buttonRefs.current.get(repo.path);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setTooltip({
      name: repo.name,
      top: rect.top + rect.height / 2,
      right: window.innerWidth - rect.left + 8,
    });
  };

  return (
    <div className="flex w-10 shrink-0 flex-col items-center gap-1.5 overflow-y-auto border-l border-maestro-border bg-maestro-bg py-2">
      {repositories.map((repo) => {
        const isSelected = repo.path === selectedRepoPath;
        return (
          <button
            key={repo.path}
            ref={(el) => {
              if (el) buttonRefs.current.set(repo.path, el);
              else buttonRefs.current.delete(repo.path);
            }}
            type="button"
            onClick={() => onSelectRepo(repo.path)}
            onMouseEnter={() => handleMouseEnter(repo)}
            onMouseLeave={() => setTooltip(null)}
            className={`flex h-8 w-8 items-center justify-center rounded text-[10px] font-bold transition-all ${
              isSelected
                ? "bg-maestro-accent/20 text-maestro-accent ring-1 ring-maestro-accent/50"
                : "text-maestro-muted/60 hover:bg-maestro-card hover:text-maestro-text"
            }`}
          >
            {getRepoAbbreviation(repo.name)}
          </button>
        );
      })}

      {tooltip &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[9999] -translate-y-1/2 whitespace-nowrap rounded bg-maestro-card px-2 py-1 text-xs text-maestro-text shadow-lg border border-maestro-border"
            style={{ top: tooltip.top, right: tooltip.right }}
          >
            {tooltip.name}
          </div>,
          document.body,
        )}
    </div>
  );
}
