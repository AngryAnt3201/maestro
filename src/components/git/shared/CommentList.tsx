import { MessageSquare } from "lucide-react";
import type { Comment } from "../../../stores/useGitHubStore";
import { CommentItem } from "./CommentItem";

interface CommentListProps {
  comments: Comment[];
  /** Label to show above the list */
  label?: string;
}

/**
 * Renders a list of comments with an optional header.
 * Shows an empty state when there are no comments.
 */
export function CommentList({ comments, label = "Comments" }: CommentListProps) {
  if (comments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-4 text-maestro-muted">
        <MessageSquare size={16} className="mb-1 opacity-50" />
        <span className="text-[10px]">No comments yet</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center gap-1 text-[10px] font-medium text-maestro-muted">
        <MessageSquare size={10} />
        <span>
          {label} ({comments.length})
        </span>
      </div>

      {/* Comment items */}
      <div className="space-y-2">
        {comments.map((comment) => (
          <CommentItem key={comment.id} comment={comment} />
        ))}
      </div>
    </div>
  );
}
