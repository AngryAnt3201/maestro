import Check from "lucide-react/dist/esm/icons/check";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import FolderGit2 from "lucide-react/dist/esm/icons/folder-git-2";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import Plus from "lucide-react/dist/esm/icons/plus";
import Search from "lucide-react/dist/esm/icons/search";
import Star from "lucide-react/dist/esm/icons/star";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import { useEffect, useRef, useState } from "react";
import type { BranchWithWorktreeStatus } from "@/lib/git";
import { toInvokeErrorMessage } from "@/lib/invokeError";
import type { RepositoryInfo, WorkspaceType } from "@/stores/useWorkspaceStore";

interface BranchSelectorProps {
  branch: string | null;
  projectPath: string;
  branches: BranchWithWorktreeStatus[];
  isLoadingBranches: boolean;
  isGitRepo: boolean;
  repositories?: RepositoryInfo[];
  workspaceType?: WorkspaceType;
  selectedRepoPath?: string;
  onRepoChange?: (path: string) => void;
  fetchBranchesForRepo?: (repoPath: string) => Promise<BranchWithWorktreeStatus[]>;
  onCreateBranch?: (name: string, andCheckout: boolean, repoPath?: string) => Promise<void>;
  onBranchChange: (branch: string | null) => void;
  onRefreshBranches?: () => void;
}

function isValidBranchName(name: string): boolean {
  if (!name || name.length === 0) return false;
  if (/[\s~^:?*[\]\\]/.test(name)) return false;
  if (name.includes("..")) return false;
  if (name.includes("@{")) return false;
  if (name.startsWith("-") || name.startsWith(".")) return false;
  if (name.endsWith(".") || name.endsWith("/") || name.endsWith(".lock")) return false;
  return /^[a-zA-Z0-9._/-]+$/.test(name);
}

