import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import Play from "lucide-react/dist/esm/icons/play";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { useEffect, useRef, useState } from "react";
import { AiModeSelector } from "@/components/terminal/PreLaunchCard/components/AiModeSelector/AiModeSelector";
import { BranchSelector } from "@/components/terminal/PreLaunchCard/components/BranchSelector/BranchSelector";
import { McpServerSelector } from "@/components/terminal/PreLaunchCard/components/McpServerSelector/McpServerSelector";
import { PluginsSkillsSelector } from "@/components/terminal/PreLaunchCard/components/PluginsSkillsSelector/PluginsSkillsSelector";
import { PreLaunchCardHeader } from "@/components/terminal/PreLaunchCard/components/PreLaunchCardHeader/PreLaunchCardHeader";
import { WorktreeModeSelector } from "@/components/terminal/PreLaunchCard/components/WorktreeModeSelector/WorktreeModeSelector";
import type {
  SessionSlot,
  WorktreeMode,
} from "@/components/terminal/PreLaunchCard/PreLaunchCard.types";
import type { BranchWithWorktreeStatus } from "@/lib/git";
import type { McpServerConfig } from "@/lib/mcp";
import type { PluginConfig, SkillConfig } from "@/lib/plugins";
import { type ClaudeSessionInfo, deleteClaudeSession, listClaudeSessions } from "@/lib/terminal";
import type { AiMode } from "@/stores/useSessionStore";
import type { RepositoryInfo, WorkspaceType } from "@/stores/useWorkspaceStore";

interface PreLaunchCardProps {
  slot: SessionSlot;
  projectPath: string;
  branches: BranchWithWorktreeStatus[];
  isLoadingBranches: boolean;
  isGitRepo: boolean;
  /** List of repositories for multi-repo workspaces. */
  repositories?: RepositoryInfo[];
  /** Workspace type - single-repo, multi-repo, or non-git. */
  workspaceType?: WorkspaceType;
  /** Currently selected repository path. */
  selectedRepoPath?: string;
  /** Callback to change the selected repository. */
  onRepoChange?: (path: string) => void;
  /** Function to fetch branches for any repository (for lazy loading). */
  fetchBranchesForRepo?: (repoPath: string) => Promise<BranchWithWorktreeStatus[]>;
  mcpServers: McpServerConfig[];
  skills: SkillConfig[];
  plugins: PluginConfig[];
  onCreateBranch?: (name: string, andCheckout: boolean, repoPath?: string) => Promise<void>;
  onModeChange: (mode: AiMode) => void;
  onBranchChange: (branch: string | null) => void;
  onWorktreeModeChange: (mode: WorktreeMode) => void;
  /** Whether a managed worktree exists for the current project. Disables "Current Worktree" if false. */
  hasManagedWorktree?: boolean;
  /** Called when the branch dropdown is opened, to refresh the branch list. */
  onRefreshBranches?: () => void;
  onMcpToggle: (serverName: string) => void;
  onSkillToggle: (skillId: string) => void;
  onPluginToggle: (pluginId: string) => void;
  onMcpSelectAll: () => void;
  onMcpUnselectAll: () => void;
  onPluginsSelectAll: () => void;
  onPluginsUnselectAll: () => void;
  onLaunch: () => void;
  onRemove: () => void;
  onResumeSessionChange: (sessionId: string | null) => void;
  isZoomed?: boolean;
  onToggleZoom?: () => void;
}

function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

