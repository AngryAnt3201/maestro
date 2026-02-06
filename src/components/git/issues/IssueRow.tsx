import { CircleDot, CheckCircle2 } from "lucide-react";
import { useMemo } from "react";
import type { IssueInfo } from "../../../stores/useGitHubStore";

interface IssueRowProps {
  issue: IssueInfo;
  isSelected: boolean;
  onClick: () => void;
}

export function IssueRow({ issue, isSelected, onClick }: IssueRowProps) {
  // Format relative time
  const relativeTime = useMemo(() => {
    const now = Date.now();
    const issueTime = new Date(issue.createdAt).getTime();
    const diff = now - issueTime;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (years > 0) return `${years}y`;
    if (months > 0) return `${months}mo`;
    if (weeks > 0) return `${weeks}w`;
    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return "now";
  }, [issue.createdAt]);

  const isOpen = issue.state.toUpperCase() === "OPEN";
  const StateIcon = isOpen ? CircleDot : CheckCircle2;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 border-b border-maestro-border/30 px-3 py-2 text-left transition-colors ${
        isSelected
          ? "bg-maestro-accent/20 hover:bg-maestro-accent/25"
          : "hover:bg-maestro-card/50"
      }`}
    >
      {/* State icon */}
      <div
        className={`shrink-0 rounded p-1 ${
          isOpen ? "bg-green-500/20" : "bg-purple-500/20"
        }`}
      >
        <StateIcon
          size={14}
          className={isOpen ? "text-green-400" : "text-purple-400"}
        />
      </div>

      {/* Title and labels */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs text-maestro-text">{issue.title}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-maestro-muted">
          <span className="font-mono">#{issue.number}</span>
          <span>by {issue.author.login}</span>
          {issue.labels.length > 0 && (
            <div className="flex items-center gap-1">
              {issue.labels.slice(0, 2).map((label) => (
                <span
                  key={label.name}
                  className="rounded px-1 py-0.5 text-[9px]"
                  style={{
                    backgroundColor: `#${label.color}20`,
                    color: `#${label.color}`,
                  }}
                >
                  {label.name}
                </span>
              ))}
              {issue.labels.length > 2 && (
                <span className="text-maestro-muted/60">
                  +{issue.labels.length - 2}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Relative time */}
      <span className="w-8 shrink-0 text-right text-[10px] text-maestro-muted/60">
        {relativeTime}
      </span>
    </button>
  );
}
