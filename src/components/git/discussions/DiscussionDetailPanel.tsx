import {
  X,
  CheckCircle,
  ExternalLink,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { useState } from "react";
import { useGitHubStore } from "../../../stores/useGitHubStore";
import { MarkdownBody } from "../shared/MarkdownBody";
import { CommentList } from "../shared/CommentList";
import { parseEmoji } from "../shared/emojiUtils";

interface DiscussionDetailPanelProps {
  repoPath: string;
  onClose: () => void;
}

export function DiscussionDetailPanel({
  repoPath,
  onClose,
}: DiscussionDetailPanelProps) {
  const {
    selectedDiscussion,
    isLoadingDiscussionDetail,
    commentDiscussion,
  } = useGitHubStore();

  const [commentText, setCommentText] = useState("");
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  if (isLoadingDiscussionDetail) {
    return (
      <div className="flex h-full items-center justify-center bg-maestro-card">
        <Loader2 size={24} className="animate-spin text-maestro-muted" />
      </div>
    );
  }

  if (!selectedDiscussion) {
    return null;
  }

  const isAnswered = Boolean(selectedDiscussion.answerChosenAt);

  const handleComment = async () => {
    if (!commentText.trim()) return;
    setIsSubmittingComment(true);
    try {
      await commentDiscussion(repoPath, selectedDiscussion.number, commentText);
      setCommentText("");
    } catch (err) {
      console.error("Failed to add comment:", err);
      window.alert(`Failed to add comment: ${err}`);
    } finally {
      setIsSubmittingComment(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-maestro-card">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-maestro-border p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text"
            title="Back to list"
          >
            <X size={16} />
          </button>
          <span className="text-sm">{parseEmoji(selectedDiscussion.category.emoji)}</span>
          <span className="text-sm font-medium text-maestro-text">
            #{selectedDiscussion.number}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3" style={{ scrollbarWidth: "thin" }}>
        {/* Title */}
        <h3 className="mb-2 text-sm font-medium text-maestro-text">
          {isAnswered && (
            <CheckCircle size={14} className="mr-1 inline text-green-400" />
          )}
          {selectedDiscussion.title}
        </h3>

        {/* Category and author */}
        <div className="mb-3 flex items-center gap-2 text-[10px] text-maestro-muted">
          <span className="rounded bg-maestro-surface px-1 py-0.5">
            {selectedDiscussion.category.name}
          </span>
          <span>
            by {selectedDiscussion.author.login} on{" "}
            {new Date(selectedDiscussion.createdAt).toLocaleDateString()}
          </span>
        </div>

        {/* Status badges */}
        <div className="mb-3 flex flex-wrap items-center gap-1">
          {isAnswered && (
            <span className="flex items-center gap-0.5 rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-400">
              <CheckCircle size={10} />
              Answered
            </span>
          )}
          {selectedDiscussion.comments.length > 0 && (
            <span className="flex items-center gap-0.5 rounded bg-maestro-muted/20 px-1.5 py-0.5 text-[10px] text-maestro-muted">
              <MessageSquare size={10} />
              {selectedDiscussion.comments.length}
            </span>
          )}
        </div>

        {/* Body */}
        <div className="mb-3 rounded bg-maestro-surface p-2">
          <MarkdownBody content={selectedDiscussion.body} />
        </div>

        {/* Open on GitHub */}
        <a
          href={selectedDiscussion.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-3 flex items-center gap-1 text-xs text-maestro-accent hover:underline"
        >
          <ExternalLink size={12} />
          View on GitHub
        </a>

        {/* Comments */}
        <div className="mb-3">
          <CommentList comments={selectedDiscussion.comments} />
        </div>
      </div>

      {/* Actions */}
      <div className="shrink-0 border-t border-maestro-border p-3">
        {/* Comment input */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Add a comment..."
            className="flex-1 rounded border border-maestro-border bg-maestro-surface px-2 py-1 text-xs text-maestro-text placeholder:text-maestro-muted"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleComment();
              }
            }}
          />
          <button
            type="button"
            onClick={handleComment}
            disabled={!commentText.trim() || isSubmittingComment}
            className="rounded bg-maestro-surface p-1.5 text-maestro-muted hover:bg-maestro-border hover:text-maestro-text disabled:opacity-50"
          >
            {isSubmittingComment ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <MessageSquare size={12} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
