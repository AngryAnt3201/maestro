import { invoke } from "@tauri-apps/api/core";
import { listWorktrees } from "./worktreeManager";

/** Branch info from the backend. */
export interface BranchInfo {
  name: string;
  is_remote: boolean;
  is_current: boolean;
}

/** Extended branch info with worktree status for UI display. */
export interface BranchWithWorktreeStatus {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
  hasWorktree: boolean;
}

/**
 * Shared cache for in-flight branch fetches to avoid redundant IPC calls
 * when multiple components in the same project poll or fetch simultaneously.
 */
const activeFetches = new Map<string, Promise<string>>();

/**
 * Fetches all branches for a repository.
 * @param repoPath - Path to the git repository
 * @returns List of branch info from the backend
 */
export async function getBranches(repoPath: string): Promise<BranchInfo[]> {
  return invoke<BranchInfo[]>("git_branches", { repoPath });
}

/**
 * Fetches branches with worktree status indicators.
 * Combines branch list with worktree info to show which branches already have worktrees.
 *
 * @param repoPath - Path to the git repository
 * @returns List of branches with worktree status
 */
export async function getBranchesWithWorktreeStatus(
  repoPath: string
): Promise<BranchWithWorktreeStatus[]> {
  const [branches, worktrees] = await Promise.all([
    getBranches(repoPath),
    listWorktrees(repoPath).catch(() => []), // Gracefully handle non-git repos
  ]);

  const worktreeBranches = new Set(
    worktrees.map((wt) => wt.branch).filter((b): b is string => b !== null)
  );

  return branches.map((branch) => ({
    name: branch.name,
    isRemote: branch.is_remote,
    isCurrent: branch.is_current,
    hasWorktree: worktreeBranches.has(branch.name),
  }));
}

/**
 * Gets the current branch name for a repository.
 * @param repoPath - Path to the git repository
 * @returns Current branch name or short commit hash if detached
 */
export async function getCurrentBranch(repoPath: string): Promise<string> {
  return invoke<string>("git_current_branch", { repoPath });
}

/**
 * Gets the current branch name, deduplicating simultaneous requests for the same path.
 * Useful when multiple sessions or components need the branch status at once.
 *
 * @param repoPath - Path to the git repository
 * @returns Current branch name
 */
export async function getDeduplicatedCurrentBranch(repoPath: string): Promise<string> {
  const existing = activeFetches.get(repoPath);
  if (existing) return existing;

  const promise = getCurrentBranch(repoPath).finally(() => {
    activeFetches.delete(repoPath);
  });
  activeFetches.set(repoPath, promise);
  return promise;
}
