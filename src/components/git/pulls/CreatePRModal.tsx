import { X, GitPullRequest, Loader2 } from "lucide-react";
import { useState } from "react";
import { useGitHubStore } from "../../../stores/useGitHubStore";
import { useGitStore } from "../../../stores/useGitStore";

interface CreatePRModalProps {
  repoPath: string;
  onClose: () => void;
  onSuccess?: (prNumber: number) => void;
}

export function CreatePRModal({ repoPath, onClose, onSuccess }: CreatePRModalProps) {
  const { createPullRequest } = useGitHubStore();
  const { branches, currentBranch, defaultBranch } = useGitStore();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [base, setBase] = useState(defaultBranch || "main");
  const [head, setHead] = useState(currentBranch || "");
  const [draft, setDraft] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get local branches for selection
  const localBranches = branches.filter((b) => !b.is_remote);

  const handleCreate = async () => {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!base || !head) {
      setError("Base and head branches are required");
      return;
    }
    if (base === head) {
      setError("Base and head branches must be different");
      return;
    }

    setIsCreating(true);
    setError(null);
    try {
      const pr = await createPullRequest(repoPath, title, body, base, head, draft);
      onSuccess?.(pr.number);
      onClose();
    } catch (err) {
      console.error("Failed to create PR:", err);
      setError(String(err));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-96 rounded-lg border border-maestro-border bg-maestro-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-maestro-border p-3">
          <div className="flex items-center gap-2">
            <GitPullRequest size={16} className="text-green-400" />
            <span className="text-sm font-medium text-maestro-text">
              Create pull request
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text"
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="p-3">
          {/* Error message */}
          {error && (
            <div className="mb-3 rounded bg-red-500/10 p-2 text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Branch selectors */}
          <div className="mb-3 flex items-center gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-maestro-muted">
                Base
              </label>
              <select
                value={base}
                onChange={(e) => setBase(e.target.value)}
                className="w-full rounded border border-maestro-border bg-maestro-surface px-2 py-1 text-xs text-maestro-text"
              >
                {localBranches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <span className="mt-4 text-maestro-muted">←</span>
            <div className="flex-1">
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-maestro-muted">
                Head
              </label>
              <select
                value={head}
                onChange={(e) => setHead(e.target.value)}
                className="w-full rounded border border-maestro-border bg-maestro-surface px-2 py-1 text-xs text-maestro-text"
              >
                {localBranches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Title */}
          <div className="mb-3">
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-maestro-muted">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="PR title"
              className="w-full rounded border border-maestro-border bg-maestro-surface px-2 py-1.5 text-xs text-maestro-text placeholder:text-maestro-muted"
            />
          </div>

          {/* Body */}
          <div className="mb-3">
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-maestro-muted">
              Description
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Describe your changes..."
              rows={4}
              className="w-full resize-none rounded border border-maestro-border bg-maestro-surface px-2 py-1.5 text-xs text-maestro-text placeholder:text-maestro-muted"
            />
          </div>

          {/* Draft checkbox */}
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={draft}
              onChange={(e) => setDraft(e.target.checked)}
            />
            <span className="text-xs text-maestro-text">Create as draft</span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-maestro-border p-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs font-medium text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={isCreating || !title.trim()}
            className="flex items-center gap-1 rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50"
          >
            {isCreating ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <GitPullRequest size={12} />
            )}
            Create pull request
          </button>
        </div>
      </div>
    </div>
  );
}
