import { X, GitMerge, Loader2 } from "lucide-react";
import { useState } from "react";
import { useGitHubStore, type MergeMethod } from "../../../stores/useGitHubStore";

interface MergePRModalProps {
  repoPath: string;
  prNumber: number;
  onClose: () => void;
}

const MERGE_METHODS: Array<{
  value: MergeMethod;
  label: string;
  description: string;
}> = [
  {
    value: "squash",
    label: "Squash and merge",
    description: "Combine all commits into one commit on the base branch",
  },
  {
    value: "merge",
    label: "Create a merge commit",
    description: "Merge all commits into the base branch with a merge commit",
  },
  {
    value: "rebase",
    label: "Rebase and merge",
    description: "Apply commits on top of the base branch without a merge commit",
  },
];

export function MergePRModal({ repoPath, prNumber, onClose }: MergePRModalProps) {
  const { mergePullRequest } = useGitHubStore();
  const [method, setMethod] = useState<MergeMethod>("squash");
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [isMerging, setIsMerging] = useState(false);

  const handleMerge = async () => {
    setIsMerging(true);
    try {
      await mergePullRequest(repoPath, prNumber, method, deleteBranch);
      onClose();
    } catch (err) {
      console.error("Failed to merge PR:", err);
      window.alert(`Failed to merge PR: ${err}`);
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-80 rounded-lg border border-maestro-border bg-maestro-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-maestro-border p-3">
          <div className="flex items-center gap-2">
            <GitMerge size={16} className="text-green-400" />
            <span className="text-sm font-medium text-maestro-text">
              Merge pull request
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
          {/* Merge method selection */}
          <div className="mb-4">
            <label className="mb-2 block text-xs font-medium text-maestro-text">
              Merge method
            </label>
            <div className="space-y-2">
              {MERGE_METHODS.map((m) => (
                <label
                  key={m.value}
                  className={`flex cursor-pointer items-start gap-2 rounded border p-2 transition-colors ${
                    method === m.value
                      ? "border-maestro-accent bg-maestro-accent/10"
                      : "border-maestro-border hover:border-maestro-muted"
                  }`}
                >
                  <input
                    type="radio"
                    name="mergeMethod"
                    value={m.value}
                    checked={method === m.value}
                    onChange={() => setMethod(m.value)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-xs font-medium text-maestro-text">
                      {m.label}
                    </div>
                    <div className="text-[10px] text-maestro-muted">
                      {m.description}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Delete branch checkbox */}
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={deleteBranch}
              onChange={(e) => setDeleteBranch(e.target.checked)}
            />
            <span className="text-xs text-maestro-text">
              Delete branch after merge
            </span>
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
            onClick={handleMerge}
            disabled={isMerging}
            className="flex items-center gap-1 rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50"
          >
            {isMerging ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <GitMerge size={12} />
            )}
            Merge
          </button>
        </div>
      </div>
    </div>
  );
}
