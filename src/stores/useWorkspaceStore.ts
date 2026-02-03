import { LazyStore } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { killSession } from "@/lib/terminal";

// --- Types ---

/** The type of workspace - single repo, multi-repo, or non-git. */
export type WorkspaceType = "single-repo" | "multi-repo" | "non-git";

/** Information about a detected git repository within a workspace. */
export interface RepositoryInfo {
  /** Absolute path to the repository root. */
  path: string;
  /** Display name (folder name). */
  name: string;
  /** Current branch name (if available). */
  currentBranch: string | null;
  /** Primary remote URL (origin, or first remote if no origin). */
  remoteUrl: string | null;
}

/**
 * Represents a single open project tab in the workspace sidebar.
 *
 * @property id - Random UUID generated on creation; stable across persisted sessions.
 * @property projectPath - Absolute filesystem path; used as the dedup key in `openProject`.
 * @property active - Exactly one tab should be active at a time; enforced by store actions.
 * @property sessionIds - PTY session IDs belonging to this project.
 * @property sessionsLaunched - Whether user has launched sessions for this project.
 * @property workspaceType - Whether this is a single repo, multi-repo workspace, or non-git.
 * @property repositories - Detected repositories within this workspace (empty for single-repo).
 * @property selectedRepoPath - Currently selected repository path for git operations.
 */
export type WorkspaceTab = {
  id: string;
  name: string;
  projectPath: string;
  active: boolean;
  sessionIds: number[];
  sessionsLaunched: boolean;
  workspaceType: WorkspaceType;
  repositories: RepositoryInfo[];
  selectedRepoPath: string | null;
};

/** Read-only slice of the workspace store; persisted to disk via Zustand `persist`. */
type WorkspaceState = {
  tabs: WorkspaceTab[];
};

/**
 * Mutating actions for workspace tab management.
 * All actions are synchronous and trigger a Zustand persist write-through
 * to the Tauri LazyStore (async, fire-and-forget).
 */
type WorkspaceActions = {
  openProject: (path: string) => Promise<void>;
  selectTab: (id: string) => void;
  closeTab: (id: string) => void;
  addSessionToProject: (tabId: string, sessionId: number) => void;
  removeSessionFromProject: (tabId: string, sessionId: number) => void;
  setSessionsLaunched: (tabId: string, launched: boolean) => void;
  getTabByPath: (projectPath: string) => WorkspaceTab | undefined;
  /** Switch selected repository for a tab (multi-repo workspaces). */
  setSelectedRepo: (tabId: string, repoPath: string) => void;
  /** Update repositories list after recursive scan. */
  updateRepositories: (tabId: string, repositories: RepositoryInfo[]) => void;
};

// --- Tauri LazyStore-backed StateStorage adapter ---

/**
 * Singleton LazyStore instance pointing to `store.json` in the Tauri app-data dir.
 * LazyStore lazily initialises the underlying file on first read/write.
 */
const lazyStore = new LazyStore("store.json");

/**
 * Zustand-compatible {@link StateStorage} adapter backed by the Tauri plugin-store.
 *
 * Each `setItem`/`removeItem` call issues an explicit `save()` to flush to disk,
 * because LazyStore only writes on shutdown by default and data would be lost
 * if the app is force-quit.
 */
const tauriStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const value = await lazyStore.get<string>(name);
      return value ?? null;
    } catch (err) {
      console.error(`tauriStorage.getItem("${name}") failed:`, err);
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      await lazyStore.set(name, value);
      await lazyStore.save();
    } catch (err) {
      console.error(`tauriStorage.setItem("${name}") failed:`, err);
      throw err; // Let Zustand persist middleware handle it
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      await lazyStore.delete(name);
      await lazyStore.save();
    } catch (err) {
      console.error(`tauriStorage.removeItem("${name}") failed:`, err);
      throw err; // Re-throw for consistency with setItem
    }
  },
};

// --- Helpers ---

/** Extracts the last path segment to use as a human-readable tab label. */
function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/);
  return segments[segments.length - 1] || path;
}

// --- Store ---

/**
 * Global workspace store managing open project tabs.
 *
 * Uses Zustand `persist` middleware with a custom Tauri LazyStore-backed storage
 * adapter so tabs survive app restarts. Only the `tabs` array is persisted
 * (via `partialize`); actions are excluded.
 *
 * Key behaviors:
 * - `openProject` deduplicates by `projectPath` -- opening the same path twice
 *   simply activates the existing tab.
 * - `closeTab` auto-activates the first remaining tab when the closed tab was active.
 */
