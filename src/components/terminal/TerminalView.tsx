import { CanvasAddon } from "@xterm/addon-canvas";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

import { QuickActionsManager } from "@/components/quickactions/QuickActionsManager";
import { ActivityFeed } from "@/components/session/ActivityFeed";
import { isGitWorktree } from "@/lib/git";
import { useSessionBranch } from "@/hooks/useSessionBranch";
import { buildFontFamily, waitForFont } from "@/lib/fonts";
import { getBackendInfo, killSession, onPtyOutput, resizePty, savePastedImage, signalTerminalReady, writeStdin, type BackendInfo } from "@/lib/terminal";
import { DEFAULT_THEME, LIGHT_THEME, toXtermTheme } from "@/lib/terminalTheme";
import { useMcpStore } from "@/stores/useMcpStore";
import { type AiMode, type BackendSessionStatus, useSessionStore } from "@/stores/useSessionStore";
import { useTerminalSettingsStore } from "@/stores/useTerminalSettingsStore";
import { useShallow } from "zustand/react/shallow";
import { QuickActionPills } from "./QuickActionPills";
import { type AIProvider, type SessionStatus, TerminalHeader } from "./TerminalHeader";

/**
 * Props for {@link TerminalView}.
 * @property sessionId - Backend PTY session ID used to route stdin/stdout and resize events.
 * @property status - Fallback status used only when the session store has no entry yet.
 * @property isFocused - Whether this terminal is currently focused (shows accent ring).
 * @property isActive - Whether this terminal is in the active project tab (throttles background polling).
 * @property onFocus - Callback when the terminal is clicked/focused.
 * @property onKill - Callback invoked after the backend kill IPC completes (or fails).
 */
interface TerminalViewProps {
  sessionId: number;
  status?: SessionStatus;
  isFocused?: boolean;
  isActive?: boolean;
  onFocus?: () => void;
  onKill: (sessionId: number) => void;
  terminalCount?: number;
  isZoomed?: boolean;
  onToggleZoom?: () => void;
}

