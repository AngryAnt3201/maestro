import {
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Expand,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Loader2,
  Minimize,
  Package,
  Play,
  Search,
  Server,
  Sparkles,
  Star,
  Store,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { BranchWithWorktreeStatus } from "@/lib/git";
import type { McpServerConfig } from "@/lib/mcp";
import type { PluginConfig, SkillConfig } from "@/lib/plugins";
import type { AiMode } from "@/stores/useSessionStore";
import type { RepositoryInfo, WorkspaceType } from "@/stores/useWorkspaceStore";

/** Pre-launch session slot configuration. */
export interface SessionSlot {
  id: string;
  mode: AiMode;
  branch: string | null;
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
}

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
  onModeChange: (mode: AiMode) => void;
  onBranchChange: (branch: string | null) => void;
  onMcpToggle: (serverName: string) => void;
  onSkillToggle: (skillId: string) => void;
  onPluginToggle: (pluginId: string) => void;
  onMcpSelectAll: () => void;
  onMcpUnselectAll: () => void;
  onPluginsSelectAll: () => void;
  onPluginsUnselectAll: () => void;
  onLaunch: () => void;
  onRemove: () => void;
  isZoomed?: boolean;
  onToggleZoom?: () => void;
}

const AI_MODES: { mode: AiMode; icon: typeof BrainCircuit; label: string; color: string }[] = [
  { mode: "Claude", icon: BrainCircuit, label: "Claude Code", color: "text-violet-500" },
  { mode: "Gemini", icon: Sparkles, label: "Gemini CLI", color: "text-blue-400" },
  { mode: "Codex", icon: Code2, label: "Codex", color: "text-green-400" },
  { mode: "Plain", icon: Terminal, label: "Terminal", color: "text-maestro-muted" },
];

function getModeConfig(mode: AiMode) {
  return AI_MODES.find((m) => m.mode === mode) ?? AI_MODES[0];
}

