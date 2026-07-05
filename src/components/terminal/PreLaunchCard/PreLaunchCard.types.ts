import type { AiMode } from "@/stores/useSessionStore";

/** Controls how a session's working directory is resolved at launch. */
export type WorktreeMode = "auto" | "project" | "new";

/** Pre-launch session slot configuration. */
export interface SessionSlot {
  id: string;
  mode: AiMode;
  branch: string | null;
  worktreeMode: WorktreeMode;
  sessionId: number | null;
  /** Path to the worktree if one was created for this session. */
  worktreePath: string | null;
  /** Warning message from worktree preparation (e.g., fallback to project path). */
  worktreeWarning: string | null;
  /** Names of enabled MCP servers for this session. */
  enabledMcpServers: string[];
  /** IDs of enabled skills for this session. */
  enabledSkills: string[];
  /** IDs of enabled plugins for this session. */
  enabledPlugins: string[];
  /** Claude session UUID to resume, if resuming a previous session. */
  resumeSessionId?: string | null;
}