export const useWorkspaceStore = create<WorkspaceState & WorkspaceActions>()(
  persist(
    (set, get) => ({
      tabs: [],

      openProject: async (path: string) => {
        const { tabs } = get();

        // Deduplicate: if path already open, just activate that tab
        const existing = tabs.find((t) => t.projectPath === path);
        if (existing) {
          set({
            tabs: tabs.map((t) => ({ ...t, active: t.id === existing.id })),
          });
          return;
        }

        const id = crypto.randomUUID();
        const name = basename(path);

        // Detect workspace type
        let workspaceType: WorkspaceType;
        let repositories: RepositoryInfo[] = [];
        let selectedRepoPath: string | null = null;

        try {
          const isRepo = await invoke<boolean>("is_git_repository", { path });

          if (isRepo) {
            // Single repository - existing behavior
            workspaceType = "single-repo";
            selectedRepoPath = path;
          } else {
            // Check for nested repositories
            repositories = await invoke<RepositoryInfo[]>("detect_repositories", { path });
            workspaceType = repositories.length > 0 ? "multi-repo" : "non-git";
            selectedRepoPath = repositories[0]?.path ?? null;
          }
        } catch (err) {
          console.error("Failed to detect workspace type:", err);
          // Fall back to single-repo for backward compatibility
          workspaceType = "single-repo";
          selectedRepoPath = path;
        }

        set({
          tabs: [
            ...tabs.map((t) => ({ ...t, active: false })),
            {
              id,
              name,
              projectPath: path,
              active: true,
              sessionIds: [],
              sessionsLaunched: false,
              workspaceType,
              repositories,
              selectedRepoPath,
            },
          ],
        });
      },

      selectTab: (id: string) => {
        const { tabs } = get();
        if (!tabs.some((t) => t.id === id)) return;
        set({
          tabs: tabs.map((t) => ({ ...t, active: t.id === id })),
        });
      },

      closeTab: (id: string) => {
        const tabToClose = get().tabs.find((t) => t.id === id);

        // Kill all sessions belonging to this project (fire-and-forget)
        if (tabToClose && tabToClose.sessionIds.length > 0) {
          Promise.allSettled(tabToClose.sessionIds.map((sessionId) => killSession(sessionId)))
            .then((results) => {
              for (const result of results) {
                if (result.status === "rejected") {
                  console.error("Failed to kill session on tab close:", result.reason);
                }
              }
            });
        }

        const remaining = get().tabs.filter((t) => t.id !== id);

        if (remaining.length === 0) {
          set({ tabs: [] });
          return;
        }

        // If the closed tab was active, activate the first remaining tab
        const needsActivation = !remaining.some((t) => t.active);
        set({
          tabs: needsActivation
            ? remaining.map((t, i) => (i === 0 ? { ...t, active: true } : t))
            : remaining,
        });
      },

      addSessionToProject: (tabId: string, sessionId: number) => {
        set({
          tabs: get().tabs.map((t) =>
            t.id === tabId && !t.sessionIds.includes(sessionId)
              ? { ...t, sessionIds: [...t.sessionIds, sessionId] }
              : t
          ),
        });
      },

      removeSessionFromProject: (tabId: string, sessionId: number) => {
        set({
          tabs: get().tabs.map((t) =>
            t.id === tabId
              ? { ...t, sessionIds: t.sessionIds.filter((id) => id !== sessionId) }
              : t
          ),
        });
      },

      setSessionsLaunched: (tabId: string, launched: boolean) => {
        set({
          tabs: get().tabs.map((t) =>
            t.id === tabId ? { ...t, sessionsLaunched: launched } : t
          ),
        });
      },

      getTabByPath: (projectPath: string) => {
        return get().tabs.find((t) => t.projectPath === projectPath);
      },

      setSelectedRepo: (tabId: string, repoPath: string) => {
        set({
          tabs: get().tabs.map((t) =>
            t.id === tabId ? { ...t, selectedRepoPath: repoPath } : t
          ),
        });
      },

      updateRepositories: (tabId: string, repositories: RepositoryInfo[]) => {
        set({
          tabs: get().tabs.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  repositories,
                  workspaceType: repositories.length > 0 ? "multi-repo" : "non-git",
                  // Auto-select first repo if current selection is no longer valid
                  selectedRepoPath:
                    repositories.find((r) => r.path === t.selectedRepoPath)?.path ??
                    repositories[0]?.path ??
                    null,
                }
              : t
          ),
        });
      },
    }),
    {
      name: "maestro-workspace",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({ tabs: state.tabs }),
      version: 3,
      onRehydrateStorage: () => {
        return (state) => {
          if (state) {
            // Clear stale sessionIds - sessions don't survive app restarts
            // This prevents session ID collision between persisted tabs and new sessions
            state.tabs = state.tabs.map((t) => ({
              ...t,
              sessionIds: [],
              sessionsLaunched: false,
            }));
          }
        };
      },
      migrate: (persistedState, version) => {
        const state = persistedState as WorkspaceState;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let tabs = state.tabs as any[];

        // v1 -> v2: Add sessionIds and sessionsLaunched
        if (version < 2) {
          tabs = tabs.map((t) => ({
            ...t,
            sessionIds: t.sessionIds ?? [],
            sessionsLaunched: t.sessionsLaunched ?? false,
          }));
        }

        // v2 -> v3: Add multi-repo fields
        if (version < 3) {
          tabs = tabs.map((t) => ({
            ...t,
            workspaceType: (t.workspaceType as WorkspaceType) ?? "single-repo",
            repositories: t.repositories ?? [],
            selectedRepoPath: t.selectedRepoPath ?? t.projectPath,
          }));
        }

        return { ...state, tabs: tabs as WorkspaceTab[] };
      },
    },
  ),
);