export function PreLaunchCard({
  slot,
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
  onModeChange,
  onBranchChange,
  onMcpToggle,
  onSkillToggle,
  onPluginToggle,
  onMcpSelectAll,
  onMcpUnselectAll,
  onPluginsSelectAll,
  onPluginsUnselectAll,
  onLaunch,
  onRemove,
  isZoomed = false,
  onToggleZoom,
}: PreLaunchCardProps) {
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [mcpDropdownOpen, setMcpDropdownOpen] = useState(false);
  const [pluginsSkillsDropdownOpen, setPluginsSkillsDropdownOpen] = useState(false);
  const [expandedPlugins, setExpandedPlugins] = useState<Set<string>>(new Set());
  const [mcpSearchQuery, setMcpSearchQuery] = useState("");
  const [pluginsSearchQuery, setPluginsSearchQuery] = useState("");
  const [branchSearchQuery, setBranchSearchQuery] = useState("");

  // Multi-repo state: track expanded repos and cached branches per repo
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [repoBranchesCache, setRepoBranchesCache] = useState<Map<string, BranchWithWorktreeStatus[]>>(new Map());
  const [loadingRepos, setLoadingRepos] = useState<Set<string>>(new Set());

  const modeDropdownRef = useRef<HTMLDivElement>(null);
  const branchDropdownRef = useRef<HTMLDivElement>(null);
  const mcpDropdownRef = useRef<HTMLDivElement>(null);
  const pluginsSkillsDropdownRef = useRef<HTMLDivElement>(null);

  const modeConfig = getModeConfig(slot.mode);
  const ModeIcon = modeConfig.icon;

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (modeDropdownRef.current && !modeDropdownRef.current.contains(event.target as Node)) {
        setModeDropdownOpen(false);
      }
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(event.target as Node)) {
        setBranchDropdownOpen(false);
      }
      if (mcpDropdownRef.current && !mcpDropdownRef.current.contains(event.target as Node)) {
        setMcpDropdownOpen(false);
      }
      if (pluginsSkillsDropdownRef.current && !pluginsSkillsDropdownRef.current.contains(event.target as Node)) {
        setPluginsSkillsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // MCP server display info
  const enabledCount = slot.enabledMcpServers.length;
  const totalCount = mcpServers.length;
  const hasMcpServers = totalCount > 0;

  // Helper to extract base name from skill ID (strip prefix like "plugin:", "project:", "personal:")
  const getSkillBaseName = (skillId: string): string => {
    const colonIndex = skillId.indexOf(":");
    return colonIndex >= 0 ? skillId.slice(colonIndex + 1) : skillId;
  };

  // Build a map of skill base name -> skill for quick lookup
  const skillByBaseName = new Map(skills.map((s) => [getSkillBaseName(s.id), s]));

  // Group skills by plugin using the plugin's skills array (matching by base name)
  const pluginSkillsMap = new Map<string, typeof skills>();
  const skillsInPlugins = new Set<string>();

  for (const plugin of plugins) {
    const pluginSkills: typeof skills = [];
    for (const skillId of plugin.skills) {
      const baseName = getSkillBaseName(skillId);
      const skill = skillByBaseName.get(baseName);
      if (skill) {
        pluginSkills.push(skill);
        skillsInPlugins.add(skill.id);
      }
    }
    if (pluginSkills.length > 0) {
      pluginSkillsMap.set(plugin.name, pluginSkills);
    }
  }

  // Toggle plugin expansion
  const togglePluginExpanded = (pluginId: string) => {
    setExpandedPlugins((prev) => {
      const next = new Set(prev);
      if (next.has(pluginId)) {
        next.delete(pluginId);
      } else {
        next.add(pluginId);
      }
      return next;
    });
  };

  // Display info for combined Plugins & Skills
  const enabledPluginsCount = slot.enabledPlugins.length;
  const enabledSkillsCount = slot.enabledSkills.length;
  const hasPluginsOrSkills = plugins.length > 0 || skills.length > 0;

  // Find current branch display info
  const currentBranch = branches.find((b) => b.isCurrent);
  const selectedBranchInfo = slot.branch
    ? branches.find((b) => b.name === slot.branch)
    : currentBranch;
  const displayBranch = selectedBranchInfo?.name ?? slot.branch ?? "Current";

  // Separate local and remote branches
  const localBranches = branches.filter((b) => !b.isRemote);
  // Filter out remote branches that already have a local counterpart
  // e.g., hide "origin/feature/foo" when "feature/foo" exists locally
  const localBranchNames = new Set(localBranches.map((b) => b.name));
  const remoteBranches = branches.filter((b) => {
    if (!b.isRemote) return false;
    const slashIndex = b.name.indexOf("/");
    if (slashIndex === -1) return true;
    const localName = b.name.substring(slashIndex + 1);
    return !localBranchNames.has(localName);
  });

  // Check if this is a multi-repo workspace
  const isMultiRepo = workspaceType === "multi-repo" && repositories && repositories.length > 0;

  // Get the display name for a repo path (folder name)
  const getRepoDisplayName = (path: string): string => {
    const repo = repositories?.find((r) => r.path === path);
    return repo?.name ?? path.split("/").pop() ?? path;
  };

  // Toggle repo expansion and fetch branches if needed
  const toggleRepoExpanded = async (repoPath: string) => {
    const newExpanded = new Set(expandedRepos);

    if (newExpanded.has(repoPath)) {
      // Collapsing
      newExpanded.delete(repoPath);
      setExpandedRepos(newExpanded);
    } else {
      // Expanding - fetch branches if not cached
      newExpanded.add(repoPath);
      setExpandedRepos(newExpanded);

      if (!repoBranchesCache.has(repoPath) && fetchBranchesForRepo) {
        setLoadingRepos((prev) => new Set(prev).add(repoPath));
        try {
          const fetchedBranches = await fetchBranchesForRepo(repoPath);
          setRepoBranchesCache((prev) => new Map(prev).set(repoPath, fetchedBranches));
        } catch (err) {
          console.error("Failed to fetch branches for repo:", err);
        } finally {
          setLoadingRepos((prev) => {
            const next = new Set(prev);
            next.delete(repoPath);
            return next;
          });
        }
      }
    }
  };

  // Handle selecting a repo (use current branch)
  const handleSelectRepo = (repoPath: string) => {
    if (onRepoChange) {
      onRepoChange(repoPath);
    }
    onBranchChange(null); // Use current branch
    setBranchDropdownOpen(false);
    setBranchSearchQuery("");
  };

  // Handle selecting a branch under a specific repo
  const handleSelectRepoBranch = (repoPath: string, branchName: string | null) => {
    if (onRepoChange && repoPath !== selectedRepoPath) {
      onRepoChange(repoPath);
    }
    onBranchChange(branchName);
    setBranchDropdownOpen(false);
    setBranchSearchQuery("");
  };

  // Populate cache with current branches on mount/when branches change
  useEffect(() => {
    if (selectedRepoPath && branches.length > 0) {
      setRepoBranchesCache((prev) => new Map(prev).set(selectedRepoPath, branches));
    }
  }, [selectedRepoPath, branches]);

  // Get the selected repo info for display
  const selectedRepo = repositories?.find((r) => r.path === selectedRepoPath);
  const selectedRepoName = selectedRepo?.name ?? getRepoDisplayName(selectedRepoPath ?? "");

  return (
    <div className="content-dark terminal-cell flex h-full flex-col items-center justify-center bg-maestro-bg p-4">
      {/* Card content */}
      <div className="flex w-full max-w-xs flex-col gap-4">
        {/* Header with remove button */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-maestro-text">Configure Session</span>
          <div className="flex items-center gap-1">
            {/* Zoom toggle button */}
            {onToggleZoom && (
              <button
                type="button"
                onClick={() => onToggleZoom()}
                className="rounded p-1 text-maestro-muted transition-colors hover:bg-maestro-card hover:text-maestro-accent"
                title={isZoomed ? "Restore grid view" : "Zoom terminal"}
                aria-label={isZoomed ? "Restore grid view" : "Zoom terminal"}
              >
                {isZoomed ? <Minimize size={14} /> : <Expand size={14} />}
              </button>
            )}
            <button
              type="button"
              onClick={onRemove}
              className="rounded p-1 text-maestro-muted transition-colors hover:bg-maestro-card hover:text-maestro-red"
              title="Remove session slot"
              aria-label="Remove session slot"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* AI Mode Selector */}
        <div className="relative" ref={modeDropdownRef}>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-maestro-muted">
            AI Mode
          </label>
          <button
            type="button"
            onClick={() => setModeDropdownOpen(!modeDropdownOpen)}
            className="flex w-full items-center justify-between gap-2 rounded border border-maestro-border bg-maestro-card px-3 py-2 text-left text-sm text-maestro-text transition-colors hover:border-maestro-accent/50"
          >
            <div className="flex items-center gap-2">
              <ModeIcon size={16} className={modeConfig.color} />
              <span>{modeConfig.label}</span>
            </div>
            <ChevronDown size={14} className="text-maestro-muted" />
          </button>

          {modeDropdownOpen && (
            <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded border border-maestro-border bg-maestro-card shadow-lg">
              {AI_MODES.map((option) => {
                const Icon = option.icon;
                const isSelected = option.mode === slot.mode;
                return (
                  <button
                    key={option.mode}
                    type="button"
                    onClick={() => {
                      onModeChange(option.mode);
                      setModeDropdownOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      isSelected
                        ? "bg-maestro-accent/10 text-maestro-text"
                        : "text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text"
                    }`}
                  >
                    <Icon size={16} className={option.color} />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Repository & Branch Selector */}
        <div className="relative" ref={branchDropdownRef}>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-maestro-muted">
            {isMultiRepo ? "Repository & Branch" : "Git Branch"}
          </label>
          {!isGitRepo && !isMultiRepo ? (
            <div className="flex items-center gap-2 rounded border border-maestro-border bg-maestro-card/50 px-3 py-2 text-sm text-maestro-muted">
              <Terminal size={14} />
              <span>Not a Git repository</span>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setBranchDropdownOpen(!branchDropdownOpen)}
                disabled={isLoadingBranches}
                className="flex w-full items-center justify-between gap-2 rounded border border-maestro-border bg-maestro-card px-3 py-2 text-left text-sm text-maestro-text transition-colors hover:border-maestro-accent/50 disabled:opacity-50"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {isMultiRepo ? (
                    <>
                      <FolderOpen size={14} className="shrink-0 text-maestro-purple" />
                      <span className="truncate">{selectedRepoName}</span>
                      <span className="text-maestro-muted">/</span>
                      <GitBranch size={12} className="shrink-0 text-maestro-accent" />
                      <span className="truncate text-maestro-muted">{displayBranch}</span>
                    </>
                  ) : (
                    <>
                      <GitBranch size={14} className="shrink-0 text-maestro-accent" />
                      <span className="truncate">{displayBranch}</span>
                    </>
                  )}
                  {selectedBranchInfo?.hasWorktree && (
                    <span title="Worktree exists">
                      <FolderGit2 size={12} className="shrink-0 text-maestro-orange" />
                    </span>
                  )}
                  {selectedBranchInfo?.isCurrent && (
                    <span className="shrink-0 rounded bg-maestro-green/20 px-1 text-[9px] text-maestro-green">
                      current
                    </span>
                  )}
                </div>
                <ChevronDown size={14} className="shrink-0 text-maestro-muted" />
              </button>

              {branchDropdownOpen && (
                <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded border border-maestro-border bg-maestro-card shadow-lg">
                  {/* Search input */}
                  <div className="border-b border-maestro-border p-2">
                    <div className="relative">
                      <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-maestro-muted" />
                      <input
                        type="text"
                        placeholder={isMultiRepo ? "Search repos and branches..." : "Search branches..."}
                        value={branchSearchQuery}
                        onChange={(e) => setBranchSearchQuery(e.target.value)}
                        className="w-full rounded border border-maestro-border bg-maestro-surface py-1.5 pl-7 pr-2 text-xs text-maestro-text placeholder:text-maestro-muted focus:border-maestro-accent focus:outline-none"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>

                  {/* Multi-repo view with expandable repos */}
                  {isMultiRepo ? (
                    <div className="max-h-64 overflow-y-auto">
                      {repositories?.filter((repo) =>
                        !branchSearchQuery ||
                        repo.name.toLowerCase().includes(branchSearchQuery.toLowerCase()) ||
                        repoBranchesCache.get(repo.path)?.some((b) =>
                          b.name.toLowerCase().includes(branchSearchQuery.toLowerCase())
                        )
                      ).map((repo) => {
                        const isSelected = repo.path === selectedRepoPath;
                        const isExpanded = expandedRepos.has(repo.path);
                        const isLoading = loadingRepos.has(repo.path);
                        const repoBranches = repoBranchesCache.get(repo.path) ?? [];
                        const repoLocalBranches = repoBranches.filter((b) => !b.isRemote);
                        const currentRepoBranch = repoBranches.find((b) => b.isCurrent);

                        // Filter branches by search query
                        const filteredBranches = branchSearchQuery
                          ? repoLocalBranches.filter((b) =>
                              b.name.toLowerCase().includes(branchSearchQuery.toLowerCase())
                            )
                          : repoLocalBranches;

                        return (
                          <div key={repo.path} className={isSelected ? "bg-maestro-accent/5" : ""}>
                            {/* Repo header row */}
                            <div className="flex items-center gap-1 px-2 py-1.5 hover:bg-maestro-surface">
                              {/* Expand/collapse button */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleRepoExpanded(repo.path);
                                }}
                                className="shrink-0 rounded p-0.5 hover:bg-maestro-border/40"
                              >
                                {isLoading ? (
                                  <Loader2 size={12} className="animate-spin text-maestro-muted" />
                                ) : isExpanded ? (
                                  <ChevronDown size={12} className="text-maestro-muted" />
                                ) : (
                                  <ChevronRight size={12} className="text-maestro-muted" />
                                )}
                              </button>
                              {/* Repo select button */}
                              <button
                                type="button"
                                onClick={() => handleSelectRepo(repo.path)}
                                className="flex flex-1 items-center gap-2 text-left text-sm"
                              >
                                <FolderOpen size={14} className="shrink-0 text-maestro-purple" />
                                <span className={`flex-1 truncate ${isSelected ? "text-maestro-text font-medium" : "text-maestro-muted"}`}>
                                  {repo.name}
                                </span>
                                {currentRepoBranch && (
                                  <span className="text-[10px] text-maestro-muted">
                                    {currentRepoBranch.name}
                                  </span>
                                )}
                                {isSelected && (
                                  <Check size={12} className="shrink-0 text-maestro-accent" />
                                )}
                              </button>
                            </div>

                            {/* Expanded branches */}
                            {isExpanded && !isLoading && (
                              <div className="ml-5 border-l border-maestro-border/40 pl-2">
                                {/* Use current branch option */}
                                <button
                                  type="button"
                                  onClick={() => handleSelectRepoBranch(repo.path, null)}
                                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-maestro-surface ${
                                    isSelected && slot.branch === null
                                      ? "bg-maestro-accent/10 text-maestro-text"
                                      : "text-maestro-muted"
                                  }`}
                                >
                                  <GitBranch size={12} />
                                  <span>Use current branch</span>
                                  {currentRepoBranch && (
                                    <span className="text-[10px] text-maestro-muted/60">
                                      ({currentRepoBranch.name})
                                    </span>
                                  )}
                                </button>

                                {/* Branch list */}
                                {filteredBranches.map((branch) => {
                                  const isBranchSelected = isSelected && slot.branch === branch.name;
                                  return (
                                    <button
                                      key={branch.name}
                                      type="button"
                                      onClick={() => handleSelectRepoBranch(repo.path, branch.name)}
                                      className={`flex w-full items-center gap-2 px-2 py-1 text-left text-xs transition-colors hover:bg-maestro-surface ${
                                        isBranchSelected
                                          ? "bg-maestro-accent/10 text-maestro-text"
                                          : "text-maestro-muted"
                                      }`}
                                    >
                                      <GitBranch size={11} />
                                      <span className="flex-1 truncate">{branch.name}</span>
                                      {branch.isCurrent && (
                                        <Star size={10} className="shrink-0 text-maestro-green" fill="currentColor" />
                                      )}
                                      {branch.hasWorktree && (
                                        <FolderGit2 size={10} className="shrink-0 text-maestro-orange" />
                                      )}
                                    </button>
                                  );
                                })}

                                {filteredBranches.length === 0 && repoBranches.length > 0 && branchSearchQuery && (
                                  <div className="px-2 py-1 text-[10px] text-maestro-muted">
                                    No matching branches
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* No repos match message */}
                      {branchSearchQuery && repositories?.filter((repo) =>
                        repo.name.toLowerCase().includes(branchSearchQuery.toLowerCase()) ||
                        repoBranchesCache.get(repo.path)?.some((b) =>
                          b.name.toLowerCase().includes(branchSearchQuery.toLowerCase())
                        )
                      ).length === 0 && (
                        <div className="px-3 py-2 text-center text-xs text-maestro-muted">
                          No repos or branches match "{branchSearchQuery}"
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Single-repo branch list (original behavior) */
                    <div className="max-h-48 overflow-y-auto">
                      {/* Current branch option - only show if not searching or if it matches */}
                      {(!branchSearchQuery || "use current branch".includes(branchSearchQuery.toLowerCase())) && (
                        <button
                          type="button"
                          onClick={() => {
                            onBranchChange(null);
                            setBranchDropdownOpen(false);
                            setBranchSearchQuery("");
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                            slot.branch === null
                              ? "bg-maestro-accent/10 text-maestro-text"
                              : "text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text"
                          }`}
                        >
                          <GitBranch size={14} />
                          <span>Use current branch</span>
                        </button>
                      )}

                      {/* Local branches */}
                      {localBranches.filter((b) =>
                        b.name.toLowerCase().includes(branchSearchQuery.toLowerCase())
                      ).length > 0 && (
                        <>
                          <div className="border-t border-maestro-border px-3 py-1 text-[9px] font-medium uppercase tracking-wide text-maestro-muted">
                            Local
                          </div>
                          {localBranches
                            .filter((b) => b.name.toLowerCase().includes(branchSearchQuery.toLowerCase()))
                            .map((branch) => (
                              <button
                                key={branch.name}
                                type="button"
                                onClick={() => {
                                  onBranchChange(branch.name);
                                  setBranchDropdownOpen(false);
                                  setBranchSearchQuery("");
                                }}
                                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                  slot.branch === branch.name
                                    ? "bg-maestro-accent/10 text-maestro-text"
                                    : "text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text"
                                }`}
                              >
                                <GitBranch size={14} />
                                <span className="truncate">{branch.name}</span>
                                {branch.hasWorktree && (
                                  <span title="Worktree exists">
                                    <FolderGit2 size={12} className="shrink-0 text-maestro-orange" />
                                  </span>
                                )}
                                {branch.isCurrent && (
                                  <span className="shrink-0 rounded bg-maestro-green/20 px-1 text-[9px] text-maestro-green">
                                    current
                                  </span>
                                )}
                              </button>
                            ))}
                        </>
                      )}

                      {/* Remote branches */}
                      {remoteBranches.filter((b) =>
                        b.name.toLowerCase().includes(branchSearchQuery.toLowerCase())
                      ).length > 0 && (
                        <>
                          <div className="border-t border-maestro-border px-3 py-1 text-[9px] font-medium uppercase tracking-wide text-maestro-muted">
                            Remote
                          </div>
                          {remoteBranches
                            .filter((b) => b.name.toLowerCase().includes(branchSearchQuery.toLowerCase()))
                            .map((branch) => (
                              <button
                                key={branch.name}
                                type="button"
                                onClick={() => {
                                  onBranchChange(branch.name);
                                  setBranchDropdownOpen(false);
                                  setBranchSearchQuery("");
                                }}
                                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                  slot.branch === branch.name
                                    ? "bg-maestro-accent/10 text-maestro-text"
                                    : "text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text"
                                }`}
                              >
                                <GitBranch size={14} className="text-maestro-muted/60" />
                                <span className="truncate">{branch.name}</span>
                                {branch.hasWorktree && (
                                  <span title="Worktree exists">
                                    <FolderGit2 size={12} className="shrink-0 text-maestro-orange" />
                                  </span>
                                )}
                              </button>
                            ))}
                        </>
                      )}

                      {/* No results message */}
                      {branchSearchQuery &&
                        localBranches.filter((b) => b.name.toLowerCase().includes(branchSearchQuery.toLowerCase())).length === 0 &&
                        remoteBranches.filter((b) => b.name.toLowerCase().includes(branchSearchQuery.toLowerCase())).length === 0 &&
                        !"use current branch".includes(branchSearchQuery.toLowerCase()) && (
                          <div className="px-3 py-2 text-center text-xs text-maestro-muted">
                            No branches match "{branchSearchQuery}"
                          </div>
                        )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* MCP Servers Selector */}
        <div className="relative" ref={mcpDropdownRef}>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-maestro-muted">
            MCP Servers
          </label>
          {!hasMcpServers ? (
            <div className="flex items-center gap-2 rounded border border-maestro-border bg-maestro-card/50 px-3 py-2 text-sm text-maestro-muted">
              <Server size={14} />
              <span>No MCP servers configured</span>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setMcpDropdownOpen(!mcpDropdownOpen)}
                className="flex w-full items-center justify-between gap-2 rounded border border-maestro-border bg-maestro-card px-3 py-2 text-left text-sm text-maestro-text transition-colors hover:border-maestro-accent/50"
              >
                <div className="flex items-center gap-2">
                  <Server size={14} className="text-maestro-green" />
                  <span>
                    {enabledCount} of {totalCount} servers
                  </span>
                </div>
                <ChevronDown size={14} className="text-maestro-muted" />
              </button>

              {mcpDropdownOpen && (
                <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded border border-maestro-border bg-maestro-card shadow-lg">
                  {/* Search input */}
                  <div className="border-b border-maestro-border p-2">
                    <div className="relative">
                      <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-maestro-muted" />
                      <input
                        type="text"
                        placeholder="Search servers..."
                        value={mcpSearchQuery}
                        onChange={(e) => setMcpSearchQuery(e.target.value)}
                        className="w-full rounded border border-maestro-border bg-maestro-surface py-1.5 pl-7 pr-2 text-xs text-maestro-text placeholder:text-maestro-muted focus:border-maestro-accent focus:outline-none"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>
                  {/* Select All / Unselect All buttons */}
                  <div className="flex items-center justify-between border-b border-maestro-border px-2 py-1.5">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onMcpSelectAll();
                        }}
                        className="rounded bg-maestro-surface px-2 py-0.5 text-[10px] text-maestro-muted transition-colors hover:bg-maestro-border hover:text-maestro-text"
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onMcpUnselectAll();
                        }}
                        className="rounded bg-maestro-surface px-2 py-0.5 text-[10px] text-maestro-muted transition-colors hover:bg-maestro-border hover:text-maestro-text"
                      >
                        Unselect All
                      </button>
                    </div>
                    <span className="text-[10px] text-maestro-muted">
                      {enabledCount}/{totalCount}
                    </span>
                  </div>
                  {/* Server list */}
                  <div className="max-h-36 overflow-y-auto">
                    {mcpServers
                      .filter((server) =>
                        server.name.toLowerCase().includes(mcpSearchQuery.toLowerCase())
                      )
                      .map((server) => {
                        const isEnabled = slot.enabledMcpServers.includes(server.name);
                        const serverType = server.type;
                        return (
                          <button
                            key={server.name}
                            type="button"
                            onClick={() => onMcpToggle(server.name)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-maestro-surface"
                          >
                            <span
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                isEnabled
                                  ? "border-maestro-green bg-maestro-green"
                                  : "border-maestro-border bg-transparent"
                              }`}
                            >
                              {isEnabled && <Check size={12} className="text-white" />}
                            </span>
                            <span className={isEnabled ? "text-maestro-text" : "text-maestro-muted"}>
                              {server.name}
                            </span>
                            <span className="ml-auto text-[10px] text-maestro-muted/60">
                              {serverType}
                            </span>
                          </button>
                        );
                      })}
                    {mcpServers.filter((server) =>
                      server.name.toLowerCase().includes(mcpSearchQuery.toLowerCase())
                    ).length === 0 && (
                      <div className="px-3 py-2 text-center text-xs text-maestro-muted">
                        No servers match "{mcpSearchQuery}"
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Plugins & Skills Selector */}
        <div className="relative" ref={pluginsSkillsDropdownRef}>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-maestro-muted">
            Plugins & Skills
          </label>
          {!hasPluginsOrSkills ? (
            <div className="flex items-center gap-2 rounded border border-maestro-border bg-maestro-card/50 px-3 py-2 text-sm text-maestro-muted">
              <Store size={14} />
              <span>No plugins or skills configured</span>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setPluginsSkillsDropdownOpen(!pluginsSkillsDropdownOpen)}
                className="flex w-full items-center justify-between gap-2 rounded border border-maestro-border bg-maestro-card px-3 py-2 text-left text-sm text-maestro-text transition-colors hover:border-maestro-accent/50"
              >
                <div className="flex items-center gap-2">
                  <Store size={14} className="text-maestro-purple" />
                  <span>
                    {enabledPluginsCount} plugins, {enabledSkillsCount} skills
                  </span>
                </div>
                <ChevronDown size={14} className="text-maestro-muted" />
              </button>

              {pluginsSkillsDropdownOpen && (
                <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded border border-maestro-border bg-maestro-card shadow-lg">
                  {/* Search input */}
                  <div className="border-b border-maestro-border p-2">
                    <div className="relative">
                      <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-maestro-muted" />
                      <input
                        type="text"
                        placeholder="Search plugins & skills..."
                        value={pluginsSearchQuery}
                        onChange={(e) => setPluginsSearchQuery(e.target.value)}
                        className="w-full rounded border border-maestro-border bg-maestro-surface py-1.5 pl-7 pr-2 text-xs text-maestro-text placeholder:text-maestro-muted focus:border-maestro-accent focus:outline-none"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>
                  {/* Select All / Unselect All buttons */}
                  <div className="flex items-center justify-between border-b border-maestro-border px-2 py-1.5">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPluginsSelectAll();
                        }}
                        className="rounded bg-maestro-surface px-2 py-0.5 text-[10px] text-maestro-muted transition-colors hover:bg-maestro-border hover:text-maestro-text"
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPluginsUnselectAll();
                        }}
                        className="rounded bg-maestro-surface px-2 py-0.5 text-[10px] text-maestro-muted transition-colors hover:bg-maestro-border hover:text-maestro-text"
                      >
                        Unselect All
                      </button>
                    </div>
                    <span className="text-[10px] text-maestro-muted">
                      {enabledPluginsCount}P / {enabledSkillsCount}S
                    </span>
                  </div>
                  {/* Scrollable content */}
                  <div className="max-h-52 overflow-y-auto">
                    {/* Plugins with their skills */}
                    {plugins.length > 0 && (
                      <>
                        <div className="border-b border-maestro-border px-3 py-1.5 text-[9px] font-medium uppercase tracking-wide text-maestro-muted">
                          Plugins ({plugins.length})
                        </div>
                        {plugins
                          .filter((plugin) => {
                            if (!pluginsSearchQuery) return true;
                            const query = pluginsSearchQuery.toLowerCase();
                            // Match plugin name
                            if (plugin.name.toLowerCase().includes(query)) return true;
                            // Match any skill name within the plugin
                            const pluginSkills = pluginSkillsMap.get(plugin.name) ?? [];
                            return pluginSkills.some((skill) =>
                              skill.name.toLowerCase().includes(query)
                            );
                          })
                          .map((plugin) => {
                            const isPluginEnabled = slot.enabledPlugins.includes(plugin.id);
                            const pluginSkills = pluginSkillsMap.get(plugin.name) ?? [];
                            const isExpanded = expandedPlugins.has(plugin.id);
                            const hasSkillsToShow = pluginSkills.length > 0;

                            // Filter skills by search query
                            const filteredPluginSkills = pluginsSearchQuery
                              ? pluginSkills.filter((skill) =>
                                  skill.name.toLowerCase().includes(pluginsSearchQuery.toLowerCase())
                                )
                              : pluginSkills;

                            return (
                              <div key={plugin.id}>
                                {/* Plugin row */}
                                <div className="flex items-center gap-1 px-2 py-1.5 hover:bg-maestro-surface">
                                  {/* Expand/collapse button */}
                                  {hasSkillsToShow ? (
                                    <button
                                      type="button"
                                      onClick={() => togglePluginExpanded(plugin.id)}
                                      className="shrink-0 rounded p-0.5 hover:bg-maestro-border/40"
                                    >
                                      {isExpanded ? (
                                        <ChevronDown size={12} className="text-maestro-muted" />
                                      ) : (
                                        <ChevronRight size={12} className="text-maestro-muted" />
                                      )}
                                    </button>
                                  ) : (
                                    <span className="w-5" />
                                  )}
                                  {/* Plugin checkbox */}
                                  <button
                                    type="button"
                                    onClick={() => onPluginToggle(plugin.id)}
                                    className="flex flex-1 items-center gap-2 text-left text-sm"
                                  >
                                    <span
                                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                        isPluginEnabled
                                          ? "border-maestro-purple bg-maestro-purple"
                                          : "border-maestro-border bg-transparent"
                                      }`}
                                    >
                                      {isPluginEnabled && <Check size={12} className="text-white" />}
                                    </span>
                                    <Package size={12} className="shrink-0 text-maestro-purple" />
                                    <span className={`flex-1 truncate ${isPluginEnabled ? "text-maestro-text" : "text-maestro-muted"}`}>
                                      {plugin.name}
                                    </span>
                                    {hasSkillsToShow && (
                                      <span className="text-[10px] text-maestro-muted">{pluginSkills.length}</span>
                                    )}
                                    <span className="text-[10px] text-maestro-muted/60">v{plugin.version}</span>
                                  </button>
                                </div>
                                {/* Expanded skills */}
                                {isExpanded && hasSkillsToShow && (
                                  <div className="ml-5 border-l border-maestro-border/40 pl-2">
                                    {(pluginsSearchQuery ? filteredPluginSkills : pluginSkills).map((skill) => {
                                      const isSkillEnabled = slot.enabledSkills.includes(skill.id);
                                      return (
                                        <button
                                          key={skill.id}
                                          type="button"
                                          onClick={() => onSkillToggle(skill.id)}
                                          className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm transition-colors hover:bg-maestro-surface"
                                          title={skill.description || undefined}
                                        >
                                          <span
                                            className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                                              isSkillEnabled
                                                ? "border-maestro-orange bg-maestro-orange"
                                                : "border-maestro-border bg-transparent"
                                            }`}
                                          >
                                            {isSkillEnabled && <Check size={10} className="text-white" />}
                                          </span>
                                          <Zap size={11} className="shrink-0 text-maestro-orange" />
                                          <span className={`flex-1 truncate text-xs ${isSkillEnabled ? "text-maestro-text" : "text-maestro-muted"}`}>
                                            {skill.name}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </>
                    )}

                    {/* Standalone Skills - hidden from toggles since Claude CLI cannot disable them per-session */}

                    {/* No results message */}
                    {pluginsSearchQuery &&
                     plugins.filter((plugin) => {
                       const query = pluginsSearchQuery.toLowerCase();
                       if (plugin.name.toLowerCase().includes(query)) return true;
                       const pluginSkills = pluginSkillsMap.get(plugin.name) ?? [];
                       return pluginSkills.some((skill) => skill.name.toLowerCase().includes(query));
                     }).length === 0 && (
                      <div className="px-3 py-2 text-center text-xs text-maestro-muted">
                        No results match "{pluginsSearchQuery}"
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Launch Button */}
        <button
          type="button"
          onClick={onLaunch}
          className="flex items-center justify-center gap-2 rounded bg-maestro-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-maestro-accent/80"
        >
          <Play size={16} fill="currentColor" />
          Launch Session
        </button>
      </div>
    </div>
  );
}
