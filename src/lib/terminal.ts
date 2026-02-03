/**
 * Thin wrappers around Tauri `invoke` / `listen` for PTY session management.
 *
 * Each function maps 1:1 to a Rust `#[tauri::command]` handler. Errors are
 * propagated as rejected promises; callers are responsible for catch/logging.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { BackendCapabilities, BackendType } from "./terminalTheme";

/**
 * Spawns a new PTY shell session on the backend.
 * @param cwd - Starting working directory; when omitted the backend uses its default.
 * @param env - Environment variables to pass to the shell process. These are inherited
 *   by all child processes (including Claude CLI → MCP server). MAESTRO_SESSION_ID is
 *   automatically set by the backend.
 * @returns The numeric session ID assigned by the backend.
 */
export async function spawnShell(cwd?: string, env?: Record<string, string>): Promise<number> {
  return invoke<number>("spawn_shell", { cwd: cwd ?? null, env: env ?? null });
}

/** Writes raw bytes to the PTY stdin of the given session. */
export async function writeStdin(sessionId: number, data: string): Promise<void> {
  return invoke("write_stdin", { sessionId, data });
}

/** Notifies the backend PTY of a terminal dimension change (rows x cols). */
export async function resizePty(sessionId: number, rows: number, cols: number): Promise<void> {
  return invoke("resize_pty", { sessionId, rows, cols });
}

/** Terminates the backend PTY process and cleans up the session. */
export async function killSession(sessionId: number): Promise<void> {
  return invoke("kill_session", { sessionId });
}

/** AI mode variants matching the backend enum. */
export type AiMode = "Claude" | "Gemini" | "Codex" | "Plain";

/** CLI command configuration for each AI mode */
export const AI_CLI_CONFIG: Record<AiMode, { command: string | null; installHint: string }> = {
  Claude: {
    command: "claude",
    installHint: "npm install -g @anthropic-ai/claude-code"
  },
  Gemini: {
    command: "gemini",
    installHint: "npm install -g @google/gemini-cli"
  },
  Codex: {
    command: "codex",
    installHint: "npm install -g codex"
  },
  Plain: {
    command: null,
    installHint: ""
  },
};

/** Checks if a CLI tool is available in the user's PATH */
export async function checkCliAvailable(command: string): Promise<boolean> {
  return invoke<boolean>("check_cli_available", { command });
}

/** Session config returned by createSession. */
export interface SessionConfig {
  id: number;
  mode: AiMode;
  branch: string | null;
  status: string;
  worktree_path: string | null;
  project_path: string;
}

/** Creates a session in the SessionManager (separate from PTY spawning). */
export async function createSession(
  id: number,
  mode: AiMode,
  projectPath: string
): Promise<SessionConfig> {
  return invoke<SessionConfig>("create_session", { id, mode, projectPath });
}

/** Assigns a branch and optional worktree path to a session. */
export async function assignSessionBranch(
  sessionId: number,
  branch: string,
  worktreePath: string | null
): Promise<void> {
  return invoke("assign_session_branch", { sessionId, branch, worktreePath });
}

/**
 * Subscribes to the per-session `pty-output-{sessionId}` Tauri event.
 * Returns a promise that resolves to an unlisten function. The caller must
 * invoke the unlisten function on cleanup to avoid leaked event listeners.
 */
export function onPtyOutput(
  sessionId: number,
  callback: (data: string) => void,
): Promise<UnlistenFn> {
  return listen<string>(`pty-output-${sessionId}`, (event) => {
    callback(event.payload);
  });
}

/** Backend info as returned by the Rust backend. */
export interface BackendInfo {
  backendType: BackendType;
  capabilities: BackendCapabilities;
}

/** Cached backend info to avoid repeated IPC calls. */
let cachedBackendInfo: BackendInfo | null = null;

/**
 * Returns information about the active terminal backend.
 * The result is cached after the first call.
 */
export async function getBackendInfo(): Promise<BackendInfo> {
  if (cachedBackendInfo) {
    return cachedBackendInfo;
  }
  cachedBackendInfo = await invoke<BackendInfo>("get_backend_info");
  return cachedBackendInfo;
}

/** Checks if the current backend supports enhanced terminal state. */
export async function hasEnhancedState(): Promise<boolean> {
  const info = await getBackendInfo();
  return info.capabilities.enhancedState;
}

// Terminal ready signaling mechanism
// Used to coordinate between TerminalGrid (which sends CLI commands) and
// TerminalView (which needs to be listening for PTY output first)
//
// Uses window-level storage to ensure the same instance is shared across
// all chunks in production builds (module-level Maps can be duplicated).
declare global {
  interface Window {
    __maestroTerminalsReady?: Set<number>;
  }
}

function getTerminalsReadySet(): Set<number> {
  if (!window.__maestroTerminalsReady) {
    window.__maestroTerminalsReady = new Set();
  }
  return window.__maestroTerminalsReady;
}

/**
 * Signals that a terminal is ready to receive PTY output.
 * Called by TerminalView after xterm.js is mounted and listening.
 */
export function signalTerminalReady(sessionId: number): void {
  getTerminalsReadySet().add(sessionId);
}

/**
 * Waits for a terminal to signal it's ready to receive PTY output.
 * Called by TerminalGrid before sending CLI commands.
 * Uses polling to check if the terminal has signaled ready.
 * @param sessionId - The session ID to wait for
 * @param timeoutMs - Maximum time to wait (default 5000ms to account for font loading)
 * @returns Promise that resolves when terminal is ready or rejects on timeout
 */
export function waitForTerminalReady(sessionId: number, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const pollInterval = 50; // Check every 50ms

    const check = () => {
      const readySet = getTerminalsReadySet();
      if (readySet.has(sessionId)) {
        readySet.delete(sessionId);
        resolve();
        return;
      }

      if (Date.now() - startTime >= timeoutMs) {
        reject(new Error(`Terminal ${sessionId} ready timeout after ${timeoutMs}ms`));
        return;
      }

      setTimeout(check, pollInterval);
    };

    check();
  });
}
