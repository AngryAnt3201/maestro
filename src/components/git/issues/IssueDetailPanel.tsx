import {
  X,
  CircleDot,
  CheckCircle2,
  ExternalLink,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { useState } from "react";
import { useGitHubStore } from "../../../stores/useGitHubStore";
import { MarkdownBody } from "../shared/MarkdownBody";
import { CommentList } from "../shared/CommentList";

interface IssueDetailPanelProps {
  repoPath: string;
  onClose: () => void;
}

export function IssueDetailPanel({
  repoPath,
  onClose,
}: IssueDetailPanelProps) {
  const {
    selectedIssue,
    isLoadingIssueDetail,
    closeIssue,
    reopenIssue,
    commentIssue,
  } = useGitHubStore();

  const [commentText, setCommentText] = useState("");
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isReopening, setIsReopening] = useState(false);

  if (isLoadingIssueDetail) {
    return (
      <div className="flex h-full items-center justify-center bg-maestro-card">
        <Loader2 size={24} className="animate-spin text-maestro-muted" />
      </div>
    );
  }

  if (!selectedIssue) {
    return null;
  }

  const isOpen = selectedIssue.state.toUpperCase() === "OPEN";
  const StateIcon = isOpen ? CircleDot : CheckCircle2;

  const handleClose = async () => {
    if (!window.confirm("Are you sure you want to close this issue?")) {
      return;
    }
    setIsClosing(true);
    try {
      await closeIssue(repoPath, selectedIssue.number);
    } catch (err) {
      console.error("Failed to close issue:", err);
      window.alert(`Failed to close issue: ${err}`);
    } finally {
      setIsClosing(false);
    }
  };

  const handleReopen = async () => {
    setIsReopening(true);
    try {
      await reopenIssue(repoPath, selectedIssue.number);
    } catch (err) {
      console.error("Failed to reopen issue:", err);
      window.alert(`Failed to reopen issue: ${err}`);
    } finally {
      setIsReopening(false);
    }
  };

  const handleComment = async () => {
    if (!commentText.trim()) return;
    setIsSubmittingComment(true);
    try {
      await commentIssue(repoPath, selectedIssue.number, commentText);
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
          <StateIcon
            size={16}
            className={isOpen ? "text-green-400" : "text-purple-400"}
          />
          <span className="text-sm font-medium text-maestro-text">
            #{selectedIssue.number}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3" style={{ scrollbarWidth: "thin" }}>
        {/* Title */}
        <h3 className="mb-2 text-sm font-medium text-maestro-text">
          {selectedIssue.title}
        </h3>

        {/* Author and date */}
        <div className="mb-3 text-[10px] text-maestro-muted">
          by {selectedIssue.author.login} on{" "}
          {new Date(selectedIssue.createdAt).toLocaleDateString()}
        </div>

        {/* Status badge */}
        <div className="mb-3 flex flex-wrap items-center gap-1">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              isOpen
                ? "bg-green-500/20 text-green-400"
                : "bg-purple-500/20 text-purple-400"
            }`}
          >
            {isOpen ? "Open" : "Closed"}
          </span>
          {selectedIssue.comments.length > 0 && (
            <span className="flex items-center gap-0.5 rounded bg-maestro-muted/20 px-1.5 py-0.5 text-[10px] text-maestro-muted">
              <MessageSquare size={10} />
              {selectedIssue.comments.length}
            </span>
          )}
        </div>

        {/* Labels */}
        {selectedIssue.labels.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1">
            {selectedIssue.labels.map((label) => (
              <span
                key={label.name}
                className="rounded px-1.5 py-0.5 text-[10px]"
                style={{
                  backgroundColor: `#${label.color}20`,
                  color: `#${label.color}`,
                }}
              >
                {label.name}
              </span>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="mb-3 rounded bg-maestro-surface p-2">
          <MarkdownBody content={selectedIssue.body} />
        </div>

        {/* Open on GitHub */}
        <a
          href={selectedIssue.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-3 flex items-center gap-1 text-xs text-maestro-accent hover:underline"
        >
          <ExternalLink size={12} />
          View on GitHub
        </a>

        {/* Comments */}
        <div className="mb-3">
          <CommentList comments={selectedIssue.comments} />
        </div>
      </div>

      {/* Actions */}
      <div className="shrink-0 border-t border-maestro-border p-3">
        {/* Comment input */}
        <div className="mb-2 flex items-center gap-2">
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

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {isOpen ? (
            <button
              type="button"
              onClick={handleClose}
              disabled={isClosing}
              className="flex flex-1 items-center justify-center gap-1 rounded bg-purple-600 py-1.5 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50"
            >
              {isClosing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <CheckCircle2 size={12} />
              )}
              Close Issue
            </button>
          ) : (
            <button
              type="button"
              onClick={handleReopen}
              disabled={isReopening}
              className="flex flex-1 items-center justify-center gap-1 rounded bg-green-600 py-1.5 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50"
            >
              {isReopening ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <CircleDot size={12} />
              )}
              Reopen Issue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
