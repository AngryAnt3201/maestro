import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  BrainCircuit,
  CheckCircle,
  ChevronDown,
  Code2,
  Expand,
  GitBranch,
  GitCompareArrows,
  Minimize,
  Sparkles,
  Terminal,
  X,
  ZoomIn,
} from "lucide-react";

export type SessionStatus = "idle" | "starting" | "working" | "needs-input" | "done" | "error" | "timeout";

export type AIProvider = "claude" | "gemini" | "codex" | "ollama" | "plain";

interface TerminalHeaderProps {
  sessionId: number;
  provider?: AIProvider;
  status?: SessionStatus;
  mcpCount?: number;
  activeCount?: number;
  statusMessage?: string;
  branchName?: string;
  showLaunch?: boolean;
  isWorktree?: boolean;
  onKill: (sessionId: number) => void;
  onLaunch?: () => void;
  terminalCount?: number;
  isZoomed?: boolean;
  onToggleZoom?: () => void;
  zoomLevel?: number;
  onSetZoomLevel?: (level: number) => void;
}

const STATUS_COLOR: Record<SessionStatus, string> = {
  idle: "text-maestro-muted",
  starting: "text-maestro-orange",
  working: "text-maestro-accent",
  "needs-input": "text-maestro-yellow",
  done: "text-maestro-green",
  error: "text-maestro-red",
  timeout: "text-maestro-red",
};

const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: "Idle",
  starting: "Starting...",
  working: "Working",
  "needs-input": "Needs Input",
  done: "Done",
  error: "Error",
  timeout: "Startup Timeout",
};

const providerConfig: Record<AIProvider, { icon: typeof BrainCircuit; label: string }> = {
  claude: { icon: BrainCircuit, label: "Claude Code" },
  gemini: { icon: Sparkles, label: "Gemini CLI" },
  codex: { icon: Code2, label: "Codex" },
  ollama: { icon: Bot, label: "Ollama" },
  plain: { icon: Terminal, label: "Terminal" },
};

