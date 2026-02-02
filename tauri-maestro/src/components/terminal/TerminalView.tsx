import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

import { QuickActionsManager } from "@/components/quickactions/QuickActionsManager";
import { getBackendInfo, killSession, onPtyOutput, resizePty, writeStdin, type BackendInfo } from "@/lib/terminal";
import { DEFAULT_THEME, LIGHT_THEME, toXtermTheme } from "@/lib/terminalTheme";
import { useMcpStore } from "@/stores/useMcpStore";
import { type AiMode, type BackendSessionStatus, useSessionStore } from "@/stores/useSessionStore";
import { QuickActionPills } from "./QuickActionPills";
import { type AIProvider, type SessionStatus, TerminalHeader } from "./TerminalHeader";

/**
 * Props for {@link TerminalView}.
 * @property sessionId - Backend PTY session ID used to route stdin/stdout and resize events.
 * @property status - Fallback status used only when the session store has no entry yet.
 * @property onKill - Callback invoked after the backend kill IPC completes (or fails).
 */
interface TerminalViewProps {
  sessionId: number;
  status?: SessionStatus;
  onKill: (sessionId: number) => void;
}

/** Map backend AiMode to frontend AIProvider */
function mapAiMode(mode: AiMode): AIProvider {
  const map: Record<AiMode, AIProvider> = {
    Claude: "claude",
    Gemini: "gemini",
    Codex: "codex",
    Plain: "plain",
  };
  const provider = map[mode];
  if (!provider) {
    console.warn("Unknown AiMode:", mode);
    return "claude";
  }
  return provider;
}

/** Map backend SessionStatus to frontend SessionStatus */
function mapStatus(status: BackendSessionStatus): SessionStatus {
  const map: Record<BackendSessionStatus, SessionStatus> = {
    Starting: "starting",
    Idle: "idle",
    Working: "working",
    NeedsInput: "needs-input",
    Done: "done",
    Error: "error",
  };
  const mapped = map[status];
  if (!mapped) {
    console.warn("Unknown backend session status:", status);
    return "idle";
  }
  return mapped;
}

/** Map session status to CSS class for border/glow */
function cellStatusClass(status: SessionStatus): string {
  switch (status) {
    case "starting":
      return "terminal-cell-starting";
    case "working":
      return "terminal-cell-working";
    case "needs-input":
      return "terminal-cell-needs-input";
    case "done":
      return "terminal-cell-done";
    case "error":
      return "terminal-cell-error";
    default:
      return "terminal-cell-idle";
  }
}

/**
 * Renders a single xterm.js terminal bound to a backend PTY session.
 *
 * On mount: creates a Terminal instance with FitAddon (auto-resize) and WebLinksAddon
 * (clickable URLs), subscribes to the Tauri `pty-output-{sessionId}` event, and wires
 * xterm onData/onResize to the corresponding backend IPC calls. A ResizeObserver keeps
 * the terminal dimensions in sync when the container layout changes.
 *
 * On unmount: sets a `disposed` flag to prevent late PTY writes, disconnects the
 * ResizeObserver, disposes xterm listeners, unsubscribes the Tauri event listener
 * (even if the listener promise hasn't resolved yet), and destroys the Terminal.
 */
