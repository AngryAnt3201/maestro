import { GitPullRequest, GitMerge, XCircle, FileEdit } from "lucide-react";
import { useMemo } from "react";
import type { PullRequestInfo } from "../../../stores/useGitHubStore";

interface PullRequestRowProps {
  pr: PullRequestInfo;
  isSelected: boolean;
  onClick: () => void;
}

export function PullRequestRow({ pr, isSelected, onClick }: PullRequestRowProps) {
  // Format relative time
  const relativeTime = useMemo(() => {
    const now = Date.now();
    const prTime = new Date(pr.createdAt).getTime();
    const diff = now - prTime;

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
  }, [pr.createdAt]);

  // Get state icon and color
  const stateInfo = useMemo(() => {
    const state = pr.state.toUpperCase();
    if (state === "MERGED") {
      return {
        icon: GitMerge,
        color: "text-purple-400",
        bgColor: "bg-purple-500/20",
      };
    }
    if (state === "CLOSED") {
      return {
        icon: XCircle,
        color: "text-red-400",
        bgColor: "bg-red-500/20",
      };
    }
    // OPEN
    return {
      icon: GitPullRequest,
      color: pr.isDraft ? "text-maestro-muted" : "text-green-400",
      bgColor: pr.isDraft ? "bg-maestro-muted/20" : "bg-green-500/20",
    };
  }, [pr.state, pr.isDraft]);

  const StateIcon = stateInfo.icon;

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
      <div className={`shrink-0 rounded p-1 ${stateInfo.bgColor}`}>
        <StateIcon size={14} className={stateInfo.color} />
      </div>

      {/* Title and branch info */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          {pr.isDraft && (
            <span className="shrink-0 rounded bg-maestro-muted/20 px-1 py-0.5 text-[10px] font-medium text-maestro-muted">
              Draft
            </span>
          )}
          <span className="truncate text-xs text-maestro-text">{pr.title}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-maestro-muted">
          <span className="font-mono">#{pr.number}</span>
          <span className="truncate">
            {pr.headRefName} → {pr.baseRefName}
          </span>
        </div>
      </div>

      {/* Changes indicator */}
      <div className="flex shrink-0 items-center gap-1 text-[10px]">
        <FileEdit size={10} className="text-maestro-muted" />
        <span className="text-green-400">+{pr.additions}</span>
        <span className="text-red-400">-{pr.deletions}</span>
      </div>

      {/* Relative time */}
      <span className="w-8 shrink-0 text-right text-[10px] text-maestro-muted/60">
        {relativeTime}
      </span>
    </button>
  );
}
