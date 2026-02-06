import {
  X,
  GitMerge,
  GitPullRequest,
  XCircle,
  ExternalLink,
  FileEdit,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { useState } from "react";
import { useGitHubStore } from "../../../stores/useGitHubStore";
import { MergePRModal } from "./MergePRModal";
import { MarkdownBody } from "../shared/MarkdownBody";
import { CommentList } from "../shared/CommentList";

interface PullRequestDetailPanelProps {
  repoPath: string;
  onClose: () => void;
}

export function PullRequestDetailPanel({
  repoPath,
  onClose,
}: PullRequestDetailPanelProps) {
  const { selectedPR, isLoadingPRDetail, closePullRequest, commentPullRequest } =
    useGitHubStore();

  const [showMergeModal, setShowMergeModal] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  if (isLoadingPRDetail) {
    return (
      <div className="flex h-full items-center justify-center bg-maestro-card">
        <Loader2 size={24} className="animate-spin text-maestro-muted" />
      </div>
    );
  }

  if (!selectedPR) {
    return null;
  }

  const isOpen = selectedPR.state.toUpperCase() === "OPEN";
  const isMerged = selectedPR.state.toUpperCase() === "MERGED";
  const isClosed = selectedPR.state.toUpperCase() === "CLOSED";

  const handleClose = async () => {
    if (!window.confirm("Are you sure you want to close this pull request?")) {
      return;
    }
    setIsClosing(true);
    try {
      await closePullRequest(repoPath, selectedPR.number);
    } catch (err) {
      console.error("Failed to close PR:", err);
      window.alert(`Failed to close PR: ${err}`);
    } finally {
      setIsClosing(false);
    }
  };

  const handleComment = async () => {
    if (!commentText.trim()) return;
    setIsSubmittingComment(true);
    try {
      await commentPullRequest(repoPath, selectedPR.number, commentText);
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
          {isMerged ? (
            <GitMerge size={16} className="text-purple-400" />
          ) : isClosed ? (
            <XCircle size={16} className="text-red-400" />
          ) : (
            <GitPullRequest
              size={16}
              className={selectedPR.isDraft ? "text-maestro-muted" : "text-green-400"}
            />
          )}
          <span className="text-sm font-medium text-maestro-text">
            #{selectedPR.number}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3" style={{ scrollbarWidth: "thin" }}>
        {/* Title */}
        <h3 className="mb-2 text-sm font-medium text-maestro-text">
          {selectedPR.title}
        </h3>

        {/* Branch info */}
        <div className="mb-3 text-[10px] text-maestro-muted">
          <span className="font-mono rounded bg-maestro-surface px-1 py-0.5">
            {selectedPR.headRefName}
          </span>
          <span className="mx-1">→</span>
          <span className="font-mono rounded bg-maestro-surface px-1 py-0.5">
            {selectedPR.baseRefName}
          </span>
        </div>

        {/* Author and date */}
        <div className="mb-3 text-[10px] text-maestro-muted">
          by {selectedPR.author.login} on{" "}
          {new Date(selectedPR.createdAt).toLocaleDateString()}
        </div>

        {/* Stats */}
        <div className="mb-3 flex items-center gap-3 text-[10px]">
          <div className="flex items-center gap-1">
            <FileEdit size={10} className="text-maestro-muted" />
            <span className="text-green-400">+{selectedPR.additions}</span>
            <span className="text-red-400">-{selectedPR.deletions}</span>
          </div>
          <span className="text-maestro-muted">
            {selectedPR.changedFiles} files
          </span>
        </div>

        {/* Status badges */}
        <div className="mb-3 flex flex-wrap items-center gap-1">
          {selectedPR.isDraft && (
            <span className="rounded bg-maestro-muted/20 px-1.5 py-0.5 text-[10px] font-medium text-maestro-muted">
              Draft
            </span>
          )}
          {selectedPR.mergeable && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                selectedPR.mergeable === "MERGEABLE"
                  ? "bg-green-500/20 text-green-400"
                  : selectedPR.mergeable === "CONFLICTING"
                    ? "bg-red-500/20 text-red-400"
                    : "bg-maestro-muted/20 text-maestro-muted"
              }`}
            >
              {selectedPR.mergeable === "MERGEABLE"
                ? "Mergeable"
                : selectedPR.mergeable === "CONFLICTING"
                  ? "Conflicts"
                  : selectedPR.mergeable}
            </span>
          )}
          {selectedPR.reviewDecision && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                selectedPR.reviewDecision === "APPROVED"
                  ? "bg-green-500/20 text-green-400"
                  : selectedPR.reviewDecision === "CHANGES_REQUESTED"
                    ? "bg-orange-500/20 text-orange-400"
                    : "bg-maestro-muted/20 text-maestro-muted"
              }`}
            >
              {selectedPR.reviewDecision === "APPROVED"
                ? "Approved"
                : selectedPR.reviewDecision === "CHANGES_REQUESTED"
                  ? "Changes requested"
                  : selectedPR.reviewDecision}
            </span>
          )}
        </div>

        {/* Labels */}
        {selectedPR.labels.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1">
            {selectedPR.labels.map((label) => (
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
          <MarkdownBody content={selectedPR.body} />
        </div>

        {/* Open on GitHub */}
        <a
          href={selectedPR.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-3 flex items-center gap-1 text-xs text-maestro-accent hover:underline"
        >
          <ExternalLink size={12} />
          View on GitHub
        </a>

        {/* Comments */}
        {selectedPR.comments.length > 0 && (
          <div className="mb-3">
            <CommentList comments={selectedPR.comments} />
          </div>
        )}
      </div>

      {/* Actions */}
      {isOpen && (
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
            <button
              type="button"
              onClick={() => setShowMergeModal(true)}
              disabled={selectedPR.mergeable === "CONFLICTING"}
              className="flex flex-1 items-center justify-center gap-1 rounded bg-green-600 py-1.5 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50"
            >
              <GitMerge size={12} />
              Merge
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={isClosing}
              className="flex items-center justify-center gap-1 rounded bg-maestro-surface px-3 py-1.5 text-xs font-medium text-maestro-muted hover:bg-maestro-border hover:text-maestro-text disabled:opacity-50"
            >
              {isClosing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <XCircle size={12} />
              )}
              Close
            </button>
          </div>
        </div>
      )}

      {/* Merge modal */}
      {showMergeModal && (
        <MergePRModal
          repoPath={repoPath}
          prNumber={selectedPR.number}
          onClose={() => setShowMergeModal(false)}
        />
      )}
    </div>
  );
}