export function TerminalView({ sessionId, status = "idle", onKill }: TerminalViewProps) {
  const sessionConfig = useSessionStore((s) => s.sessions.find((sess) => sess.id === sessionId));
  const effectiveStatus = sessionConfig ? mapStatus(sessionConfig.status) : status;
  const effectiveProvider = sessionConfig ? mapAiMode(sessionConfig.mode) : "claude";
  const effectiveBranch = sessionConfig?.branch ?? "Current";
  const isWorktree = Boolean(sessionConfig?.worktree_path);
  const projectPath = sessionConfig?.project_path ?? "";

  // Get MCP count for this session (primitive values are stable, no reference issues)
  const mcpCount = useMcpStore((s) => {
    if (!projectPath) return 0;
    return s.getEnabledCount(projectPath, sessionId);
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // Quick actions manager modal state
  const [showQuickActionsManager, setShowQuickActionsManager] = useState(false);

  // Backend capabilities (for future enhanced features like terminal state queries)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_backendInfo, setBackendInfo] = useState<BackendInfo | null>(null);

  // Track app theme (dark/light) for terminal theming
  const [appTheme, setAppTheme] = useState<"dark" | "light">(() => {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  });

  // Fetch backend info on mount (cached after first call)
  useEffect(() => {
    getBackendInfo()
      .then(setBackendInfo)
      .catch((err) => console.warn("Failed to get backend info:", err));
  }, []);

  // Watch for theme changes via MutationObserver
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === "data-theme") {
          const newTheme = document.documentElement.getAttribute("data-theme");
          setAppTheme(newTheme === "light" ? "light" : "dark");
        }
      }
    });

    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  // Update terminal theme when appTheme changes
  useEffect(() => {
    if (termRef.current) {
      const theme = appTheme === "light" ? LIGHT_THEME : DEFAULT_THEME;
      termRef.current.options.theme = toXtermTheme(theme);
    }
  }, [appTheme]);

  /**
   * Immediately removes the terminal from UI (optimistic update),
   * then kills the backend session in the background.
   */
  const handleKill = useCallback(
    (id: number) => {
      // Update UI immediately (optimistic)
      onKill(id);
      // Kill session in background - don't await
      killSession(id).catch((err) => {
        console.error("Failed to kill session:", err);
      });
    },
    [onKill],
  );

  /**
   * Handles quick action button clicks by writing the prompt to the terminal.
   */
  const handleQuickAction = useCallback(
    (prompt: string) => {
      writeStdin(sessionId, prompt + "\n").catch(console.error);
    },
    [sessionId],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const initialTheme = document.documentElement.getAttribute("data-theme") === "light" ? LIGHT_THEME : DEFAULT_THEME;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrainsMono Nerd Font', 'FiraCode Nerd Font', 'CaskaydiaCove Nerd Font', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: toXtermTheme(initialTheme),
      allowProposedApi: true,
      scrollback: 10000,
      tabStopWidth: 8,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(container);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch {
        // Container may not be sized yet
      }
    });

    const dataDisposable = term.onData((data) => {
      writeStdin(sessionId, data).catch(console.error);
    });

    const resizeDisposable = term.onResize(({ rows, cols }) => {
      resizePty(sessionId, rows, cols).catch(console.error);
    });

    let disposed = false;
    let unlisten: (() => void) | null = null;
    const listenerReady = onPtyOutput(sessionId, (data) => {
      if (!disposed) {
        term.write(data);
      }
    });
    listenerReady
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((err) => {
        if (!disposed) {
          console.error("PTY listener failed:", err);
        }
      });

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (!disposed) {
          try {
            fitAddon.fit();
          } catch {
            // Container may have zero dimensions during layout transitions
          }
        }
      });
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      if (unlisten) unlisten();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId]);

  return (
    <div
      className={`terminal-cell flex h-full flex-col bg-maestro-bg ${cellStatusClass(effectiveStatus)}`}
    >
      {/* Rich header bar */}
      <TerminalHeader
        sessionId={sessionId}
        provider={effectiveProvider}
        status={effectiveStatus}
        statusMessage={sessionConfig?.statusMessage || sessionConfig?.needsInputPrompt}
        mcpCount={mcpCount}
        branchName={effectiveBranch}
        isWorktree={isWorktree}
        onKill={handleKill}
      />

      {/* xterm.js container */}
      <div ref={containerRef} className="flex-1 overflow-hidden" />

      {/* Quick action pills */}
      <QuickActionPills
        onAction={handleQuickAction}
        onManageClick={() => setShowQuickActionsManager(true)}
      />

      {/* Quick actions manager modal */}
      {showQuickActionsManager && (
        <QuickActionsManager onClose={() => setShowQuickActionsManager(false)} />
      )}
    </div>
  );
}
