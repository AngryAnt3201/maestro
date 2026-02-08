import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";

/** AI provider variants supported by the backend orchestrator. */
export type AiMode = "Claude" | "Gemini" | "Codex" | "Ollama" | "Plain";

/**
 * Backend-emitted session lifecycle states.
 * Must stay in sync with the Rust `SessionStatus` enum.
 * "Timeout" is a frontend-only status for sessions stuck in Starting state.
 */
export type BackendSessionStatus =
  | "Starting"
  | "Idle"
  | "Working"
  | "NeedsInput"
  | "Done"
  | "Error"
  | "Timeout";

/** Timeout in milliseconds for sessions stuck in Starting state (Bug #74) */
const SESSION_STARTUP_TIMEOUT_MS = 30000;

/**
 * Mirrors the Rust `SessionConfig` struct returned by `get_sessions`.
 *
 * @property id - Unique numeric session ID assigned by the backend.
 * @property branch - Git branch the session operates on, or null for the default branch.
 * @property worktree_path - Filesystem path to the git worktree, if one was created.
 * @property project_path - Canonicalized project directory this session belongs to.
 * @property statusMessage - Brief description of what the agent is doing (from MCP status).
 * @property needsInputPrompt - When status is NeedsInput, the specific question for the user.
 */
export interface SessionConfig {
  id: number;
  mode: AiMode;
  branch: string | null;
  status: BackendSessionStatus;
  worktree_path: string | null;
  project_path: string;
  statusMessage?: string;
  needsInputPrompt?: string;
}

/** Shape of the Tauri `session-status-changed` event payload. */
interface SessionStatusPayload {
  session_id: number;
  project_path: string;
  status: BackendSessionStatus;
  message?: string;
  needs_input_prompt?: string;
}

/**
 * Zustand store slice for session metadata (not PTY I/O -- that lives in terminal.ts).
 *
 * @property sessions - Authoritative list of sessions fetched from the backend.
 * @property fetchSessions - Performs a one-shot IPC fetch to replace the session list.
 * @property initListeners - Subscribes to the global `session-status-changed` Tauri event.
 *   Returns an unlisten function; callers must invoke the cleanup to decrement
 *   a reference count and remove the listener when the last subscriber exits.
 */
interface SessionState {
  sessions: SessionConfig[];
  isLoading: boolean;
  error: string | null;
  fetchSessions: () => Promise<void>;
  fetchSessionsForProject: (projectPath: string) => Promise<void>;
  addSession: (session: SessionConfig) => void;
  removeSession: (sessionId: number) => void;
  removeSessionsForProject: (projectPath: string) => Promise<SessionConfig[]>;
  updateSession: (sessionId: number, updates: Partial<SessionConfig>) => void;
  getSessionsByProject: (projectPath: string) => SessionConfig[];
  initListeners: () => Promise<UnlistenFn>;
}

/**
 * Global session store. Not persisted — sessions are ephemeral and
 * re-fetched from the backend on app launch via `fetchSessions`.
 */
let listenerCount = 0;
let pendingInit: Promise<void> | null = null;
let activeUnlisten: UnlistenFn | null = null;

/**
 * Buffer for status events that arrive before their session is added to the store.
 * Key is "session_id:project_path", value is the latest status payload for that session.
 */
const pendingStatusUpdates: Map<string, SessionStatusPayload> = new Map();

/**
 * Tracks startup timeout timers for sessions (Bug #74).
 * Key is session ID, value is the timeout handle.
 * When a session transitions out of "Starting" state, its timer is cleared.
 */
const startupTimeouts: Map<number, ReturnType<typeof setTimeout>> = new Map();

/** Generate a unique key for buffering status updates */
function statusBufferKey(sessionId: number, projectPath: string): string {
  return `${sessionId}:${projectPath}`;
}

/**
 * Clears the startup timeout for a session.
 * Called when session transitions out of "Starting" state.
 */
