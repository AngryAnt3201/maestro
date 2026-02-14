import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

/** Branch info returned from the backend. */
export interface BranchInfo {
  name: string;
  is_remote: boolean;
  is_current: boolean;
}

/** Commit info returned from the backend. */
export interface CommitInfo {
  hash: string;
  short_hash: string;
  parent_hashes: string[];
  author_name: string;
  author_email: string;
  timestamp: number;
  summary: string;
}

/** File change status enum. */
export type FileChangeStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "unknown";

/** File changed in a commit. */
export interface FileChange {
  path: string;
  status: FileChangeStatus;
  old_path?: string;
}

/** Git user configuration. */
export interface GitUserConfig {
  name: string | null;
  email: string | null;
}

/** Remote repository info. */
export interface RemoteInfo {
  name: string;
  url: string;
}

/** Remote connection status. */
export type RemoteStatus = "unknown" | "checking" | "connected" | "disconnected";

/** Worktree info returned from the backend. */
export interface WorktreeInfo {
  path: string;
  head: string;
  branch: string | null;
  is_bare: boolean;
}

/**
 * Zustand store for centralized git state management.
 *
 * Handles branches, commits, user config, and remotes for the active repository.
 */
interface GitState {
  // Branch state
  currentBranch: string | null;
  branches: BranchInfo[];

  // Commit state
  commits: CommitInfo[];
  hasMoreCommits: boolean;

  // Config state
  userConfig: GitUserConfig | null;
  remotes: RemoteInfo[];
  remoteStatuses: Record<string, RemoteStatus>;
  defaultBranch: string | null;

  // Loading/error state
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;

  // Actions
  fetchBranches: (repoPath: string) => Promise<void>;
  fetchCurrentBranch: (repoPath: string) => Promise<void>;
  fetchCommits: (repoPath: string, maxCount?: number, allBranches?: boolean) => Promise<void>;
  loadMoreCommits: (repoPath: string, allBranches?: boolean) => Promise<void>;
  checkoutBranch: (repoPath: string, branchName: string) => Promise<void>;
  createBranch: (repoPath: string, branchName: string, startPoint?: string) => Promise<void>;
  fetchUserConfig: (repoPath: string) => Promise<void>;
  setUserConfig: (
    repoPath: string,
    name: string | null,
    email: string | null,
    global?: boolean
  ) => Promise<void>;
  fetchRemotes: (repoPath: string) => Promise<void>;
  addRemote: (repoPath: string, name: string, url: string) => Promise<void>;
  removeRemote: (repoPath: string, name: string) => Promise<void>;
  setRemoteUrl: (repoPath: string, name: string, url: string) => Promise<void>;
  testRemote: (repoPath: string, remoteName: string) => Promise<void>;
  testAllRemotes: (repoPath: string) => Promise<void>;
  fetchDefaultBranch: (repoPath: string) => Promise<void>;
  setDefaultBranch: (repoPath: string, branch: string, global?: boolean) => Promise<void>;
  getCommitFiles: (repoPath: string, commitHash: string) => Promise<FileChange[]>;
  getRefsForCommit: (repoPath: string, commitHash: string) => Promise<string[]>;
  push: (repoPath: string, remote?: string, branch?: string, setUpstream?: boolean, forceWithLease?: boolean) => Promise<string>;
  pull: (repoPath: string, remote?: string, branch?: string, ffOnly?: boolean) => Promise<string>;
  fetch: (repoPath: string, remote?: string) => Promise<void>;
  reset: () => void;
}

const INITIAL_COMMIT_COUNT = 50;
const LOAD_MORE_COUNT = 50;

