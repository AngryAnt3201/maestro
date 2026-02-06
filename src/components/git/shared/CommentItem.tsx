import { CheckCircle } from "lucide-react";
import type { Comment } from "../../../stores/useGitHubStore";
import { MarkdownBody } from "./MarkdownBody";

interface CommentItemProps {
  comment: Comment;
}

/** Emoji mapping for reactions. */
const REACTION_EMOJI: Record<string, string> = {
  thumbsUp: "\ud83d\udc4d",
  thumbsDown: "\ud83d\udc4e",
  laugh: "\ud83d\ude04",
  hooray: "\ud83c\udf89",
  confused: "\ud83d\ude15",
  heart: "\u2764\ufe0f",
  rocket: "\ud83d\ude80",
  eyes: "\ud83d\udc40",
};

/**
 * Displays a single comment with author, timestamp, body, and reactions.
 */
export function CommentItem({ comment }: CommentItemProps) {
  // Format relative time
  const formatRelativeTime = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      if (diffHours === 0) {
        const diffMins = Math.floor(diffMs / (1000 * 60));
        return diffMins <= 1 ? "just now" : `${diffMins}m ago`;
      }
      return `${diffHours}h ago`;
    }
    if (diffDays === 1) return "yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return date.toLocaleDateString();
  };

  // Get active reactions (count > 0)
  const activeReactions = Object.entries(comment.reactions)
    .filter(
      ([key, count]) =>
        key !== "totalCount" && typeof count === "number" && count > 0
    )
    .map(([key, count]) => ({
      emoji: REACTION_EMOJI[key] || key,
      count: count as number,
    }));

  return (
    <div
      className={`rounded border p-2 ${
        comment.isAnswer
          ? "border-green-500/30 bg-green-500/5"
          : "border-maestro-border bg-maestro-surface"
      }`}
    >
      {/* Header: author + timestamp + answer badge */}
      <div className="mb-1.5 flex items-center gap-2">
        {/* Avatar placeholder */}
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-maestro-border text-[8px] font-medium text-maestro-muted">
          {comment.author.login.charAt(0).toUpperCase()}
        </div>

        <span className="text-[10px] font-medium text-maestro-text">
          {comment.author.login}
        </span>

        <span className="text-[10px] text-maestro-muted">
          {formatRelativeTime(comment.createdAt)}
        </span>

        {comment.isAnswer && (
          <span className="ml-auto flex items-center gap-0.5 rounded bg-green-500/20 px-1 py-0.5 text-[8px] font-medium text-green-400">
            <CheckCircle size={8} />
            Answer
          </span>
        )}
      </div>

      {/* Comment body */}
      <div className="pl-7">
        <MarkdownBody content={comment.body} />

        {/* Reactions */}
        {activeReactions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {activeReactions.map(({ emoji, count }) => (
              <span
                key={emoji}
                className="flex items-center gap-0.5 rounded bg-maestro-bg px-1.5 py-0.5 text-[10px]"
              >
                <span>{emoji}</span>
                <span className="text-maestro-muted">{count}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