function clearStartupTimeout(sessionId: number): void {
  const timer = startupTimeouts.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    startupTimeouts.delete(sessionId);
  }
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  sessions: [],
  isLoading: false,
  error: null,

  fetchSessions: async () => {
    set({ isLoading: true, error: null });
    try {
      const sessions = await invoke<SessionConfig[]>("get_sessions");
      set({ sessions, isLoading: false });
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
      set({ error: String(err), isLoading: false });
    }
  },

  fetchSessionsForProject: async (projectPath: string) => {
    set({ isLoading: true, error: null });
    try {
      const sessions = await invoke<SessionConfig[]>("get_sessions_for_project", {
        projectPath,
      });
      set({ sessions, isLoading: false });
    } catch (err) {
      console.error("Failed to fetch sessions for project:", err);
      set({ error: String(err), isLoading: false });
    }
  },

  addSession: (session: SessionConfig) => {
    // Clear any stale buffered status for this session ID across ALL projects
    // This prevents pollution from old sessions with the same ID
    for (const key of pendingStatusUpdates.keys()) {
      if (key.startsWith(`${session.id}:`)) {
        console.log(`[SessionStore] Clearing stale buffered status for key: '${key}'`);
        pendingStatusUpdates.delete(key);
      }
    }

    // Check if we have a buffered status update for this session
    const bufferKey = statusBufferKey(session.id, session.project_path);
    const bufferedStatus = pendingStatusUpdates.get(bufferKey);

    console.log(`[SessionStore] addSession id=${session.id} project_path='${session.project_path}'`);
    console.log(`[SessionStore] Buffer key: '${bufferKey}', has buffered status: ${!!bufferedStatus}`);
    if (pendingStatusUpdates.size > 0) {
      console.log("[SessionStore] All buffered keys:", Array.from(pendingStatusUpdates.keys()));
    }

    if (bufferedStatus) {
      pendingStatusUpdates.delete(bufferKey);
      console.log(`[SessionStore] Applying buffered status: ${bufferedStatus.status}`);
      // Apply the buffered status to the session before adding
      session = {
        ...session,
        status: bufferedStatus.status,
        statusMessage: bufferedStatus.message,
        needsInputPrompt: bufferedStatus.needs_input_prompt,
      };
    }

    // Start a timeout timer for sessions in "Starting" state (Bug #74)
    // If no status update is received within the timeout, mark as "Timeout"
    if (session.status === "Starting") {
      // Clear any existing timeout for this session (shouldn't happen, but be safe)
      clearStartupTimeout(session.id);

      const timeoutTimer = setTimeout(() => {
        startupTimeouts.delete(session.id);
        // Check if session is still in Starting state
        const currentState = get();
        const currentSession = currentState.sessions.find((s) => s.id === session.id);
        if (currentSession && currentSession.status === "Starting") {
          console.warn(`[SessionStore] Session ${session.id} startup timeout after ${SESSION_STARTUP_TIMEOUT_MS}ms`);
          set((state) => ({
            sessions: state.sessions.map((s) =>
              s.id === session.id
                ? {
                    ...s,
                    status: "Timeout" as BackendSessionStatus,
                    statusMessage: "CLI failed to start - check terminal for errors",
                  }
                : s
            ),
          }));
        }
      }, SESSION_STARTUP_TIMEOUT_MS);

      startupTimeouts.set(session.id, timeoutTimer);
    }

    set((state) => {
      // Don't add if session already exists
      if (state.sessions.some((s) => s.id === session.id)) {
        return state;
      }
      return { sessions: [...state.sessions, session] };
    });
  },

  updateSession: (sessionId: number, updates: Partial<SessionConfig>) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, ...updates } : s
      ),
    }));
  },

  removeSession: (sessionId: number) => {
    // Clear any startup timeout for this session
    clearStartupTimeout(sessionId);

    // Clear any buffered status for this session to prevent pollution on restart
    const sessionsToRemove = get().sessions.filter((s) => s.id === sessionId);
    for (const session of sessionsToRemove) {
      const bufferKey = statusBufferKey(session.id, session.project_path);
      pendingStatusUpdates.delete(bufferKey);
    }

    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== sessionId),
    }));
  },

  removeSessionsForProject: async (projectPath: string) => {
    try {
      const removed = await invoke<SessionConfig[]>("remove_sessions_for_project", {
        projectPath,
      });
      // Remove the sessions from local state
      set((state) => ({
        sessions: state.sessions.filter(
          (s) => !removed.some((r) => r.id === s.id)
        ),
      }));
      return removed;
    } catch (err) {
      console.error("Failed to remove sessions for project:", err);
      return [];
    }
  },

  getSessionsByProject: (projectPath: string) => {
    return get().sessions.filter((s) => s.project_path === projectPath);
  },

  initListeners: async () => {
    listenerCount += 1;
    try {
      if (!activeUnlisten) {
        if (!pendingInit) {
          pendingInit = listen<SessionStatusPayload>("session-status-changed", (event) => {
            const { session_id, project_path, status, message, needs_input_prompt } = event.payload;

            // Check if session exists in store
            const sessionExists = get().sessions.some(
              (s) => s.id === session_id && s.project_path === project_path
            );

            if (!sessionExists) {
              // Buffer this status update - it will be applied when the session is added
              const bufferKey = statusBufferKey(session_id, project_path);
              console.log(`[SessionStore] Buffering status for non-existent session. Key: '${bufferKey}'`);
              pendingStatusUpdates.set(bufferKey, event.payload);
              return;
            }

            // Clear startup timeout when session transitions out of Starting state (Bug #74)
            if (status !== "Starting") {
              clearStartupTimeout(session_id);
            }

            set((state) => ({
              sessions: state.sessions.map((s) =>
                s.id === session_id && s.project_path === project_path
                  ? {
                      ...s,
                      status,
                      statusMessage: message,
                      needsInputPrompt: needs_input_prompt,
                    }
                  : s
              ),
            }));
          })
            .then((unlisten) => {
              activeUnlisten = unlisten;
            })
            .finally(() => {
              pendingInit = null;
            });
        }
        await pendingInit;
      }
    } catch (err) {
      listenerCount = Math.max(0, listenerCount - 1);
      throw err;
    }

    return () => {
      listenerCount = Math.max(0, listenerCount - 1);
      if (listenerCount === 0 && activeUnlisten) {
        activeUnlisten();
        activeUnlisten = null;
      }
    };
  },
}));
