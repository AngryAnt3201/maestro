import Check from "lucide-react/dist/esm/icons/check";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import Copy from "lucide-react/dist/esm/icons/copy";
import FileCode from "lucide-react/dist/esm/icons/file-code";
import FileMinus from "lucide-react/dist/esm/icons/file-minus";
import FilePlus from "lucide-react/dist/esm/icons/file-plus";
import FileText from "lucide-react/dist/esm/icons/file-text";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import X from "lucide-react/dist/esm/icons/x";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GraphNode } from "../../lib/graphLayout";
import { type FileChange, type FileChangeStatus, useGitStore } from "../../stores/useGitStore";

interface CommitDetailPanelProps {
  node: GraphNode;
  repoPath: string;
  onClose: () => void;
  onCreateBranchAtCommit?: (commitHash: string) => void;
  onCheckoutCommit?: (commitHash: string) => void;
}

/** Maps file status to icon and color. */
function getFileStatusDisplay(status: FileChangeStatus) {
  switch (status) {
    case "added":
      return { icon: FilePlus, color: "text-green-400", label: "A" };
    case "modified":
      return { icon: FileCode, color: "text-yellow-400", label: "M" };
    case "deleted":
      return { icon: FileMinus, color: "text-red-400", label: "D" };
    case "renamed":
      return { icon: ChevronRight, color: "text-blue-400", label: "R" };
    case "copied":
      return { icon: FileText, color: "text-purple-400", label: "C" };
    default:
      return { icon: FileText, color: "text-maestro-muted", label: "?" };
  }
}

/** Formats a timestamp to a readable date string. */
function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CommitDetailPanel({
  node,
  repoPath,
  onClose,
  onCreateBranchAtCommit,
  onCheckoutCommit,
}: CommitDetailPanelProps) {
  const { commit, railColor } = node;
  const [files, setFiles] = useState<FileChange[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(true);
  const [copiedHash, setCopiedHash] = useState(false);

  const { getCommitFiles } = useGitStore();

  // Fetch files when commit changes
  useEffect(() => {
    let cancelled = false;
    setIsLoadingFiles(true);

    getCommitFiles(repoPath, commit.hash).then((result) => {
      if (!cancelled) {
        setFiles(result);
        setIsLoadingFiles(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [repoPath, commit.hash, getCommitFiles]);

  // Copy hash to clipboard
  const handleCopyHash = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(commit.hash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    } catch (err) {
      console.error("Failed to copy hash:", err);
    }
  }, [commit.hash]);

  // Group files by directory
  const filesByDirectory = useMemo(() => {
    const groups = new Map<string, FileChange[]>();

    for (const file of files) {
      const parts = file.path.split("/");
      const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : "(root)";

      if (!groups.has(dir)) {
        groups.set(dir, []);
      }
      const group = groups.get(dir);
      if (group) {
        group.push(file);
      }
    }

    // Sort directories
    const sorted = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));

    return sorted;
  }, [files]);

  const isMerge = commit.parent_hashes.length > 1;

  return (
    <div className="flex h-full flex-col border-l border-maestro-border bg-maestro-surface">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-maestro-border px-3 py-2">
        <span className="text-sm font-medium text-maestro-text">Commit Details</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-maestro-muted transition-colors hover:bg-maestro-card hover:text-maestro-text"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3">
        {/* Hash with copy button */}
        <div className="mb-4">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-maestro-muted/60">
            SHA
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: railColor }} />
            <code className="flex-1 truncate font-mono text-xs text-maestro-text">
              {commit.hash}
            </code>
            <button
              type="button"
              onClick={handleCopyHash}
              className="rounded p-1 text-maestro-muted transition-colors hover:bg-maestro-card hover:text-maestro-text"
              aria-label="Copy hash"
            >
              {copiedHash ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            </button>
          </div>
        </div>

        {/* Author */}
        <div className="mb-4">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-maestro-muted/60">
            Author
          </div>
          <div className="text-xs text-maestro-text">{commit.author_name}</div>
          <div className="text-[11px] text-maestro-muted">{commit.author_email}</div>
        </div>

        {/* Date */}
        <div className="mb-4">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-maestro-muted/60">
            Date
          </div>
          <div className="text-xs text-maestro-text">{formatDate(commit.timestamp)}</div>
        </div>

        {/* Message */}
        <div className="mb-4">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-maestro-muted/60">
            Message
          </div>
          <div className="whitespace-pre-wrap text-xs text-maestro-text">{commit.summary}</div>
        </div>

        {/* Parents */}
        {commit.parent_hashes.length > 0 && (
          <div className="mb-4">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-maestro-muted/60">
              {isMerge ? "Parents (merge)" : "Parent"}
            </div>
            <div className="flex flex-col gap-1">
              {commit.parent_hashes.map((hash, i) => (
                <code key={hash} className="font-mono text-[11px] text-maestro-muted">
                  {i + 1}. {hash.slice(0, 12)}
                </code>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mb-4 flex gap-2">
          {onCreateBranchAtCommit && (
            <button
              type="button"
              onClick={() => onCreateBranchAtCommit(commit.hash)}
              className="flex items-center gap-1.5 rounded border border-maestro-border bg-maestro-card px-2 py-1 text-xs text-maestro-text transition-colors hover:bg-maestro-border/50"
            >
              <GitBranch size={12} />
              Create branch
            </button>
          )}
          {onCheckoutCommit && (
            <button
              type="button"
              onClick={() => onCheckoutCommit(commit.hash)}
              className="flex items-center gap-1.5 rounded border border-maestro-border bg-maestro-card px-2 py-1 text-xs text-maestro-text transition-colors hover:bg-maestro-border/50"
            >
              <Check size={12} />
              Checkout
            </button>
          )}
        </div>

        {/* Files changed */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-maestro-muted/60">
              Files Changed
            </span>
            <span className="rounded-full bg-maestro-accent/15 px-1.5 py-px text-[10px] font-medium text-maestro-accent">
              {files.length}
            </span>
          </div>

          {isLoadingFiles ? (
            <div className="py-4 text-center text-xs text-maestro-muted">Loading files...</div>
          ) : files.length === 0 ? (
            <div className="py-4 text-center text-xs text-maestro-muted">No files changed</div>
          ) : (
            <div className="space-y-2">
              {filesByDirectory.map(([dir, dirFiles]) => (
                <div key={dir}>
                  <div className="mb-1 text-[10px] font-medium text-maestro-muted">{dir}</div>
                  <div className="space-y-0.5">
                    {dirFiles.map((file) => {
                      const { icon: Icon, color, label } = getFileStatusDisplay(file.status);
                      const fileName = file.path.split("/").pop();

                      return (
                        <div
                          key={file.path}
                          className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-maestro-card/30"
                        >
                          <Icon size={12} className={color} />
                          <span className="flex-1 truncate text-[11px] text-maestro-text">
                            {fileName}
                          </span>
                          <span className={`shrink-0 text-[9px] font-medium ${color}`}>
                            {label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