export const TerminalHeader = memo(function TerminalHeader({
  sessionId,
  provider = "claude",
  status = "idle",
  mcpCount = 1,
  activeCount = 0,
  statusMessage,
  branchName = "...",
  showLaunch = false,
  isWorktree = false,
  onKill,
  onLaunch,
  terminalCount = 1,
  isZoomed = false,
  onToggleZoom,
  zoomLevel = 100,
  onSetZoomLevel,
}: TerminalHeaderProps) {
  const { icon: ProviderIcon, label: providerLabel } = providerConfig[provider];
  const [showZoomMenu, setShowZoomMenu] = useState(false);
  const zoomMenuRef = useRef<HTMLDivElement>(null);

  const handleZoomPreset = useCallback(
    (level: number) => {
      onSetZoomLevel?.(level);
      setShowZoomMenu(false);
    },
    [onSetZoomLevel],
  );

  // Close zoom menu on outside click
  useEffect(() => {
    if (!showZoomMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (zoomMenuRef.current && !zoomMenuRef.current.contains(e.target as Node)) {
        setShowZoomMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showZoomMenu]);

  // Calculate adaptive styling based on terminal count
  const getAdaptiveClasses = () => {
    if (isZoomed) {
      // When zoomed, use extra large sizes
      return {
        headerHeight: "h-14",
        providerIconSize: 32,
        sessionLabelSize: "text-lg",
        badgeSize: "text-sm",
        badgePadding: "px-3 py-1",
        branchMaxWidth: "max-w-[160px]",
        statusSize: "text-sm",
        showAllElements: true,
        gapSize: "gap-2.5",
      };
    }

    if (terminalCount <= 2) {
      // 1-2 terminals: large size
      return {
        headerHeight: "h-12",
        providerIconSize: 28,
        sessionLabelSize: "text-base",
        badgeSize: "text-xs",
        badgePadding: "px-2.5 py-1",
        branchMaxWidth: "max-w-[140px]",
        statusSize: "text-sm",
        showAllElements: true,
        gapSize: "gap-2",
      };
    } else if (terminalCount <= 3) {
      // 3 terminals: comfortable
      return {
        headerHeight: "h-10",
        providerIconSize: 24,
        sessionLabelSize: "text-sm",
        badgeSize: "text-xs",
        badgePadding: "px-2 py-0.5",
        branchMaxWidth: "max-w-[120px]",
        statusSize: "text-xs",
        showAllElements: true,
        gapSize: "gap-2",
      };
    } else if (terminalCount === 4) {
      // 4 terminals: moderate
      return {
        headerHeight: "h-9",
        providerIconSize: 20,
        sessionLabelSize: "text-[13px]",
        badgeSize: "text-[11px]",
        badgePadding: "px-2 py-0.5",
        branchMaxWidth: "max-w-[100px]",
        statusSize: "text-xs",
        showAllElements: true,
        gapSize: "gap-1.5",
      };
    } else if (terminalCount <= 6) {
      // 5-6 terminals: compact
      return {
        headerHeight: "h-8",
        providerIconSize: 18,
        sessionLabelSize: "text-xs",
        badgeSize: "text-[10px]",
        badgePadding: "px-1.5 py-0.5",
        branchMaxWidth: "max-w-[80px]",
        statusSize: "text-[11px]",
        showAllElements: true,
        gapSize: "gap-1",
      };
    } else {
      // 7+ terminals: moderately compact
      return {
        headerHeight: "h-7",
        providerIconSize: 16,
        sessionLabelSize: "text-[11px]",
        badgeSize: "text-[9px]",
        badgePadding: "px-1.5 py-px",
        branchMaxWidth: "max-w-[60px]",
        statusSize: "text-[10px]",
        showAllElements: false,
        gapSize: "gap-1",
      };
    }
  };

  const adaptive = getAdaptiveClasses();

  return (
    <div className={`no-select flex ${adaptive.headerHeight} shrink-0 items-center ${adaptive.gapSize} border-b border-maestro-border bg-maestro-surface px-2`}>
      {/* Left cluster */}
      <div className={`flex min-w-0 flex-1 items-center ${adaptive.gapSize}`}>
        {/* AI provider icon + dropdown */}
        <button
          type="button"
          aria-label="Select AI provider"
          aria-disabled="true"
          title="Provider selection not yet available"
          className="flex shrink-0 items-center gap-0.5 text-maestro-muted hover:text-maestro-text"
        >
          <ProviderIcon
            size={adaptive.providerIconSize}
            strokeWidth={1.5}
            className="text-violet-500 drop-shadow-[0_0_4px_rgba(139,92,246,0.5)]"
          />
          {!isZoomed && terminalCount <= 4 && <ChevronDown size={9} className="text-maestro-muted/60" />}
        </button>

        {/* Session label */}
        <span className={`shrink-0 font-medium text-maestro-text ${adaptive.sessionLabelSize}`}>
          {providerLabel} #{sessionId}
        </span>

        {/* MCP badge */}
        {(adaptive.showAllElements || terminalCount <= 6) && (
          <span className={`shrink-0 rounded-full bg-maestro-accent/15 font-medium text-maestro-accent ${adaptive.badgePadding} ${adaptive.badgeSize}`}>
            {mcpCount} MCP
          </span>
        )}

        {/* Blue checkmark (verified/ready) - hide in very compact mode */}
        {adaptive.showAllElements && (
          <CheckCircle size={terminalCount <= 4 ? 11 : 9} className="shrink-0 text-maestro-accent" />
        )}

        {/* Active count - hide in compact mode */}
        {adaptive.showAllElements && (
          <span
            className={`shrink-0 rounded-full font-medium ${adaptive.badgePadding} ${adaptive.badgeSize} ${
              activeCount > 0
                ? "bg-maestro-orange/15 text-maestro-orange"
                : "bg-maestro-muted/10 text-maestro-muted"
            }`}
          >
            {activeCount} Active
          </span>
        )}

        {/* Git arrows + change count - hide in compact mode */}
        {adaptive.showAllElements && (
          <span className="flex shrink-0 items-center gap-0.5 text-maestro-muted">
            <GitCompareArrows size={terminalCount <= 4 ? 11 : 9} />
            <span className={adaptive.badgeSize}>0</span>
          </span>
        )}

        {/* Truncated status message - hide in very compact mode */}
        {statusMessage && (adaptive.showAllElements || terminalCount <= 6) && (
          <span className={`min-w-0 truncate text-maestro-muted ${adaptive.badgeSize}`}>{statusMessage}</span>
        )}
      </div>

      {/* Right cluster */}
      <div className="flex shrink-0 items-center gap-0.5">
        {/* Branch display - more compact in dense mode */}
        <span
          className={`flex items-center gap-0.5 px-1 py-0.5 text-maestro-muted ${adaptive.badgeSize}`}
          title={
            isWorktree
              ? `Isolated worktree branch: ${branchName}`
              : `Checked-out branch: ${branchName} (updates live)`
          }
        >
          <GitBranch size={terminalCount <= 4 ? 10 : 8} />
          <span className={`truncate ${adaptive.branchMaxWidth}`}>{branchName}</span>
          {(adaptive.showAllElements || terminalCount <= 6) && (
            <span className={`ml-0.5 rounded font-medium ${adaptive.badgePadding} ${adaptive.badgeSize} ${isWorktree ? "bg-purple-500/15 text-purple-400" : "bg-maestro-accent/15 text-maestro-accent"}`}>
              {isWorktree ? "worktree" : "checked out"}
            </span>
          )}
        </span>

        {/* Launch button (pre-launch only) */}
        {showLaunch && (
          <button
            type="button"
            onClick={() => onLaunch?.()}
            className="rounded bg-maestro-green px-1.5 py-0.5 font-medium text-white transition-colors hover:bg-maestro-green/80 text-[9px]"
          >
            Launch
          </button>
        )}

        {/* Zoom toggle button */}
        {onToggleZoom && (
          <button
            type="button"
            onClick={() => onToggleZoom()}
            className="rounded p-0.5 text-maestro-muted transition-colors hover:bg-maestro-card hover:text-maestro-accent"
            title={isZoomed ? "Restore grid view" : "Zoom terminal"}
            aria-label={isZoomed ? "Restore grid view" : "Zoom terminal"}
          >
            {isZoomed ? <Minimize size={terminalCount <= 4 ? 14 : 12} /> : <Expand size={terminalCount <= 4 ? 14 : 12} />}
          </button>
        )}

        {/* Font zoom indicator + dropdown (hidden at 100%) */}
        {zoomLevel !== 100 && onSetZoomLevel && (
          <div className="relative" ref={zoomMenuRef}>
            <button
              type="button"
              onClick={() => setShowZoomMenu((v) => !v)}
              className="flex items-center gap-0.5 rounded px-1 py-0.5 text-maestro-muted transition-colors hover:bg-maestro-card hover:text-maestro-accent"
              title={`Font zoom: ${zoomLevel}%`}
              aria-label={`Font zoom: ${zoomLevel}%`}
            >
              <ZoomIn size={terminalCount <= 4 ? 12 : 10} />
              <span className={`${adaptive.badgeSize} font-medium`}>{zoomLevel}%</span>
            </button>
            {showZoomMenu && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-maestro-border bg-maestro-surface shadow-lg">
                {[50, 75, 100, 125, 150, 200].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handleZoomPreset(preset)}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-xs transition-colors hover:bg-maestro-card ${
                      zoomLevel === preset
                        ? "font-semibold text-maestro-accent"
                        : "text-maestro-text"
                    }`}
                  >
                    <span>{preset}%</span>
                    <span className="text-[10px] text-maestro-muted">
                      {preset === 100 ? "\u2318 0" : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Status indicator */}
        <span className={`font-medium ${STATUS_COLOR[status]} ${adaptive.statusSize}`}>
          {STATUS_LABEL[status]}
        </span>

        {/* Close button */}
        <button
          type="button"
          onClick={() => onKill(sessionId)}
          className="rounded p-0.5 text-maestro-muted transition-colors hover:bg-maestro-card hover:text-maestro-red"
          title="Kill session"
          aria-label={`Kill session ${sessionId}`}
        >
          <X size={terminalCount <= 4 ? 11 : 9} />
        </button>
      </div>
    </div>
  );
});
