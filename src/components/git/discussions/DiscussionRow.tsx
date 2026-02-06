import { CheckCircle } from "lucide-react";
import { useMemo } from "react";
import type { DiscussionInfo } from "../../../stores/useGitHubStore";
import { parseEmoji } from "../shared/emojiUtils";

interface DiscussionRowProps {
  discussion: DiscussionInfo;
  isSelected: boolean;
  onClick: () => void;
}

export function DiscussionRow({ discussion, isSelected, onClick }: DiscussionRowProps) {
  // Format relative time
  const relativeTime = useMemo(() => {
    const now = Date.now();
    const discussionTime = new Date(discussion.createdAt).getTime();
    const diff = now - discussionTime;

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
  }, [discussion.createdAt]);

  const isAnswered = Boolean(discussion.answerChosenAt);

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
      {/* Category emoji */}
      <div className="shrink-0 rounded bg-maestro-surface p-1">
        <span className="text-sm">{parseEmoji(discussion.category.emoji)}</span>
      </div>

      {/* Title and category */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          {isAnswered && (
            <CheckCircle size={12} className="shrink-0 text-green-400" />
          )}
          <span className="truncate text-xs text-maestro-text">
            {discussion.title}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-maestro-muted">
          <span className="font-mono">#{discussion.number}</span>
          <span className="rounded bg-maestro-surface px-1 py-0.5">
            {discussion.category.name}
          </span>
          <span>by {discussion.author.login}</span>
        </div>
      </div>

      {/* Relative time */}
      <span className="w-8 shrink-0 text-right text-[10px] text-maestro-muted/60">
        {relativeTime}
      </span>
    </button>
  );
}
