import { invoke } from "@tauri-apps/api/core";
import { Check, GitBranch, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface BranchInfo {
  name: string;
  is_remote: boolean;
  is_current: boolean;
}

interface BranchDropdownProps {
  repoPath: string;
  currentBranch: string;
  onSelect: (branch: string) => void;
  onCreateBranch: (name: string) => void;
  onClose: () => void;
}

export function BranchDropdown({
  repoPath,
  currentBranch,
  onSelect,
  onCreateBranch,
  onClose,
}: BranchDropdownProps) {
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(-1);
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<BranchInfo[]>("git_branches", { repoPath });
      if (!mountedRef.current) return;
      // Filter out remote branches that already have a local counterpart
      // e.g., hide "origin/feature/foo" when "feature/foo" exists locally
      const localNames = new Set(result.filter((b) => !b.is_remote).map((b) => b.name));
      const deduped = result.filter((b) => {
        if (!b.is_remote) return true;
        const slashIndex = b.name.indexOf("/");
        if (slashIndex === -1) return true;
        const localName = b.name.substring(slashIndex + 1);
        return !localNames.has(localName);
      });
      setBranches(deduped);
      const currentIdx = deduped.findIndex((b) => b.is_current);
      setFocusIndex(currentIdx >= 0 ? currentIdx : 0);
      setLoading(false);
    } catch (err) {
      console.error("Failed to fetch branches:", err);
      if (!mountedRef.current) return;
      setBranches([]);
      setError(err instanceof Error ? err.message : "Failed to load branches");
      setLoading(false);
    }
  }, [repoPath]);

  // Fetch branches on mount
  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (showCreateInput) {
        // When create input is shown, only handle Escape
        if (e.key === "Escape") {
          e.preventDefault();
          setShowCreateInput(false);
          setNewBranchName("");
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusIndex((prev) => (prev < branches.length - 1 ? prev + 1 : prev));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case "Enter":
          e.preventDefault();
          if (focusIndex >= 0 && focusIndex < branches.length) {
            onSelect(branches[focusIndex].name);
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [focusIndex, branches, onSelect, onClose, showCreateInput],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Bail out if the dropdown is no longer in the DOM (e.g. modal overlay)
      if (!dropdownRef.current || !document.contains(dropdownRef.current)) return;
      const activeEl = document.activeElement;
      const isDropdownFocused = dropdownRef.current.contains(activeEl as Node);
      const isBodyFocused = activeEl === document.body;
      const hasModal = Boolean(
        document.querySelector('[role="dialog"], [data-modal-open="true"], .modal, .overlay'),
      );
      if (isDropdownFocused || (isBodyFocused && !hasModal)) {
        handleKeyDown(e);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handleKeyDown]);

  // Scroll focused item into view
  useEffect(() => {
    if (focusIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll("[data-branch-item]");
      items[focusIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [focusIndex]);

  // Focus input when create mode is shown
  useEffect(() => {
    if (showCreateInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showCreateInput]);

  const handleCreateBranch = async () => {
    const trimmedName = newBranchName.trim();
    if (!trimmedName || isCreating) return;

    // Validate branch name
    if (!/^[a-zA-Z0-9._/-]+$/.test(trimmedName)) {
      setError("Invalid branch name. Use only letters, numbers, dots, dashes, and slashes.");
      return;
    }

    setIsCreating(true);
    try {
      await onCreateBranch(trimmedName);
      setNewBranchName("");
      setShowCreateInput(false);
      // Refresh branches
      await fetchBranches();
    } catch (err) {
      console.error("Failed to create branch:", err);
      setError(err instanceof Error ? err.message : "Failed to create branch");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div
      ref={dropdownRef}
      className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-maestro-border bg-maestro-card shadow-xl shadow-black/30"
    >
      {/* Current branch header */}
      <div className="border-b border-maestro-border px-4 py-3">
        <span className="text-sm text-maestro-muted">Current: </span>
        <span className="text-sm font-medium text-maestro-text">{currentBranch}</span>
      </div>

      {/* Create new branch section */}
      {showCreateInput ? (
        <div className="border-b border-maestro-border p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-maestro-muted/70">
            New Branch Name
          </div>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={newBranchName}
              onChange={(e) => {
                setNewBranchName(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreateBranch();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setShowCreateInput(false);
                  setNewBranchName("");
                }
              }}
              placeholder="feature/my-branch"
              className="flex-1 rounded border border-maestro-border bg-maestro-surface px-2 py-1 text-sm text-maestro-text placeholder:text-maestro-muted/50 focus:border-maestro-accent focus:outline-none"
              disabled={isCreating}
            />
            <button
              type="button"
              onClick={handleCreateBranch}
              disabled={!newBranchName.trim() || isCreating}
              className="rounded bg-maestro-accent px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
            >
              {isCreating ? "..." : "Create"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowCreateInput(true)}
          className="flex w-full items-center gap-2 border-b border-maestro-border px-4 py-2.5 text-sm text-maestro-accent transition-colors hover:bg-maestro-accent/10"
        >
          <Plus size={14} />
          <span>Create New Branch</span>
        </button>
      )}

      {/* Switch to Branch */}
      <div className="px-4 pb-1 pt-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-maestro-muted/70">
          Switch to Branch
        </span>
      </div>

      {/* Branch list */}
      <div ref={listRef} className="max-h-64 overflow-y-auto px-1 pb-2">
        {branches.map((branch, i) => {
          const isCurrent = branch.is_current;
          const isFocused = i === focusIndex;

          return (
            <button
              type="button"
              key={branch.name}
              data-branch-item
              onClick={() => onSelect(branch.name)}
              onMouseEnter={() => setFocusIndex(i)}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
                isFocused ? "bg-maestro-accent/20" : "hover:bg-maestro-border/30"
              }`}
            >
              <span className="w-4 shrink-0">
                {isCurrent ? (
                  <Check size={12} className="text-maestro-accent" />
                ) : (
                  <GitBranch size={12} className="text-maestro-muted/40" />
                )}
              </span>
              <span
                className={`truncate ${
                  isCurrent
                    ? "font-semibold text-maestro-accent"
                    : "font-semibold text-maestro-text"
                }`}
              >
                {branch.name}
              </span>
              {branch.is_remote && (
                <span className="ml-auto text-[9px] text-maestro-muted/60">remote</span>
              )}
            </button>
          );
        })}
        {loading && <div className="px-3 py-2 text-sm text-maestro-muted">Loading branches...</div>}
        {!loading && error && (
          <div className="px-3 py-2 text-sm text-maestro-red">
            <div>{error}</div>
            <div className="mt-2">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  fetchBranches();
                }}
                className="rounded border border-maestro-border px-2 py-1 text-[11px] text-maestro-text hover:bg-maestro-border/40"
              >
                Retry
              </button>
            </div>
          </div>
        )}
        {!loading && !error && branches.length === 0 && (
          <div className="px-3 py-2 text-sm text-maestro-muted">No branches found</div>
        )}
      </div>
    </div>
  );
}
