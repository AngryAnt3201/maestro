import {
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  FolderGit2,
  GitBranch,
  Package,
  Play,
  Search,
  Server,
  Sparkles,
  Store,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { BranchWithWorktreeStatus } from "@/lib/git";
import type { McpServerConfig } from "@/lib/mcp";
import type { PluginConfig, SkillConfig, SkillSource } from "@/lib/plugins";
import type { AiMode } from "@/stores/useSessionStore";

/** Returns badge styling and text for a skill source. */
function getSkillSourceLabel(source: SkillSource): { text: string; className: string } {
  switch (source.type) {
    case "project":
      return {
        text: "Project",
        className: "bg-maestro-accent/20 text-maestro-accent",
      };
    case "personal":
      return {
        text: "Personal",
        className: "bg-maestro-green/20 text-maestro-green",
      };
    case "plugin":
      return {
        text: source.name,
        className: "bg-maestro-purple/20 text-maestro-purple",
      };
    case "legacy":
      return {
        text: "Legacy",
        className: "bg-maestro-muted/20 text-maestro-muted",
      };
  }
}

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
}: PreLaunchCardProps) {
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [mcpDropdownOpen, setMcpDropdownOpen] = useState(false);
  const [pluginsSkillsDropdownOpen, setPluginsSkillsDropdownOpen] = useState(false);
  const [expandedPlugins, setExpandedPlugins] = useState<Set<string>>(new Set());
  const [mcpSearchQuery, setMcpSearchQuery] = useState("");
  const [pluginsSearchQuery, setPluginsSearchQuery] = useState("");
  const [branchSearchQuery, setBranchSearchQuery] = useState("");
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

  // Standalone skills are those not claimed by any plugin
  const standaloneSkills = skills.filter((s) => !skillsInPlugins.has(s.id));

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
  const remoteBranches = branches.filter((b) => b.isRemote);

  return (
    <div className="content-dark terminal-cell flex h-full flex-col items-center justify-center bg-maestro-bg p-4">
      {/* Card content */}
      <div className="flex w-full max-w-xs flex-col gap-4">
        {/* Header with remove button */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-maestro-text">Configure Session</span>
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

        {/* Branch Selector */}
        <div className="relative" ref={branchDropdownRef}>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-maestro-muted">
            Git Branch
          </label>
          {!isGitRepo ? (
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
                  <GitBranch size={14} className="shrink-0 text-maestro-accent" />
                  <span className="truncate">{displayBranch}</span>
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
                        placeholder="Search branches..."
                        value={branchSearchQuery}
                        onChange={(e) => setBranchSearchQuery(e.target.value)}
                        className="w-full rounded border border-maestro-border bg-maestro-surface py-1.5 pl-7 pr-2 text-xs text-maestro-text placeholder:text-maestro-muted focus:border-maestro-accent focus:outline-none"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>
                  {/* Branch list */}
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

                    {/* Standalone Skills */}
                    {standaloneSkills.length > 0 && (
                      <>
                        <div className="border-b border-t border-maestro-border px-3 py-1.5 text-[9px] font-medium uppercase tracking-wide text-maestro-muted">
                          Skills ({standaloneSkills.length})
                        </div>
                        {standaloneSkills
                          .filter((skill) =>
                            !pluginsSearchQuery ||
                            skill.name.toLowerCase().includes(pluginsSearchQuery.toLowerCase())
                          )
                          .map((skill) => {
                            const isEnabled = slot.enabledSkills.includes(skill.id);
                            const sourceLabel = getSkillSourceLabel(skill.source);
                            return (
                              <button
                                key={skill.id}
                                type="button"
                                onClick={() => onSkillToggle(skill.id)}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-maestro-surface"
                                title={skill.description || undefined}
                              >
                                <span
                                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                    isEnabled
                                      ? "border-maestro-orange bg-maestro-orange"
                                      : "border-maestro-border bg-transparent"
                                  }`}
                                >
                                  {isEnabled && <Check size={12} className="text-white" />}
                                </span>
                                <Zap size={12} className="shrink-0 text-maestro-orange" />
                                <span className={`flex-1 truncate ${isEnabled ? "text-maestro-text" : "text-maestro-muted"}`}>
                                  {skill.name}
                                </span>
                                <span className={`shrink-0 rounded px-1 text-[9px] ${sourceLabel.className}`}>
                                  {sourceLabel.text}
                                </span>
                              </button>
                            );
                          })}
                      </>
                    )}

                    {/* No results message */}
                    {pluginsSearchQuery &&
                     plugins.filter((plugin) => {
                       const query = pluginsSearchQuery.toLowerCase();
                       if (plugin.name.toLowerCase().includes(query)) return true;
                       const pluginSkills = pluginSkillsMap.get(plugin.name) ?? [];
                       return pluginSkills.some((skill) => skill.name.toLowerCase().includes(query));
                     }).length === 0 &&
                     standaloneSkills.filter((skill) =>
                       skill.name.toLowerCase().includes(pluginsSearchQuery.toLowerCase())
                     ).length === 0 && (
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