export function PreLaunchCard({
  slot,
  projectPath,
  branches,
  isLoadingBranches,
  isGitRepo,
  repositories,
  workspaceType,
  selectedRepoPath,
  onRepoChange,
  fetchBranchesForRepo,
  mcpServers,
  skills,
  plugins,
  onCreateBranch,
  onModeChange,
  onBranchChange,
  onWorktreeModeChange,
  hasManagedWorktree = false,
  onRefreshBranches,
  onMcpToggle,
  onSkillToggle,
  onPluginToggle,
  onMcpSelectAll,
  onMcpUnselectAll,
  onPluginsSelectAll,
  onPluginsUnselectAll,
  onLaunch,
  onRemove,
  onResumeSessionChange,
  isZoomed = false,
  onToggleZoom,
}: PreLaunchCardProps) {
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const modeDropdownRef = useRef<HTMLDivElement>(null);
  const [claudeSessions, setClaudeSessions] = useState<ClaudeSessionInfo[]>([]);

  useEffect(() => {
    if (slot.mode !== "Claude") {
      setClaudeSessions([]);
      return;
    }
    let ignore = false;
    const sessionPath = selectedRepoPath || projectPath;
    listClaudeSessions(sessionPath)
      .then((sessions) => {
        if (!ignore) setClaudeSessions(sessions);
      })
      .catch(() => {
        if (!ignore) setClaudeSessions([]);
      });
    return () => {
      ignore = true;
    };
  }, [slot.mode, selectedRepoPath, projectPath]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (modeDropdownRef.current && !modeDropdownRef.current.contains(event.target as Node)) {
        setModeDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="content-dark terminal-cell flex h-full flex-col items-center justify-center bg-maestro-bg p-4">
      <div className="flex w-full max-w-xs flex-col gap-4">
        <PreLaunchCardHeader isZoomed={isZoomed} onToggleZoom={onToggleZoom} onRemove={onRemove} />

        <div className="relative" ref={modeDropdownRef}>
          <AiModeSelector
            mode={slot.mode}
            isOpen={modeDropdownOpen}
            onToggleOpen={() => setModeDropdownOpen((current) => !current)}
            onModeChange={onModeChange}
            onClose={() => setModeDropdownOpen(false)}
          />
        </div>

        <BranchSelector
          branch={slot.branch}
          projectPath={projectPath}
          branches={branches}
          isLoadingBranches={isLoadingBranches}
          isGitRepo={isGitRepo}
          repositories={repositories}
          workspaceType={workspaceType}
          selectedRepoPath={selectedRepoPath}
          onRepoChange={onRepoChange}
          fetchBranchesForRepo={fetchBranchesForRepo}
          onCreateBranch={onCreateBranch}
          onBranchChange={onBranchChange}
          onRefreshBranches={onRefreshBranches}
        />

        {isGitRepo && (
          <WorktreeModeSelector
            mode={slot.worktreeMode}
            hasManagedWorktree={hasManagedWorktree}
            onChange={onWorktreeModeChange}
          />
        )}

        <McpServerSelector
          enabledServerNames={slot.enabledMcpServers}
          servers={mcpServers}
          onToggle={onMcpToggle}
          onSelectAll={onMcpSelectAll}
          onUnselectAll={onMcpUnselectAll}
        />

        <PluginsSkillsSelector
          enabledPluginIds={slot.enabledPlugins}
          enabledSkillIds={slot.enabledSkills}
          plugins={plugins}
          skills={skills}
          onPluginToggle={onPluginToggle}
          onSkillToggle={onSkillToggle}
          onSelectAll={onPluginsSelectAll}
          onUnselectAll={onPluginsUnselectAll}
        />

        {slot.mode === "Claude" && claudeSessions.length > 0 && (
          <div>
            <div className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-maestro-muted">
              Resume Previous Session
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {claudeSessions.map((session) => {
                const isSelected = slot.resumeSessionId === session.session_id;
                return (
                  <div
                    key={session.session_id}
                    className={`relative flex w-44 shrink-0 flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                      isSelected
                        ? "border-violet-500/50 bg-violet-500/10"
                        : "border-maestro-border bg-maestro-card hover:border-maestro-accent/50"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onResumeSessionChange(isSelected ? null : session.session_id)}
                      className="flex flex-1 flex-col gap-1 text-left"
                    >
                      <span className="line-clamp-2 pr-4 text-xs leading-snug text-maestro-text">
                        {session.first_prompt ?? "No prompt recorded"}
                      </span>
                      <div className="flex items-center gap-1.5 text-[10px] text-maestro-muted">
                        {session.git_branch && (
                          <span className="flex items-center gap-0.5 truncate">
                            <GitBranch size={9} />
                            {session.git_branch}
                          </span>
                        )}
                        <span className="shrink-0">{formatRelativeTime(session.last_active)}</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      title="Delete session"
                      onClick={(event) => {
                        event.stopPropagation();
                        const preview = session.first_prompt?.trim().slice(0, 80) ?? "this session";
                        if (
                          !window.confirm(
                            `Delete \u201C${preview}\u201D? The transcript cannot be recovered.`,
                          )
                        ) {
                          return;
                        }
                        if (isSelected) onResumeSessionChange(null);
                        deleteClaudeSession(selectedRepoPath || projectPath, session.session_id)
                          .then(() => {
                            setClaudeSessions((current) =>
                              current.filter((item) => item.session_id !== session.session_id),
                            );
                          })
                          .catch((error) => {
                            console.error("Failed to delete Claude session:", error);
                          });
                      }}
                      className="absolute right-1.5 top-1.5 rounded p-0.5 text-maestro-muted opacity-0 transition-opacity hover:text-maestro-red [div:hover>&]:opacity-100"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onLaunch}
          className="flex items-center justify-center gap-2 rounded bg-maestro-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-maestro-accent/80"
        >
          <Play size={16} fill="currentColor" />
          {slot.resumeSessionId ? "Resume Session" : "Launch Session"}
        </button>
      </div>
    </div>
  );
}
