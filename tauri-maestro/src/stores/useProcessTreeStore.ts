/**
 * Zustand store for process tree introspection.
 *
 * Tracks process trees for active agent sessions, showing all child
 * processes spawned by each session's shell.
 */

import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

/** Information about a single process. */
export interface ProcessInfo {
  pid: number;
  name: string;
  command: string[];
  parentPid: number | null;
  cpuUsage: number;
  memoryBytes: number;
}

/** A process tree rooted at a session's shell process. */
export interface SessionProcessTree {
  sessionId: number;
  rootPid: number;
  processes: ProcessInfo[];
}

interface ProcessTreeState {
  /** Process trees for active sessions. */
  trees: SessionProcessTree[];

  /** Loading state. */
  isLoading: boolean;

  /** Error message if fetch failed. */
  error: string | null;

  /** Last fetch timestamp for throttling. */
  lastFetch: number | null;

  /**
   * Fetches process trees for all active sessions.
   * Throttled to prevent excessive calls (1 second minimum between fetches).
   */
  fetchAllTrees: () => Promise<void>;

  /**
   * Fetches process tree for a specific session.
   */
  fetchSessionTree: (sessionId: number) => Promise<SessionProcessTree | null>;

  /**
   * Clears the process tree for a specific session.
   * Called when a session is closed.
   */
  clearSession: (sessionId: number) => void;

  /**
   * Clears all process trees.
   */
  clearAll: () => void;

  /**
   * Kills a process by PID.
   * Returns true if successful, false otherwise.
   */
  killProcess: (pid: number) => Promise<boolean>;
}

const THROTTLE_MS = 1000;

export const useProcessTreeStore = create<ProcessTreeState>()((set, get) => ({
  trees: [],
  isLoading: false,
  error: null,
  lastFetch: null,

  fetchAllTrees: async () => {
    const now = Date.now();
    const { lastFetch, isLoading } = get();

    // Throttle fetches
    if (isLoading || (lastFetch && now - lastFetch < THROTTLE_MS)) {
      return;
    }

    set({ isLoading: true, error: null, lastFetch: now });

    try {
      const trees = await invoke<SessionProcessTree[]>("get_all_process_trees");
      set({ trees, isLoading: false });
    } catch (err) {
      console.error("Failed to fetch process trees:", err);
      set({ isLoading: false, error: String(err) });
    }
  },

  fetchSessionTree: async (sessionId: number) => {
    try {
      const tree = await invoke<SessionProcessTree | null>(
        "get_session_process_tree",
        { sessionId }
      );

      if (tree) {
        set((state) => ({
          trees: [
            ...state.trees.filter((t) => t.sessionId !== sessionId),
            tree,
          ],
        }));
      }

      return tree;
    } catch (err) {
      console.error(`Failed to fetch process tree for session ${sessionId}:`, err);
      return null;
    }
  },

  clearSession: (sessionId: number) => {
    set((state) => ({
      trees: state.trees.filter((t) => t.sessionId !== sessionId),
    }));
  },

  clearAll: () => {
    set({ trees: [], error: null });
  },

  killProcess: async (pid: number) => {
    try {
      await invoke<void>("kill_process", { pid });
      // Refresh trees after killing
      await get().fetchAllTrees();
      return true;
    } catch (err) {
      console.error(`Failed to kill process ${pid}:`, err);
      return false;
    }
  },
}));
