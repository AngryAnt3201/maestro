import { memo } from "react";
import {
  BrainCircuit,
  CheckCircle,
  ChevronDown,
  Code2,
  GitBranch,
  GitCompareArrows,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";

export type SessionStatus = "idle" | "starting" | "working" | "needs-input" | "done" | "error" | "timeout";

export type AIProvider = "claude" | "gemini" | "codex" | "plain";

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
}: TerminalHeaderProps) {
  const { icon: ProviderIcon, label: providerLabel } = providerConfig[provider];

  return (
    <div className="no-select flex h-7 shrink-0 items-center gap-1.5 border-b border-maestro-border bg-maestro-surface px-2">
      {/* Left cluster */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {/* AI provider icon + dropdown */}
        <button
          type="button"
          aria-label="Select AI provider"
          aria-disabled="true"
          title="Provider selection not yet available"
          className="flex shrink-0 items-center gap-0.5 text-maestro-muted hover:text-maestro-text"
        >
          <ProviderIcon
            size={18}
            strokeWidth={1.5}
            className="text-violet-500 drop-shadow-[0_0_4px_rgba(139,92,246,0.5)]"
          />
          <ChevronDown size={9} className="text-maestro-muted/60" />
        </button>

        {/* Session label */}
        <span className="shrink-0 text-[11px] font-medium text-maestro-text">
          {providerLabel} #{sessionId}
        </span>

        {/* MCP badge */}
        <span className="shrink-0 rounded-full bg-maestro-accent/15 px-1.5 py-px text-[9px] font-medium text-maestro-accent">
          {mcpCount} MCP
        </span>

        {/* Terminal count badge */}
        {/* TODO: Replace hardcoded "1" with actual terminal count prop */}
        <span className="shrink-0 rounded-full bg-maestro-muted/10 px-1.5 py-px text-[9px] font-medium text-maestro-muted">
          1
        </span>

        {/* Blue checkmark (verified/ready) */}
        <CheckCircle size={11} className="shrink-0 text-maestro-accent" />

        {/* Active count */}
        <span
          className={`shrink-0 rounded-full px-1.5 py-px text-[9px] font-medium ${
            activeCount > 0
              ? "bg-maestro-orange/15 text-maestro-orange"
              : "bg-maestro-muted/10 text-maestro-muted"
          }`}
        >
          {activeCount} Active
        </span>

        {/* Git arrows + change count */}
        {/* TODO: Replace hardcoded "0" with actual git change count prop */}
        <span className="flex shrink-0 items-center gap-0.5 text-maestro-muted">
          <GitCompareArrows size={11} />
          <span className="text-[9px]">0</span>
        </span>

        {/* Truncated status message */}
        {statusMessage && (
          <span className="min-w-0 truncate text-[10px] text-maestro-muted">{statusMessage}</span>
        )}
      </div>

      {/* Right cluster */}
      <div className="flex shrink-0 items-center gap-1">
        {/* Branch display */}
        <span
          className="flex items-center gap-0.5 px-1 py-0.5 text-[10px] text-maestro-muted"
          title={
            isWorktree
              ? `Isolated worktree branch: ${branchName}`
              : `Checked-out branch: ${branchName} (updates live)`
          }
        >
          <GitBranch size={10} />
          <span className="max-w-[80px] truncate">{branchName}</span>
          <span className={`ml-0.5 rounded px-1 py-px text-[8px] font-medium ${isWorktree ? "bg-purple-500/15 text-purple-400" : "bg-maestro-accent/15 text-maestro-accent"}`}>
            {isWorktree ? "worktree" : "checked out"}
          </span>
        </span>

        {/* Launch button (pre-launch only) */}
        {showLaunch && (
          <button
            type="button"
            onClick={() => onLaunch?.()}
            className="rounded bg-maestro-green px-2 py-0.5 text-[10px] font-medium text-white transition-colors hover:bg-maestro-green/80"
          >
            Launch
          </button>
        )}

        {/* Status indicator */}
        <span className={`text-[10px] font-medium ${STATUS_COLOR[status]}`}>
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
          <X size={11} />
        </button>
      </div>
    </div>
  );
});