export const useGitStore = create<GitState>()((set, get) => ({
  // Initial state
  currentBranch: null,
  branches: [],
  commits: [],
  hasMoreCommits: true,
  userConfig: null,
  remotes: [],
  remoteStatuses: {},
  defaultBranch: null,
  isLoading: false,
  isLoadingMore: false,
  error: null,

  fetchBranches: async (repoPath: string) => {
    set({ isLoading: true, error: null });
    try {
      const branches = await invoke<BranchInfo[]>("git_branches", { repoPath });
      set({ branches, isLoading: false });
    } catch (err) {
      console.error("Failed to fetch branches:", err);
      set({ error: String(err), isLoading: false, branches: [] });
    }
  },

  fetchCurrentBranch: async (repoPath: string) => {
    try {
      const currentBranch = await invoke<string>("git_current_branch", { repoPath });
      set({ currentBranch });
    } catch (err) {
      console.error("Failed to fetch current branch:", err);
      set({ currentBranch: null });
    }
  },

  fetchCommits: async (repoPath: string, maxCount = INITIAL_COMMIT_COUNT, allBranches = true) => {
    set({ isLoading: true, error: null });
    try {
      const commits = await invoke<CommitInfo[]>("git_commit_log", {
        repoPath,
        maxCount,
        allBranches,
      });
      set({
        commits,
        isLoading: false,
        hasMoreCommits: commits.length >= maxCount,
      });
    } catch (err) {
      console.error("Failed to fetch commits:", err);
      set({ error: String(err), isLoading: false, commits: [] });
    }
  },

  loadMoreCommits: async (repoPath: string, allBranches = true) => {
    const { commits, hasMoreCommits, isLoadingMore } = get();
    if (!hasMoreCommits || isLoadingMore) return;

    set({ isLoadingMore: true });
    try {
      const newCount = commits.length + LOAD_MORE_COUNT;
      const allCommits = await invoke<CommitInfo[]>("git_commit_log", {
        repoPath,
        maxCount: newCount,
        allBranches,
      });
      set({
        commits: allCommits,
        isLoadingMore: false,
        hasMoreCommits: allCommits.length >= newCount,
      });
    } catch (err) {
      console.error("Failed to load more commits:", err);
      set({ isLoadingMore: false });
    }
  },

  checkoutBranch: async (repoPath: string, branchName: string) => {
    set({ isLoading: true, error: null });
    try {
      await invoke("git_checkout_branch", { repoPath, branchName });
      // Refresh current branch and commits after checkout
      const currentBranch = await invoke<string>("git_current_branch", { repoPath });
      set({ currentBranch, isLoading: false });
      // Refresh commits
      get().fetchCommits(repoPath);
    } catch (err) {
      console.error("Failed to checkout branch:", err);
      set({ error: String(err), isLoading: false });
      throw err;
    }
  },

  createBranch: async (repoPath: string, branchName: string, startPoint?: string) => {
    set({ isLoading: true, error: null });
    try {
      await invoke("git_create_branch", {
        repoPath,
        branchName,
        startPoint: startPoint ?? null,
      });
      // Refresh branches after creation
      await get().fetchBranches(repoPath);
      set({ isLoading: false });
    } catch (err) {
      console.error("Failed to create branch:", err);
      set({ error: String(err), isLoading: false });
      throw err;
    }
  },

  fetchUserConfig: async (repoPath: string) => {
    try {
      const userConfig = await invoke<GitUserConfig>("git_user_config", { repoPath });
      set({ userConfig });
    } catch (err) {
      console.error("Failed to fetch user config:", err);
      set({ userConfig: null });
    }
  },

  setUserConfig: async (
    repoPath: string,
    name: string | null,
    email: string | null,
    global = false
  ) => {
    try {
      await invoke("git_set_user_config", {
        repoPath,
        name,
        email,
        global,
      });
      // Refresh config
      await get().fetchUserConfig(repoPath);
    } catch (err) {
      console.error("Failed to set user config:", err);
      throw err;
    }
  },

  fetchRemotes: async (repoPath: string) => {
    try {
      const remotes = await invoke<RemoteInfo[]>("git_list_remotes", { repoPath });
      set({ remotes });
    } catch (err) {
      console.error("Failed to fetch remotes:", err);
      set({ remotes: [] });
    }
  },

  addRemote: async (repoPath: string, name: string, url: string) => {
    try {
      await invoke("git_add_remote", { repoPath, name, url });
      await get().fetchRemotes(repoPath);
    } catch (err) {
      console.error("Failed to add remote:", err);
      throw err;
    }
  },

  removeRemote: async (repoPath: string, name: string) => {
    try {
      await invoke("git_remove_remote", { repoPath, name });
      // Also remove from remoteStatuses
      const { remoteStatuses } = get();
      const newStatuses = { ...remoteStatuses };
      delete newStatuses[name];
      set({ remoteStatuses: newStatuses });
      await get().fetchRemotes(repoPath);
    } catch (err) {
      console.error("Failed to remove remote:", err);
      throw err;
    }
  },

  setRemoteUrl: async (repoPath: string, name: string, url: string) => {
    try {
      await invoke("git_set_remote_url", { repoPath, name, url });
      await get().fetchRemotes(repoPath);
    } catch (err) {
      console.error("Failed to set remote URL:", err);
      throw err;
    }
  },

  testRemote: async (repoPath: string, remoteName: string) => {
    // Set status to checking
    set((state) => ({
      remoteStatuses: { ...state.remoteStatuses, [remoteName]: "checking" },
    }));
    try {
      const connected = await invoke<boolean>("git_test_remote", { repoPath, remoteName });
      set((state) => ({
        remoteStatuses: {
          ...state.remoteStatuses,
          [remoteName]: connected ? "connected" : "disconnected",
        },
      }));
    } catch (err) {
      console.error("Failed to test remote:", err);
      set((state) => ({
        remoteStatuses: { ...state.remoteStatuses, [remoteName]: "disconnected" },
      }));
    }
  },

  testAllRemotes: async (repoPath: string) => {
    const { remotes } = get();
    // Set all to checking
    const checkingStatuses: Record<string, RemoteStatus> = {};
    for (const remote of remotes) {
      checkingStatuses[remote.name] = "checking";
    }
    set({ remoteStatuses: checkingStatuses });

    // Test all in parallel
    await Promise.all(remotes.map((remote) => get().testRemote(repoPath, remote.name)));
  },

  fetchDefaultBranch: async (repoPath: string) => {
    try {
      const defaultBranch = await invoke<string | null>("git_get_default_branch", { repoPath });
      set({ defaultBranch });
    } catch (err) {
      console.error("Failed to fetch default branch:", err);
      set({ defaultBranch: null });
    }
  },

  setDefaultBranch: async (repoPath: string, branch: string, global = false) => {
    try {
      await invoke("git_set_default_branch", { repoPath, branch, global });
      await get().fetchDefaultBranch(repoPath);
    } catch (err) {
      console.error("Failed to set default branch:", err);
      throw err;
    }
  },

  getCommitFiles: async (repoPath: string, commitHash: string): Promise<FileChange[]> => {
    try {
      return await invoke<FileChange[]>("git_commit_files", { repoPath, commitHash });
    } catch (err) {
      console.error("Failed to get commit files:", err);
      return [];
    }
  },

  getRefsForCommit: async (repoPath: string, commitHash: string): Promise<string[]> => {
    try {
      return await invoke<string[]>("git_refs_for_commit", { repoPath, commitHash });
    } catch (err) {
      console.error("Failed to get refs for commit:", err);
      return [];
    }
  },

  push: async (
    repoPath: string,
    remote = "origin",
    branch?: string,
    setUpstream = false,
    forceWithLease = false,
  ): Promise<string> => {
    try {
      return await invoke<string>("git_push", {
        repoPath,
        remote,
        branch: branch ?? null,
        setUpstream,
        forceWithLease,
      });
    } catch (err) {
      console.error("Failed to push:", err);
      throw err;
    }
  },

  pull: async (
    repoPath: string,
    remote = "origin",
    branch?: string,
    ffOnly = true,
  ): Promise<string> => {
    try {
      return await invoke<string>("git_pull", {
        repoPath,
        remote,
        branch: branch ?? null,
        ffOnly,
      });
    } catch (err) {
      console.error("Failed to pull:", err);
      throw err;
    }
  },

  fetch: async (repoPath: string, remote?: string): Promise<void> => {
    try {
      await invoke("git_fetch", { repoPath, remote: remote ?? null });
    } catch (err) {
      console.error("Failed to fetch:", err);
      throw err;
    }
  },

  reset: () => {
    set({
      currentBranch: null,
      branches: [],
      commits: [],
      hasMoreCommits: true,
      userConfig: null,
      remotes: [],
      remoteStatuses: {},
      defaultBranch: null,
      isLoading: false,
      isLoadingMore: false,
      error: null,
    });
  },
}));
