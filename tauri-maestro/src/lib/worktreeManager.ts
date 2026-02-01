import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";

/** Worktree info from the backend. */
export interface WorktreeInfo {
  path: string;
  head: string;
  branch: string | null;
  is_bare: boolean;
}

/** Result of preparing a worktree for a session. */
export interface WorktreePreparationResult {
  /** The directory where the session should run (worktree or project path). */
  working_directory: string;
  /** The worktree path if one was created or reused. */
  worktree_path: string | null;
  /** Whether a new worktree was created (vs. reused or skipped). */
  created: boolean;
  /** Warning message if something unexpected happened but we recovered. */
  warning: string | null;
}

/**
 * Generates a hash from a string for creating unique worktree paths.
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).slice(0, 8);
}

/**
 * Sanitizes a branch name for use in filesystem paths.
 */
function sanitizeBranch(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9_-]/g, "-");
}

/**
 * Gets the base directory for worktrees.
 * Uses ~/.claude-maestro/worktrees/
 */
async function getWorktreeBaseDir(): Promise<string> {
  const home = await homeDir();
  return `${home}.claude-maestro/worktrees`;
}

/**
 * Calculates the worktree path for a given repo and branch.
 *
 * Path format: ~/.claude-maestro/worktrees/{repoHash}/{sanitizedBranch}/
 *
 * @param repoPath - The path to the main repository
 * @param branch - The branch name
 * @returns The worktree path
 */
export async function getWorktreePath(repoPath: string, branch: string): Promise<string> {
  const baseDir = await getWorktreeBaseDir();
  const repoHash = hashString(repoPath);
  const sanitizedBranch = sanitizeBranch(branch);
  return `${baseDir}/${repoHash}/${sanitizedBranch}`;
}

/**
 * Creates a worktree for a session on a specific branch.
 *
 * If the worktree already exists for this branch, returns its path.
 * If a new branch is needed, creates it from the current HEAD.
 *
 * @param repoPath - The path to the main repository
 * @param sessionId - The session ID (for logging)
 * @param branch - The branch to checkout in the worktree
 * @param createBranch - Whether to create a new branch (default: false)
 * @returns The worktree path
 */
export async function createSessionWorktree(
  repoPath: string,
  sessionId: number,
  branch: string,
  createBranch = false
): Promise<string> {
  const worktreePath = await getWorktreePath(repoPath, branch);

  try {
    // Check if worktree already exists
    const existingWorktrees = await invoke<WorktreeInfo[]>("git_worktree_list", {
      repoPath,
    });

    const existing = existingWorktrees.find((wt) => wt.path === worktreePath);
    if (existing) {
      console.log(`[Session ${sessionId}] Worktree already exists at ${worktreePath}`);
      return worktreePath;
    }

    // Create the worktree
    const result = await invoke<WorktreeInfo>("git_worktree_add", {
      repoPath,
      path: worktreePath,
      newBranch: createBranch ? branch : null,
      checkoutRef: createBranch ? null : branch,
    });

    console.log(`[Session ${sessionId}] Created worktree at ${result.path} on branch ${result.branch}`);
    return result.path;
  } catch (err) {
    console.error(`[Session ${sessionId}] Failed to create worktree:`, err);
    throw err;
  }
}

/**
 * Removes a worktree associated with a session.
 *
 * @param repoPath - The path to the main repository
 * @param worktreePath - The worktree path to remove
 * @param force - Whether to force removal even with uncommitted changes
 */
export async function removeSessionWorktree(
  repoPath: string,
  worktreePath: string,
  force = false
): Promise<void> {
  try {
    await invoke("git_worktree_remove", {
      repoPath,
      path: worktreePath,
      force,
    });
    console.log(`Removed worktree at ${worktreePath}`);
  } catch (err) {
    console.error(`Failed to remove worktree at ${worktreePath}:`, err);
    throw err;
  }
}

/**
 * Lists all worktrees for a repository.
 *
 * @param repoPath - The path to the main repository
 * @returns List of worktree info
 */
export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  return invoke<WorktreeInfo[]>("git_worktree_list", { repoPath });
}

/**
 * Checks if a worktree exists for a given branch.
 *
 * @param repoPath - The path to the main repository
 * @param branch - The branch name to check
 * @returns True if a worktree exists for this branch
 */
export async function worktreeExistsForBranch(
  repoPath: string,
  branch: string
): Promise<boolean> {
  const worktrees = await listWorktrees(repoPath);
  return worktrees.some((wt) => wt.branch === branch);
}

/**
 * Gets the worktree info for a specific branch if it exists.
 *
 * @param repoPath - The path to the main repository
 * @param branch - The branch name
 * @returns Worktree info or null if not found
 */
export async function getWorktreeForBranch(
  repoPath: string,
  branch: string
): Promise<WorktreeInfo | null> {
  const worktrees = await listWorktrees(repoPath);
  return worktrees.find((wt) => wt.branch === branch) ?? null;
}

/**
 * Prepares a worktree for a session, handling all edge cases gracefully.
 *
 * This function orchestrates worktree creation for a session launch:
 * - If no branch is specified, returns the project path as-is.
 * - If a worktree already exists for this branch, reuses it.
 * - If the branch is checked out in the main repo, switches main to default branch first.
 * - If the branch doesn't exist locally, creates it from HEAD.
 * - Creates the worktree via the backend WorktreeManager.
 *
 * On any failure, falls back to the project path so sessions always launch.
 *
 * @param projectPath - The path to the main repository
 * @param branch - The branch to checkout in the worktree (null to skip worktree)
 * @returns The preparation result with the working directory to use
 */
export async function prepareSessionWorktree(
  projectPath: string,
  branch: string | null
): Promise<WorktreePreparationResult> {
  try {
    const result = await invoke<WorktreePreparationResult>("prepare_session_worktree", {
      projectPath,
      branch,
    });

    if (result.warning) {
      console.warn(`Worktree warning: ${result.warning}`);
    }

    if (result.created) {
      console.log(`Created worktree at ${result.worktree_path}`);
    } else if (result.worktree_path) {
      console.log(`Reusing worktree at ${result.worktree_path}`);
    } else {
      console.log(`Using project path (no worktree)`);
    }

    return result;
  } catch (err) {
    console.error(`Failed to prepare worktree:`, err);
    // Fall back to project path on error
    return {
      working_directory: projectPath,
      worktree_path: null,
      created: false,
      warning: `Failed to prepare worktree: ${err}`,
    };
  }
}

/**
 * Cleans up a worktree when a session ends.
 *
 * Removes the worktree from the filesystem and prunes git refs.
 * Failures are logged but don't prevent session cleanup.
 *
 * @param projectPath - The path to the main repository
 * @param worktreePath - The worktree path to clean up
 * @returns True if a worktree was cleaned up, false otherwise
 */
export async function cleanupSessionWorktree(
  projectPath: string,
  worktreePath: string | null
): Promise<boolean> {
  if (!worktreePath) {
    return false;
  }

  try {
    const cleaned = await invoke<boolean>("cleanup_session_worktree", {
      projectPath,
      worktreePath,
    });

    if (cleaned) {
      console.log(`Cleaned up worktree at ${worktreePath}`);
    }

    return cleaned;
  } catch (err) {
    console.error(`Failed to cleanup worktree at ${worktreePath}:`, err);
    return false;
  }
}