export function BranchSelector({
  branch,
  projectPath,
  branches,
  isLoadingBranches,
  isGitRepo,
  repositories,
  workspaceType,
  selectedRepoPath,
  onRepoChange,
  fetchBranchesForRepo,
  onCreateBranch,
  onBranchChange,
  onRefreshBranches,
}: BranchSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showBranchCreate, setShowBranchCreate] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [branchCreateError, setBranchCreateError] = useState<string | null>(null);
  const branchCreateInputRef = useRef<HTMLInputElement>(null);

  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [repoBranchesCache, setRepoBranchesCache] = useState<
    Map<string, BranchWithWorktreeStatus[]>
  >(new Map());
  const [loadingRepos, setLoadingRepos] = useState<Set<string>>(new Set());
  const [repoCreateBranch, setRepoCreateBranch] = useState<string | null>(null);
  const [repoNewBranchName, setRepoNewBranchName] = useState("");
  const [repoCreatingBranch, setRepoCreatingBranch] = useState(false);
  const [repoCreateError, setRepoCreateError] = useState<string | null>(null);
  const repoCreateInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentBranch = branches.find((candidate) => candidate.isCurrent);
  const selectedBranchInfo = branch
    ? branches.find((candidate) => candidate.name === branch)
    : currentBranch;
  const displayBranch = selectedBranchInfo?.name ?? branch ?? "Current";
  const localBranches = branches.filter((candidate) => !candidate.isRemote);
  const localBranchNames = new Set(localBranches.map((candidate) => candidate.name));
  const remoteBranches = branches.filter((candidate) => {
    if (!candidate.isRemote) return false;
    const slashIndex = candidate.name.indexOf("/");
    if (slashIndex === -1) return true;
    const localName = candidate.name.substring(slashIndex + 1);
    return !localBranchNames.has(localName);
  });

  const isMultiRepo = workspaceType === "multi-repo" && repositories && repositories.length > 0;
  const selectedRepo = repositories?.find((repo) => repo.path === selectedRepoPath);
  const selectedRepoName =
    selectedRepo?.name ?? selectedRepoPath?.split("/").pop() ?? projectPath.split("/").pop() ?? "";
  const normalizedQuery = searchQuery.toLowerCase();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (showBranchCreate && branchCreateInputRef.current) {
      branchCreateInputRef.current.focus();
    }
  }, [showBranchCreate]);

  useEffect(() => {
    if (repoCreateBranch && repoCreateInputRef.current) {
      repoCreateInputRef.current.focus();
    }
  }, [repoCreateBranch]);

  useEffect(() => {
    if (selectedRepoPath && branches.length > 0) {
      setRepoBranchesCache((current) => new Map(current).set(selectedRepoPath, branches));
    }
  }, [selectedRepoPath, branches]);

  const toggleRepoExpanded = async (repoPath: string) => {
    const nextExpanded = new Set(expandedRepos);

    if (nextExpanded.has(repoPath)) {
      nextExpanded.delete(repoPath);
      setExpandedRepos(nextExpanded);
      return;
    }

    nextExpanded.add(repoPath);
    setExpandedRepos(nextExpanded);

    if (!repoBranchesCache.has(repoPath) && fetchBranchesForRepo) {
      setLoadingRepos((current) => new Set(current).add(repoPath));
      try {
        const fetchedBranches = await fetchBranchesForRepo(repoPath);
        setRepoBranchesCache((current) => new Map(current).set(repoPath, fetchedBranches));
      } catch (error) {
        console.error("Failed to fetch branches for repo:", error);
      } finally {
        setLoadingRepos((current) => {
          const next = new Set(current);
          next.delete(repoPath);
          return next;
        });
      }
    }
  };

  const closeDropdown = () => {
    setIsOpen(false);
    setSearchQuery("");
  };

  const handleSelectRepo = (repoPath: string) => {
    onRepoChange?.(repoPath);
    onBranchChange(null);
    closeDropdown();
  };

  const handleSelectRepoBranch = (repoPath: string, branchName: string | null) => {
    if (onRepoChange && repoPath !== selectedRepoPath) {
      onRepoChange(repoPath);
    }
    onBranchChange(branchName);
    closeDropdown();
  };

  const createSingleRepoBranch = async (branchName: string, selectAfterCreate: boolean) => {
    if (!onCreateBranch || !branchName || isCreatingBranch) return;
    if (!isValidBranchName(branchName)) {
      setBranchCreateError("Invalid name. Use letters, numbers, dots, dashes, slashes.");
      return;
    }

    setIsCreatingBranch(true);
    setBranchCreateError(null);
    try {
      await onCreateBranch(branchName, false);
      if (selectAfterCreate) {
        onBranchChange(branchName);
        closeDropdown();
      }
      setNewBranchName("");
      setShowBranchCreate(false);
    } catch (error) {
      setBranchCreateError(toInvokeErrorMessage(error) || "Failed to create branch");
    } finally {
      setIsCreatingBranch(false);
    }
  };

  const createRepoBranch = async (
    repoPath: string,
    branchName: string,
    selectAfterCreate: boolean,
  ) => {
    if (!onCreateBranch || !branchName || repoCreatingBranch) return;
    if (!isValidBranchName(branchName)) {
      setRepoCreateError("Invalid name.");
      return;
    }

    setRepoCreatingBranch(true);
    setRepoCreateError(null);
    try {
      await onCreateBranch(branchName, false, repoPath);
      if (selectAfterCreate) {
        handleSelectRepoBranch(repoPath, branchName);
      }
      setRepoNewBranchName("");
      setRepoCreateBranch(null);
    } catch (error) {
      setRepoCreateError(toInvokeErrorMessage(error) || "Failed to create branch");
    } finally {
      setRepoCreatingBranch(false);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-maestro-muted">
        {isMultiRepo ? "Repository & Branch" : "Git Branch"}
      </div>
      {!isGitRepo && !isMultiRepo ? (
        <div className="flex items-center gap-2 rounded border border-maestro-border bg-maestro-card/50 px-3 py-2 text-sm text-maestro-muted">
          <Terminal size={14} />
          <span>Not a Git repository</span>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              if (!isOpen) onRefreshBranches?.();
              setIsOpen((current) => !current);
            }}
            disabled={isLoadingBranches}
            className="flex w-full items-center justify-between gap-2 rounded border border-maestro-border bg-maestro-card px-3 py-2 text-left text-sm text-maestro-text transition-colors hover:border-maestro-accent/50 disabled:opacity-50"
          >
            <div className="flex min-w-0 items-center gap-2">
              {isMultiRepo ? (
                <>
                  <FolderOpen size={14} className="shrink-0 text-maestro-purple" />
                  <span className="truncate">{selectedRepoName}</span>
                  {selectedRepo?.isGitRepo && (
                    <>
                      <span className="text-maestro-muted">/</span>
                      <GitBranch size={12} className="shrink-0 text-maestro-accent" />
                      <span className="truncate text-maestro-muted">{displayBranch}</span>
                    </>
                  )}
                </>
              ) : (
                <>
                  <GitBranch size={14} className="shrink-0 text-maestro-accent" />
                  <span className="truncate">{displayBranch}</span>
                </>
              )}
              {selectedRepo?.isGitRepo && selectedBranchInfo?.hasWorktree && (
                <span title="Worktree exists">
                  <FolderGit2 size={12} className="shrink-0 text-maestro-orange" />
                </span>
              )}
              {selectedRepo?.isGitRepo && selectedBranchInfo?.isCurrent && (
                <span className="shrink-0 rounded bg-maestro-green/20 px-1 text-[9px] text-maestro-green">
                  current
                </span>
              )}
              {selectedRepo?.isGitRepo && branch && !selectedBranchInfo && (
                <span className="shrink-0 rounded bg-maestro-accent/20 px-1 text-[9px] text-maestro-accent">
                  new
                </span>
              )}
            </div>
            <ChevronDown size={14} className="shrink-0 text-maestro-muted" />
          </button>

          {isOpen && (
            <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded border border-maestro-border bg-maestro-card shadow-lg">
              <div className="border-b border-maestro-border p-2">
                <div className="relative">
                  <Search
                    size={12}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-maestro-muted"
                  />
                  <input
                    type="text"
                    placeholder={
                      isMultiRepo ? "Search repos and branches..." : "Search branches..."
                    }
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="w-full rounded border border-maestro-border bg-maestro-surface py-1.5 pl-7 pr-2 text-xs text-maestro-text placeholder:text-maestro-muted focus:border-maestro-accent focus:outline-none"
                    onClick={(event) => event.stopPropagation()}
                  />
                </div>
              </div>

              {onCreateBranch && !isMultiRepo && (
                <div className="border-b border-maestro-border">
                  {showBranchCreate ? (
                    <div className="p-2">
                      <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-maestro-muted/70">
                        New Branch Name
                      </div>
                      <div className="space-y-1.5">
                        <input
                          ref={branchCreateInputRef}
                          type="text"
                          value={newBranchName}
                          onChange={(event) => {
                            setNewBranchName(event.target.value);
                            setBranchCreateError(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void createSingleRepoBranch(newBranchName.trim(), true);
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              setShowBranchCreate(false);
                              setNewBranchName("");
                              setBranchCreateError(null);
                            }
                          }}
                          placeholder="feature/my-branch"
                          className="w-full rounded border border-maestro-border bg-maestro-surface px-2 py-1 text-xs text-maestro-text placeholder:text-maestro-muted/50 focus:border-maestro-accent focus:outline-none"
                          disabled={isCreatingBranch}
                          onClick={(event) => event.stopPropagation()}
                        />
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void createSingleRepoBranch(newBranchName.trim(), false);
                            }}
                            disabled={!newBranchName.trim() || isCreatingBranch}
                            className="rounded border border-maestro-border bg-maestro-surface px-2 py-1 text-xs font-medium text-maestro-text disabled:opacity-50 hover:bg-maestro-border/40"
                            title="Create branch without selecting"
                          >
                            {isCreatingBranch ? "..." : "Create"}
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void createSingleRepoBranch(newBranchName.trim(), true);
                            }}
                            disabled={!newBranchName.trim() || isCreatingBranch}
                            className="rounded bg-maestro-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                            title="Create branch and select it"
                          >
                            {isCreatingBranch ? "..." : "Create & Select"}
                          </button>
                        </div>
                      </div>
                      {branchCreateError && (
                        <div className="mt-1 text-[10px] text-maestro-red">{branchCreateError}</div>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setShowBranchCreate(true);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-maestro-accent transition-colors hover:bg-maestro-accent/10"
                    >
                      <Plus size={12} />
                      <span>Create New Branch</span>
                    </button>
                  )}
                </div>
              )}

              {isMultiRepo ? (
                <div className="max-h-64 overflow-y-auto">
                  {repositories
                    ?.filter(
                      (repo) =>
                        !normalizedQuery ||
                        repo.name.toLowerCase().includes(normalizedQuery) ||
                        repoBranchesCache
                          .get(repo.path)
                          ?.some((candidate) =>
                            candidate.name.toLowerCase().includes(normalizedQuery),
                          ),
                    )
                    .map((repo) => {
                      const isSelected = repo.path === selectedRepoPath;
                      const isExpanded = expandedRepos.has(repo.path);
                      const isLoading = loadingRepos.has(repo.path);
                      const repoBranches = repoBranchesCache.get(repo.path) ?? [];
                      const repoLocalBranches = repoBranches.filter(
                        (candidate) => !candidate.isRemote,
                      );
                      const currentRepoBranch = repoBranches.find(
                        (candidate) => candidate.isCurrent,
                      );
                      const filteredBranches = normalizedQuery
                        ? repoLocalBranches.filter((candidate) =>
                            candidate.name.toLowerCase().includes(normalizedQuery),
                          )
                        : repoLocalBranches;

                      return (
                        <div key={repo.path} className={isSelected ? "bg-maestro-accent/5" : ""}>
                          <div className="flex items-center gap-1 px-2 py-1.5 hover:bg-maestro-surface">
                            {repo.isGitRepo ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void toggleRepoExpanded(repo.path);
                                }}
                                className="shrink-0 rounded p-0.5 hover:bg-maestro-border/40"
                              >
                                {isLoading ? (
                                  <Loader2 size={12} className="animate-spin text-maestro-muted" />
                                ) : isExpanded ? (
                                  <ChevronDown size={12} className="text-maestro-muted" />
                                ) : (
                                  <ChevronRight size={12} className="text-maestro-muted" />
                                )}
                              </button>
                            ) : (
                              <span className="inline-block w-[20px]" />
                            )}

                            <button
                              type="button"
                              onClick={() => handleSelectRepo(repo.path)}
                              className="flex flex-1 items-center gap-2 text-left text-sm"
                            >
                              <FolderOpen
                                size={14}
                                className={`shrink-0 ${repo.isGitRepo ? "text-maestro-purple" : "text-maestro-muted"}`}
                              />
                              <span
                                className={`flex-1 truncate ${isSelected ? "text-maestro-text font-medium" : "text-maestro-muted"}`}
                              >
                                {repo.name}
                              </span>
                              {repo.isGitRepo && currentRepoBranch && (
                                <span className="text-[10px] text-maestro-muted">
                                  {currentRepoBranch.name}
                                </span>
                              )}
                              {!repo.isGitRepo && (
                                <span className="text-[10px] text-maestro-muted/60">no git</span>
                              )}
                              {isSelected && (
                                <Check size={12} className="shrink-0 text-maestro-accent" />
                              )}
                            </button>
                          </div>

                          {repo.isGitRepo && isExpanded && !isLoading && (
                            <div className="ml-5 border-l border-maestro-border/40 pl-2">
                              <button
                                type="button"
                                onClick={() => handleSelectRepoBranch(repo.path, null)}
                                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-maestro-surface ${
                                  isSelected && branch === null
                                    ? "bg-maestro-accent/10 text-maestro-text"
                                    : "text-maestro-muted"
                                }`}
                              >
                                <GitBranch size={12} />
                                <span>Use current branch</span>
                                {currentRepoBranch && (
                                  <span className="text-[10px] text-maestro-muted/60">
                                    ({currentRepoBranch.name})
                                  </span>
                                )}
                              </button>

                              {filteredBranches.map((candidate) => {
                                const isBranchSelected = isSelected && branch === candidate.name;
                                return (
                                  <button
                                    key={candidate.name}
                                    type="button"
                                    onClick={() =>
                                      handleSelectRepoBranch(repo.path, candidate.name)
                                    }
                                    className={`flex w-full items-center gap-2 px-2 py-1 text-left text-xs transition-colors hover:bg-maestro-surface ${
                                      isBranchSelected
                                        ? "bg-maestro-accent/10 text-maestro-text"
                                        : "text-maestro-muted"
                                    }`}
                                  >
                                    <GitBranch size={11} />
                                    <span className="flex-1 truncate">{candidate.name}</span>
                                    {candidate.isCurrent && (
                                      <Star
                                        size={10}
                                        className="shrink-0 text-maestro-green"
                                        fill="currentColor"
                                      />
                                    )}
                                    {candidate.hasWorktree && (
                                      <FolderGit2
                                        size={10}
                                        className="shrink-0 text-maestro-orange"
                                      />
                                    )}
                                  </button>
                                );
                              })}

                              {searchQuery.trim() &&
                                isValidBranchName(searchQuery.trim()) &&
                                !repoBranches.some(
                                  (candidate) => candidate.name === searchQuery.trim(),
                                ) && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleSelectRepoBranch(repo.path, searchQuery.trim())
                                    }
                                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-maestro-accent transition-colors hover:bg-maestro-accent/10"
                                  >
                                    <Plus size={11} />
                                    <span className="truncate">
                                      Create{" "}
                                      <span className="font-medium">{searchQuery.trim()}</span>
                                    </span>
                                  </button>
                                )}

                              {filteredBranches.length === 0 &&
                                repoBranches.length > 0 &&
                                searchQuery &&
                                !isValidBranchName(searchQuery.trim()) && (
                                  <div className="px-2 py-1 text-[10px] text-maestro-muted">
                                    No matching branches
                                  </div>
                                )}

                              {onCreateBranch &&
                                (repoCreateBranch === repo.path ? (
                                  <div className="border-t border-maestro-border/40 px-2 py-1.5">
                                    <div className="space-y-1.5">
                                      <input
                                        ref={repoCreateInputRef}
                                        type="text"
                                        value={repoNewBranchName}
                                        onChange={(event) => {
                                          setRepoNewBranchName(event.target.value);
                                          setRepoCreateError(null);
                                        }}
                                        onKeyDown={(event) => {
                                          if (event.key === "Enter") {
                                            event.preventDefault();
                                            void createRepoBranch(
                                              repo.path,
                                              repoNewBranchName.trim(),
                                              true,
                                            );
                                          } else if (event.key === "Escape") {
                                            event.preventDefault();
                                            setRepoCreateBranch(null);
                                            setRepoNewBranchName("");
                                            setRepoCreateError(null);
                                          }
                                        }}
                                        placeholder="feature/my-branch"
                                        className="w-full rounded border border-maestro-border bg-maestro-surface px-2 py-1 text-xs text-maestro-text placeholder:text-maestro-muted/50 focus:border-maestro-accent focus:outline-none"
                                        disabled={repoCreatingBranch}
                                        onClick={(event) => event.stopPropagation()}
                                      />
                                      <div className="flex justify-end gap-1.5">
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            void createRepoBranch(
                                              repo.path,
                                              repoNewBranchName.trim(),
                                              false,
                                            );
                                          }}
                                          disabled={!repoNewBranchName.trim() || repoCreatingBranch}
                                          className="rounded border border-maestro-border bg-maestro-surface px-2 py-1 text-xs font-medium text-maestro-text disabled:opacity-50 hover:bg-maestro-border/40"
                                          title="Create branch without selecting"
                                        >
                                          {repoCreatingBranch ? "..." : "Create"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            void createRepoBranch(
                                              repo.path,
                                              repoNewBranchName.trim(),
                                              true,
                                            );
                                          }}
                                          disabled={!repoNewBranchName.trim() || repoCreatingBranch}
                                          className="rounded bg-maestro-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                                          title="Create branch and select it"
                                        >
                                          {repoCreatingBranch ? "..." : "Create & Select"}
                                        </button>
                                      </div>
                                    </div>
                                    {repoCreateError && (
                                      <div className="mt-1 text-[10px] text-maestro-red">
                                        {repoCreateError}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setRepoCreateBranch(repo.path);
                                      setRepoNewBranchName("");
                                      setRepoCreateError(null);
                                    }}
                                    className="flex w-full items-center gap-2 border-t border-maestro-border/40 px-2 py-1.5 text-xs text-maestro-accent transition-colors hover:bg-maestro-accent/10"
                                  >
                                    <Plus size={11} />
                                    <span>Create branch</span>
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                      );
                    })}

                  {searchQuery &&
                    repositories?.filter(
                      (repo) =>
                        repo.name.toLowerCase().includes(normalizedQuery) ||
                        repoBranchesCache
                          .get(repo.path)
                          ?.some((candidate) =>
                            candidate.name.toLowerCase().includes(normalizedQuery),
                          ),
                    ).length === 0 && (
                      <div className="px-3 py-2 text-center text-xs text-maestro-muted">
                        No repos or branches match "{searchQuery}"
                      </div>
                    )}
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto">
                  {(!searchQuery || "use current branch".includes(normalizedQuery)) && (
                    <button
                      type="button"
                      onClick={() => {
                        onBranchChange(null);
                        closeDropdown();
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                        branch === null
                          ? "bg-maestro-accent/10 text-maestro-text"
                          : "text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text"
                      }`}
                    >
                      <GitBranch size={14} />
                      <span>Use current branch</span>
                    </button>
                  )}

                  {localBranches.filter((candidate) =>
                    candidate.name.toLowerCase().includes(normalizedQuery),
                  ).length > 0 && (
                    <>
                      <div className="border-t border-maestro-border px-3 py-1 text-[9px] font-medium uppercase tracking-wide text-maestro-muted">
                        Local
                      </div>
                      {localBranches
                        .filter((candidate) =>
                          candidate.name.toLowerCase().includes(normalizedQuery),
                        )
                        .map((candidate) => (
                          <button
                            key={candidate.name}
                            type="button"
                            onClick={() => {
                              onBranchChange(candidate.name);
                              closeDropdown();
                            }}
                            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                              branch === candidate.name
                                ? "bg-maestro-accent/10 text-maestro-text"
                                : "text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text"
                            }`}
                          >
                            <GitBranch size={14} />
                            <span className="truncate">{candidate.name}</span>
                            {candidate.hasWorktree && (
                              <span title="Worktree exists">
                                <FolderGit2 size={12} className="shrink-0 text-maestro-orange" />
                              </span>
                            )}
                            {candidate.isCurrent && (
                              <span className="shrink-0 rounded bg-maestro-green/20 px-1 text-[9px] text-maestro-green">
                                current
                              </span>
                            )}
                          </button>
                        ))}
                    </>
                  )}

                  {remoteBranches.filter((candidate) =>
                    candidate.name.toLowerCase().includes(normalizedQuery),
                  ).length > 0 && (
                    <>
                      <div className="border-t border-maestro-border px-3 py-1 text-[9px] font-medium uppercase tracking-wide text-maestro-muted">
                        Remote
                      </div>
                      {remoteBranches
                        .filter((candidate) =>
                          candidate.name.toLowerCase().includes(normalizedQuery),
                        )
                        .map((candidate) => (
                          <button
                            key={candidate.name}
                            type="button"
                            onClick={() => {
                              onBranchChange(candidate.name);
                              closeDropdown();
                            }}
                            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                              branch === candidate.name
                                ? "bg-maestro-accent/10 text-maestro-text"
                                : "text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text"
                            }`}
                          >
                            <GitBranch size={14} className="text-maestro-muted/60" />
                            <span className="truncate">{candidate.name}</span>
                            {candidate.hasWorktree && (
                              <span title="Worktree exists">
                                <FolderGit2 size={12} className="shrink-0 text-maestro-orange" />
                              </span>
                            )}
                          </button>
                        ))}
                    </>
                  )}

                  {searchQuery.trim() &&
                    isValidBranchName(searchQuery.trim()) &&
                    !branches.some((candidate) => candidate.name === searchQuery.trim()) && (
                      <>
                        <div className="border-t border-maestro-border px-3 py-1 text-[9px] font-medium uppercase tracking-wide text-maestro-muted">
                          Create
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onBranchChange(searchQuery.trim());
                            closeDropdown();
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-maestro-accent transition-colors hover:bg-maestro-accent/10"
                        >
                          <Plus size={14} />
                          <span className="truncate">
                            Create <span className="font-medium">{searchQuery.trim()}</span>
                          </span>
                        </button>
                      </>
                    )}

                  {searchQuery &&
                    !isValidBranchName(searchQuery.trim()) &&
                    localBranches.filter((candidate) =>
                      candidate.name.toLowerCase().includes(normalizedQuery),
                    ).length === 0 &&
                    remoteBranches.filter((candidate) =>
                      candidate.name.toLowerCase().includes(normalizedQuery),
                    ).length === 0 &&
                    !"use current branch".includes(normalizedQuery) && (
                      <div className="px-3 py-2 text-center text-xs text-maestro-muted">
                        No branches match "{searchQuery}"
                      </div>
                    )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