/** Map backend AiMode to frontend AIProvider */
function mapAiMode(mode: AiMode): AIProvider {
  const map: Record<AiMode, AIProvider> = {
    Claude: "claude",
    Gemini: "gemini",
    Codex: "codex",
    OpenCode: "opencode",
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
    Timeout: "timeout",
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
export const TerminalView = memo(function TerminalView({
  sessionId,
  status = "idle",
  isFocused = false,
  isActive = true,
  onFocus,
  onKill,
  terminalCount = 1,
  isZoomed = false,
  onToggleZoom,
}: TerminalViewProps) {
  const sessionData = useSessionStore(
    useShallow((s) => {
      const sess = s.sessions.find((x) => x.id === sessionId);
      if (!sess) return null;
      return {
        status: sess.status,
        mode: sess.mode,
        name: sess.name,
        projectPath: sess.project_path,
        workingDirectory: sess.working_directory,
        worktreePath: sess.worktree_path,
        branch: sess.branch,
        statusMessage: sess.statusMessage,
        needsInputPrompt: sess.needsInputPrompt,
      };
    })
  );
  const effectiveStatus = sessionData ? mapStatus(sessionData.status) : status;
  const effectiveProvider = sessionData ? mapAiMode(sessionData.mode) : "claude";
  const hasSessionWorktree = Boolean(sessionData?.worktreePath);
  const projectPath = sessionData?.workingDirectory ?? sessionData?.projectPath ?? "";

  // Detect if the project path itself is a git worktree (not the main working tree).
  // This handles the case where the user opens a worktree directory as their project.
  const [isProjectWorktree, setIsProjectWorktree] = useState(false);
  useEffect(() => {
    if (hasSessionWorktree || !projectPath) return;
    isGitWorktree(projectPath)
      .then((result) => setIsProjectWorktree(result))
      .catch(() => setIsProjectWorktree(false));
  }, [projectPath, hasSessionWorktree]);

  // For useSessionBranch: only Maestro-created worktrees have a locked branch.
  // Project-level worktrees still need polling to discover their branch.
  const liveBranch = useSessionBranch(projectPath, hasSessionWorktree, sessionData?.branch ?? null, isActive);
  const effectiveBranch = liveBranch ?? "...";
  // For the UI badge: show "worktree" if either Maestro created one or the project itself is a worktree.
  const isWorktree = hasSessionWorktree || isProjectWorktree;

  // Get terminal settings from store (select individual primitives for granular updates)
  const fontSize = useTerminalSettingsStore((s) => s.settings.fontSize);
  const fontFamily = useTerminalSettingsStore((s) => s.settings.fontFamily);
  const lineHeight = useTerminalSettingsStore((s) => s.settings.lineHeight);
  const zoomLevel = useTerminalSettingsStore((s) => s.settings.zoomLevel);
  const getEffectiveFontFamily = useTerminalSettingsStore((s) => s.getEffectiveFontFamily);
  const getEffectiveFontSize = useTerminalSettingsStore((s) => s.getEffectiveFontSize);
  const setZoomLevel = useTerminalSettingsStore((s) => s.setZoomLevel);

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
  const [activeTab, setActiveTab] = useState<"terminal" | "activity">("terminal");
  const handleManageClick = useCallback(() => setShowQuickActionsManager(true), []);

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

  // Update terminal font settings when they change
  useEffect(() => {
    if (termRef.current && fitAddonRef.current) {
      const effectiveFont = getEffectiveFontFamily();
      const builtFontFamily = buildFontFamily(effectiveFont);

      termRef.current.options.fontSize = getEffectiveFontSize();
      termRef.current.options.fontFamily = builtFontFamily;
      termRef.current.options.lineHeight = lineHeight;

      // Refit terminal to recalculate cell dimensions
      requestAnimationFrame(() => {
        try {
          fitAddonRef.current?.fit();
        } catch {
          // Ignore fit errors during transition
        }
      });
    }
  }, [fontSize, fontFamily, lineHeight, zoomLevel, getEffectiveFontFamily, getEffectiveFontSize]);

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

  const handleRename = useCallback(
    (id: number, name: string | null) => {
      useSessionStore.getState().renameSession(id, name);
    },
    [],
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

    // Get current settings at initialization time (not reactive)
    const currentSettings = useTerminalSettingsStore.getState();
    const effectiveFont = currentSettings.getEffectiveFontFamily();
    const fontFamily = buildFontFamily(effectiveFont);

    let disposed = false;
    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let unlisten: (() => void) | null = null;
    // === PTY Output Batching (reduces xterm.js render overhead) ===
    let writeBuffer: string[] = [];
    let rafId: number | null = null;
    let fallbackTimerId: ReturnType<typeof setTimeout> | null = null;

    // === Activity-based status detection ===
    let activityWorkingTimer: ReturnType<typeof setTimeout> | null = null;
    let activityIdleTimer: ReturnType<typeof setTimeout> | null = null;
    let lastHeuristicStatus: string | null = null;

    const MCP_GRACE_PERIOD_MS = 10_000; // Defer to MCP for 10s after last MCP update
    const WORKING_DEBOUNCE_MS = 500;    // Sustained output before marking "Working"
    const IDLE_TIMEOUT_MS = 5_000;      // No output before marking "Idle"
    // Only overwrite "safe" states — never revert terminal states like Done/Error/NeedsInput/Timeout
    const SAFE_TO_OVERRIDE: BackendSessionStatus[] = ["Working", "Idle", "Starting"];

    const MAX_BUFFER_CHUNKS = 100;  // Force flush at ~400KB (100 × 4KB chunks)
    const FALLBACK_FLUSH_MS = 50;   // 20fps floor for backgrounded tabs

    const cancelPendingFlush = () => {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      if (fallbackTimerId !== null) { clearTimeout(fallbackTimerId); fallbackTimerId = null; }
    };

    const flushBuffer = () => {
      cancelPendingFlush();
      if (disposed || !term || writeBuffer.length === 0) {
        writeBuffer = [];
        return;
      }
      const data = writeBuffer.join('');
      writeBuffer = [];  // Clear BEFORE write to prevent duplicates on error
      try {
        term.write(data);
      } catch (e) {
        console.error('[TerminalView] write error:', e);
      }
    };

    const scheduleFlush = () => {
      if (rafId !== null) return;  // Already scheduled
      rafId = requestAnimationFrame(flushBuffer);
      if (fallbackTimerId === null) {
        fallbackTimerId = setTimeout(flushBuffer, FALLBACK_FLUSH_MS);
      }
    };

    let dataDisposable: { dispose: () => void } | null = null;
    let resizeDisposable: { dispose: () => void } | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let pasteHandler: ((e: Event) => void) | null = null;
    let unlistenDragDrop: (() => void) | null = null;

    // Wait for font to load before initializing terminal
    const initTerminal = async () => {
      await waitForFont(fontFamily, 2000);

      if (disposed) return;

      const initialTheme = document.documentElement.getAttribute("data-theme") === "light" ? LIGHT_THEME : DEFAULT_THEME;
      // Reduce scrollback on Linux where the DOM renderer is slow in WebKitGTK.
      // 10000 lines of scrollback with the DOM renderer causes severe lag.
      const isLinux = navigator.userAgent.toLowerCase().includes("linux");
      term = new Terminal({
        cursorBlink: true,
        fontSize: currentSettings.getEffectiveFontSize(),
        fontFamily: fontFamily,
        lineHeight: currentSettings.settings.lineHeight,
        theme: toXtermTheme(initialTheme),
        allowProposedApi: true,
        scrollback: isLinux ? 2000 : 10000,
        tabStopWidth: 8,
      });

      fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon((_event, uri) => {
        openUrl(uri);
      });

      const unicode11Addon = new Unicode11Addon();
      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);
      term.loadAddon(unicode11Addon);
      term.unicode.activeVersion = "11";
      term.open(container);

      // GPU-accelerated rendering (must be loaded after open())
      // Try WebGL first, fall back to Canvas2D (much faster than DOM on Linux)
      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon.dispose();
          try {
            term?.loadAddon(new CanvasAddon());
          } catch { /* DOM renderer as final fallback */ }
        });
        term.loadAddon(webglAddon);
      } catch {
        // WebGL not available — use Canvas2D renderer
        try {
          term.loadAddon(new CanvasAddon());
        } catch { /* DOM renderer as final fallback */ }
      }

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      requestAnimationFrame(() => {
        try {
          fitAddon?.fit();
        } catch {
          // Container may not be sized yet
        }
      });

      // Workaround for xterm.js CompositionHelper bug on WebKit (Tauri/WKWebView):
      // The hidden textarea accumulates text across compositions, but CompositionHelper
      // uses textarea.value.length at compositionstart as the extraction offset. When
      // prior text remains in the textarea, it extracts the wrong substring — e.g.
      // sending "測試" instead of "這是". We capture the correct text from the
      // compositionend event and replace whatever xterm sends via onData.
      const textarea = term.textarea!;
      let pendingCompositionData: string | null = null;

      textarea.addEventListener("compositionend", (e) => {
        pendingCompositionData = (e as CompositionEvent).data;
      });

      // Intercept paste events to handle images from the clipboard.
      // xterm.js only pastes text; images are silently dropped. We detect image
      // data, save it to a temp file via the backend, and write the file path
      // into the terminal so the AI CLI can read it.
      pasteHandler = (e: Event) => {
        const clipboardEvent = e as ClipboardEvent;
        const items = clipboardEvent.clipboardData?.items;
        if (!items) return;

        let imageItem: DataTransferItem | null = null;
        for (const item of Array.from(items)) {
          if (item.type.startsWith("image/")) {
            imageItem = item;
            break;
          }
        }

        if (!imageItem) return; // No image — let xterm handle text paste

        // Block xterm.js from processing this paste event
        e.preventDefault();
        e.stopPropagation();

        const blob = imageItem.getAsFile();
        if (!blob) return;

        const mediaType = imageItem.type;
        const MAX_IMAGE_SIZE = 50 * 1024 * 1024; // 50 MB
        // Save image async, then write the path to stdin
        blob.arrayBuffer().then(async (arrayBuffer) => {
          if (arrayBuffer.byteLength > MAX_IMAGE_SIZE) {
            console.error("[TerminalView] Image too large to paste");
            return;
          }
          const bytes = Array.from(new Uint8Array(arrayBuffer));
          const filePath = await savePastedImage(bytes, mediaType);
          await writeStdin(sessionId, filePath);
        }).catch((err) => {
          console.error("[TerminalView] Failed to paste image:", err);
        });
      };
      container.addEventListener("paste", pasteHandler, { capture: true });

      // Drag-and-drop support for images via Tauri's native file-drop API.
      // Tauri intercepts drag-and-drop at the webview level (JS drop events
      // never fire), so we listen for its onDragDropEvent instead. This also
      // gives us file paths directly — no need to read file data into JS.
      const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
      getCurrentWebviewWindow().onDragDropEvent((event) => {
        if (event.payload.type === "drop") {
          const imagePaths = event.payload.paths.filter((p) => {
            const ext = p.split(".").pop()?.toLowerCase() ?? "";
            return IMAGE_EXTENSIONS.has(ext);
          });
          for (const filePath of imagePaths) {
            writeStdin(sessionId, filePath).catch((err) => {
              console.error("[TerminalView] Failed to drop image:", err);
            });
          }
        }
      }).then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlistenDragDrop = unlisten;
        }
      });

      dataDisposable = term.onData((data) => {
        if (pendingCompositionData !== null) {
          const correctData = pendingCompositionData;
          pendingCompositionData = null;
          // Clear textarea to prevent accumulation that corrupts future compositions
          textarea.value = "";
          if (correctData.length > 0) {
            writeStdin(sessionId, correctData).catch(console.error);
          }
          return;
        }
        writeStdin(sessionId, data).catch(console.error);
      });

      resizeDisposable = term.onResize(({ rows, cols }) => {
        resizePty(sessionId, rows, cols).catch(console.error);
      });

      // Handle special keyboard shortcuts
      term.attachCustomKeyEventHandler((event) => {
        // Shift+Enter: send Kitty keyboard protocol sequence for Shift+Enter
        // so Claude Code inserts a newline in its input buffer instead of executing.
        // Raw "\n" would be treated as a command terminator by the CLI.
        // Block all event types (keydown, keypress, keyup) to prevent xterm.js
        // from also sending "\r" on the keypress event.
        if (event.key === "Enter" && event.shiftKey) {
          if (event.type === "keydown") {
            writeStdin(sessionId, "\x1b[13;2u").catch(console.error);
          }
          return false;
        }

        // Cmd+C (Mac) or Ctrl+C (Linux/Windows): copy selection to clipboard
        // Only intercept if there's a selection, otherwise let SIGINT go through
        const isCopy = event.key === "c" && (event.metaKey || event.ctrlKey) && event.type === "keydown";
        if (isCopy && term?.hasSelection()) {
          const selection = term.getSelection();
          navigator.clipboard.writeText(selection).catch(console.error);
          return false; // Don't send to PTY
        }

        // Cmd/Ctrl+T: add new session — block xterm so 't' isn't sent to PTY.
        // The DOM event still bubbles to window where useAppKeyboard handles it.
        if (event.key === "t" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.type === "keydown") {
          return false;
        }

        // Cmd/Ctrl+D (with or without Shift): split pane — block xterm so 'd' isn't sent to PTY.
        // The DOM event bubbles to window where useTerminalKeyboard handles it.
        if (event.key === "d" && (event.metaKey || event.ctrlKey) && !event.altKey && event.type === "keydown") {
          return false;
        }

        // Cmd/Ctrl+W: close pane — block xterm so 'w' isn't sent to PTY.
        if (event.key === "w" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.type === "keydown") {
          return false;
        }

        // Cmd+K (Mac) or Ctrl+K (Linux/Windows): clear terminal scrollback + viewport
        if (event.key === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.type === "keydown") {
          term?.clear();
          return false;
        }

        // Cmd+Left/Right (Mac): jump to beginning/end of line
        // Cmd+Delete (Mac): delete from cursor to beginning of line
        // WebView intercepts Cmd+key by default, so we manually send the escape sequences
        if (event.metaKey && event.type === "keydown") {
          if (event.key === "ArrowLeft") {
            writeStdin(sessionId, "\x01").catch(console.error); // Ctrl+A: beginning of line
            return false;
          }
          if (event.key === "ArrowRight") {
            writeStdin(sessionId, "\x05").catch(console.error); // Ctrl+E: end of line
            return false;
          }
          if (event.key === "Backspace") {
            writeStdin(sessionId, "\x15").catch(console.error); // Ctrl+U: delete to beginning of line
            return false;
          }
        }

        return true; // Let xterm handle all other keys
      });

      const listenerReady = onPtyOutput(sessionId, (data) => {
        if (disposed || !term) return;
        writeBuffer.push(data);
        if (writeBuffer.length >= MAX_BUFFER_CHUNKS) {
          flushBuffer();  // Backpressure: immediate flush if buffer full
        } else {
          scheduleFlush();
        }

        // --- Activity-based status detection ---
        const session = useSessionStore.getState().sessions.find(s => s.id === sessionId);
        if (!session) return; // Session was removed, skip heuristic

        const lastMcp = session.lastMcpUpdateTime ?? 0;
        const mcpIsActive = (Date.now() - lastMcp) < MCP_GRACE_PERIOD_MS;

        if (!mcpIsActive) {
          // Debounce: set "Working" after sustained output
          if (!activityWorkingTimer && lastHeuristicStatus !== "Working") {
            activityWorkingTimer = setTimeout(() => {
              if (disposed) return;
              activityWorkingTimer = null;
              const current = useSessionStore.getState().sessions.find(s => s.id === sessionId);
              if (!current || !SAFE_TO_OVERRIDE.includes(current.status)) return;
              lastHeuristicStatus = "Working";
              useSessionStore.getState().updateSession(sessionId, {
                status: "Working" as BackendSessionStatus,
              });
            }, WORKING_DEBOUNCE_MS);
          }

          // Reset idle timer on every output chunk
          if (activityIdleTimer) clearTimeout(activityIdleTimer);
          activityIdleTimer = setTimeout(() => {
            if (disposed) return;
            activityIdleTimer = null;
            if (lastHeuristicStatus === "Working") {
              const current = useSessionStore.getState().sessions.find(s => s.id === sessionId);
              if (!current || !SAFE_TO_OVERRIDE.includes(current.status)) return;
              lastHeuristicStatus = "Idle";
              useSessionStore.getState().updateSession(sessionId, {
                status: "Idle" as BackendSessionStatus,
              });
            }
          }, IDLE_TIMEOUT_MS);
        }
      });
      listenerReady
        .then((fn) => {
          if (disposed) {
            fn();
          } else {
            unlisten = fn;
            // Signal that the terminal is ready to receive PTY output
            // This allows TerminalGrid to know it can now send CLI commands
            signalTerminalReady(sessionId);
          }
        })
        .catch((err) => {
          if (!disposed) {
            console.error("PTY listener failed:", err);
          }
        });

      resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          if (!disposed && fitAddon) {
            try {
              fitAddon.fit();
            } catch {
              // Container may have zero dimensions during layout transitions
            }
          }
        });
      });
      resizeObserver.observe(container);
    };

    initTerminal().catch((err) => {
      if (!disposed) {
        console.error("Failed to initialize terminal:", err);
      }
    });

    return () => {
      disposed = true;
      cancelPendingFlush();
      if (activityWorkingTimer) clearTimeout(activityWorkingTimer);
      if (activityIdleTimer) clearTimeout(activityIdleTimer);
      // Flush remaining buffered output before disposal
      if (term && writeBuffer.length > 0) {
        try { term.write(writeBuffer.join('')); } catch { /* ignore errors during cleanup */ }
      }
      writeBuffer = [];
      resizeObserver?.disconnect();
      if (pasteHandler) container.removeEventListener("paste", pasteHandler, { capture: true });
      if (unlistenDragDrop) unlistenDragDrop();
      dataDisposable?.dispose();
      resizeDisposable?.dispose();
      if (unlisten) unlisten();
      term?.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Font settings are read once at init, dynamic updates via separate effect
  }, [sessionId]);

  // Focus the terminal when isFocused becomes true
  useEffect(() => {
    if (isFocused && termRef.current) {
      termRef.current.focus();
    }
  }, [isFocused]);

  return (
    <div
      className={`terminal-cell flex h-full flex-col bg-maestro-bg ${cellStatusClass(effectiveStatus)} ${isFocused ? "terminal-cell-focused" : ""}`}
      onClick={onFocus}
    >
      {/* Rich header bar */}
      <TerminalHeader
        sessionId={sessionId}
        provider={effectiveProvider}
        status={effectiveStatus}
        sessionName={sessionData?.name}
        statusMessage={sessionData?.statusMessage || sessionData?.needsInputPrompt}
        mcpCount={mcpCount}
        branchName={effectiveBranch}
        isWorktree={isWorktree}
        onKill={handleKill}
        onRename={handleRename}
        terminalCount={terminalCount}
        isZoomed={isZoomed}
        onToggleZoom={onToggleZoom}
        zoomLevel={zoomLevel}
        onSetZoomLevel={setZoomLevel}
      />

      {/* Tab bar */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-neutral-800 bg-neutral-900/50 px-2">
        <button
          type="button"
          className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
            activeTab === "terminal"
              ? "border-b-2 border-blue-500 text-neutral-200"
              : "text-neutral-500 hover:text-neutral-300"
          }`}
          onClick={() => setActiveTab("terminal")}
        >
          Terminal
        </button>
        <button
          type="button"
          className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
            activeTab === "activity"
              ? "border-b-2 border-blue-500 text-neutral-200"
              : "text-neutral-500 hover:text-neutral-300"
          }`}
          onClick={() => setActiveTab("activity")}
        >
          Activity
        </button>
      </div>

      {/* xterm.js container - always mounted but hidden when activity tab is active */}
      <div ref={containerRef} className={`flex-1 overflow-hidden ${activeTab !== "terminal" ? "hidden" : ""}`} />

      {/* Activity feed - shown when activity tab is active */}
      {activeTab === "activity" && (
        <div className="flex-1 overflow-hidden">
          <ActivityFeed sessionId={sessionId} maxHeight="100%" />
        </div>
      )}

      {/* Quick action pills - only show on terminal tab */}
      {activeTab === "terminal" && (
        <QuickActionPills
          onAction={handleQuickAction}
          onManageClick={handleManageClick}
        />
      )}

      {/* Quick actions manager modal */}
      {showQuickActionsManager && (
        <QuickActionsManager onClose={() => setShowQuickActionsManager(false)} />
      )}
    </div>
  );
});
