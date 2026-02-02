import {
  Activity,
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Circle,
  Cpu,
  FileText,
  GitBranch,
  Globe,
  Home,
  Moon,
  Package,
  Play,
  PlusCircle,
  RefreshCw,
  Server,
  Settings,
  Skull,
  Sparkles,
  Store,
  Sun,
  User,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type AiMode, type BackendSessionStatus, useSessionStore } from "@/stores/useSessionStore";
import { useGitStore } from "@/stores/useGitStore";
import { useMcpStore } from "@/stores/useMcpStore";
import { usePluginStore } from "@/stores/usePluginStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { useProcessTreeStore, type ProcessInfo, type SessionProcessTree } from "@/stores/useProcessTreeStore";
import { GitSettingsModal, RemoteStatusIndicator } from "@/components/git";
import { QuickActionsManager } from "@/components/quickactions/QuickActionsManager";
import { MarketplaceBrowser } from "@/components/marketplace";

type SidebarTab = "config" | "processes";

interface SidebarProps {
  collapsed?: boolean;
  onCollapse?: () => void;
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
}

/* ── Shared card class ── */
const cardClass =
  "rounded-lg border border-maestro-border/60 bg-maestro-card p-3 shadow-[0_1px_4px_rgb(0_0_0/0.15),0_0_0_1px_rgb(255_255_255/0.03)_inset] transition-shadow hover:shadow-[0_2px_8px_rgb(0_0_0/0.25),0_0_0_1px_rgb(255_255_255/0.05)_inset]";

const divider = <div className="h-px bg-maestro-border/30 my-1" />;

const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 320;
const SIDEBAR_COLLAPSE_THRESHOLD = 60;
const SIDEBAR_WIDTH_STEP = 4;

const STATUS_DOT_CLASS: Record<BackendSessionStatus, string> = {
  Starting: "bg-maestro-orange",
  Idle: "bg-maestro-muted",
  Working: "bg-maestro-accent",
  NeedsInput: "bg-maestro-yellow",
  Done: "bg-maestro-green",
  Error: "bg-maestro-red",
};

const STATUS_LABEL: Record<BackendSessionStatus, string> = {
  Starting: "Starting",
  Idle: "Idle",
  Working: "Working",
  NeedsInput: "Needs Input",
  Done: "Done",
  Error: "Error",
};

/* ================================================================ */
/*  SIDEBAR ROOT                                                     */
/* ================================================================ */

export function Sidebar({ collapsed, onCollapse, theme, onToggleTheme }: SidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>("config");
  const [width, setWidth] = useState(240);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; w: number } | null>(null);
  const sidebarWidthClass = collapsed ? "w-0" : `sidebar-w-${width}`;

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX, w: width };
    },
    [width],
  );

  const clampWidth = useCallback((value: number) => {
    const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value));
    const snapped = Math.round(clamped / SIDEBAR_WIDTH_STEP) * SIDEBAR_WIDTH_STEP;
    return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, snapped));
  }, []);

  const handleResizeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let next = width;
      const smallStep = 8;
      const largeStep = 24;

      switch (e.key) {
        case "ArrowLeft":
          next = width - smallStep;
          break;
        case "ArrowRight":
          next = width + smallStep;
          break;
        case "PageDown":
          next = width - largeStep;
          break;
        case "PageUp":
          next = width + largeStep;
          break;
        case "Home":
          next = SIDEBAR_MIN_WIDTH;
          break;
        case "End":
          next = SIDEBAR_MAX_WIDTH;
          break;
        default:
          return;
      }

      e.preventDefault();
      if (next < SIDEBAR_COLLAPSE_THRESHOLD) {
        onCollapse?.();
        return;
      }
      setWidth(clampWidth(next));
    },
    [width, onCollapse, clampWidth],
  );

  useEffect(() => {
    if (!isDragging) return;

    const onMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const raw = dragStartRef.current.w + (e.clientX - dragStartRef.current.x);
      if (raw < SIDEBAR_COLLAPSE_THRESHOLD) {
        setIsDragging(false);
        onCollapse?.();
        return;
      }
      setWidth(clampWidth(raw));
    };

    const onUp = () => setIsDragging(false);

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isDragging, onCollapse, clampWidth]);

  return (
    // Use a class-based width to avoid inline styles (CSP-friendly).
    <aside
      className={`theme-transition no-select relative flex h-full flex-col border-r border-maestro-border bg-maestro-surface ${sidebarWidthClass} ${
        isDragging ? "" : "transition-all duration-200 ease-out"
      } ${collapsed ? "overflow-hidden border-r-0 opacity-0" : "opacity-100"}`}
    >
      {/* Tab switcher */}
      <div className="flex shrink-0 border-b border-maestro-border">
        <button
          type="button"
          onClick={() => setActiveTab("config")}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold tracking-wide uppercase ${
            activeTab === "config"
              ? "border-b-2 border-maestro-accent text-maestro-accent"
              : "text-maestro-muted hover:text-maestro-text"
          }`}
        >
          <Settings size={12} />
          Config
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("processes")}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold tracking-wide uppercase ${
            activeTab === "processes"
              ? "border-b-2 border-maestro-accent text-maestro-accent"
              : "text-maestro-muted hover:text-maestro-text"
          }`}
        >
          <Activity size={12} />
          Processes
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3">
        {activeTab === "config" ? (
          <ConfigTab theme={theme} onToggleTheme={onToggleTheme} />
        ) : (
          <ProcessesTab />
        )}
      </div>

      {/* Drag handle */}
      {!collapsed && (
        // biome-ignore lint/a11y/useSemanticElements: Vertical resizer requires interactive div for pointer/keyboard handling.
        <div
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={Math.round(width)}
          aria-valuetext={`${Math.round(width)} pixels`}
          tabIndex={0}
          aria-label="Resize sidebar"
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-maestro-accent/30 active:bg-maestro-accent/40"
          onMouseDown={handleDragStart}
          onKeyDown={handleResizeKeyDown}
        />
      )}
    </aside>
  );
}

/* ================================================================ */
/*  SECTION HEADER (reusable)                                        */
/* ================================================================ */

function SectionHeader({
  icon: Icon,
  label,
  breathe = false,
  iconColor,
  badge,
  right,
}: {
  icon: React.ElementType;
  label: string;
  breathe?: boolean;
  iconColor?: string;
  badge?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-maestro-muted">
      <Icon
        size={13}
        className={`${iconColor ?? "text-maestro-muted/80"} ${breathe ? "animate-breathe" : ""}`}
      />
      <span className="flex-1">{label}</span>
      {badge}
      {right}
    </div>
  );
}

/* ================================================================ */
/*  CONFIG TAB                                                       */
/* ================================================================ */

function ConfigTab({
  theme,
  onToggleTheme,
}: {
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
}) {
  return (
    <>
      <GitRepositorySection />
      {divider}
      <ProjectContextSection />
      {divider}
      <SessionsSection />
      {divider}
      <StatusSection />
      {divider}
      <MaestroMCPSection />
      {divider}
      <MCPServersSection />
      {divider}
      <PluginsSection />
      {divider}
      <QuickActionsSection />
      {divider}
      <AppearanceSection theme={theme} onToggle={onToggleTheme} />
    </>
  );
}

/* ── 1. Git Repository ── */

function GitRepositorySection() {
  const [showSettings, setShowSettings] = useState(false);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.active);
  const repoPath = activeTab?.projectPath ?? "";

  const { userConfig, remotes, remoteStatuses, fetchUserConfig, fetchRemotes, testAllRemotes } =
    useGitStore();

  // Fetch data on mount and when repoPath changes
  useEffect(() => {
    if (!repoPath) return;
    fetchUserConfig(repoPath);
    fetchRemotes(repoPath);
  }, [repoPath, fetchUserConfig, fetchRemotes]);

  // Test remotes after fetching them
  useEffect(() => {
    if (!repoPath || remotes.length === 0) return;
    // Only test if we don't have statuses yet
    const hasStatuses = remotes.some((r) => remoteStatuses[r.name] !== undefined);
    if (!hasStatuses) {
      testAllRemotes(repoPath);
    }
  }, [repoPath, remotes, remoteStatuses, testAllRemotes]);

  const hasUser = userConfig?.name || userConfig?.email;
  const displayName = userConfig?.name || "Not configured";
  const displayEmail = userConfig?.email || "No email set";

  // Format remote URL for display (shorten GitHub URLs)
  const formatRemoteUrl = (url: string) => {
    // git@github.com:user/repo.git -> github.com/user/repo
    // https://github.com/user/repo.git -> github.com/user/repo
    const match = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (match) {
      return `github.com/${match[1]}`;
    }
    // For other URLs, just show the host/path
    try {
      const parsed = new URL(url.replace(/^git@/, "https://").replace(/:(?!\/\/)/, "/"));
      return `${parsed.host}${parsed.pathname.replace(/\.git$/, "")}`;
    } catch {
      return url;
    }
  };

  if (!repoPath) {
    return (
      <div className={cardClass}>
        <SectionHeader
          icon={GitBranch}
          label="Git Repository"
          iconColor="text-maestro-muted"
        />
        <div className="px-1 py-1 text-xs text-maestro-muted">No project selected</div>
      </div>
    );
  }

  return (
    <>
      <div className={cardClass}>
        <SectionHeader
          icon={GitBranch}
          label="Git Repository"
          iconColor="text-maestro-green"
          right={
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="rounded p-0.5 hover:bg-maestro-border/40"
              title="Git settings"
            >
              <Settings size={12} className="text-maestro-muted" />
            </button>
          }
        />
        {/* User */}
        <div className="flex items-center gap-2 px-1 py-1">
          <User size={12} className={hasUser ? "text-maestro-green" : "text-maestro-muted"} />
          <span className="text-xs font-semibold text-maestro-text truncate">{displayName}</span>
        </div>
        <div className="pl-5 text-[11px] text-maestro-muted truncate">{displayEmail}</div>

        {/* Remotes */}
        {remotes.length === 0 ? (
          <div className="mt-2 px-1 py-1 text-xs text-maestro-muted">No remotes configured</div>
        ) : (
          remotes.map((remote) => (
            <div key={remote.name} className="mt-1">
              <div className="flex items-center gap-2 px-1 py-1">
                <RemoteStatusIndicator status={remoteStatuses[remote.name] ?? "unknown"} />
                <span className="text-xs font-semibold text-maestro-text truncate">
                  {remote.name}
                </span>
              </div>
              <div className="pl-5 text-[11px] text-maestro-muted truncate">
                {formatRemoteUrl(remote.url)}
              </div>
            </div>
          ))
        )}
      </div>

      {showSettings && (
        <GitSettingsModal repoPath={repoPath} onClose={() => setShowSettings(false)} />
      )}
    </>
  );
}

/* ── 2. Project Context ── */

function ProjectContextSection() {
  return (
    <div className={cardClass}>
      <SectionHeader
        icon={FileText}
        label="Project Context"
        iconColor="text-maestro-orange"
        right={
          <button type="button" className="rounded p-0.5 hover:bg-maestro-border/40">
            <RefreshCw size={12} className="text-maestro-muted" />
          </button>
        }
      />
      <div className="flex items-center gap-2 px-1 py-1">
        <AlertTriangle size={13} className="text-maestro-orange shrink-0" />
        <span className="text-xs text-maestro-text">No CLAUDE.md</span>
      </div>
      <div className="pl-7 text-[11px] text-maestro-muted">
        Click to create project context file
      </div>
    </div>
  );
}

/* ── 3. Sessions ── */

function SessionsSection() {
  const [expanded, setExpanded] = useState(true);
  const allSessions = useSessionStore((s) => s.sessions);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.active);
  const activeProjectPath = activeTab?.projectPath ?? "";

  // Filter sessions to only show those belonging to the active project
  const sessions = allSessions.filter((s) => s.project_path === activeProjectPath);

  return (
    <div className={cardClass}>
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-maestro-muted">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 hover:text-maestro-text"
        >
          {expanded ? (
            <ChevronDown size={13} className="text-maestro-muted/80" />
          ) : (
            <ChevronRight size={13} className="text-maestro-muted/80" />
          )}
        </button>
        <Bot size={13} className="text-maestro-accent animate-breathe" />
        <span className="flex-1">Sessions</span>
        <span className="bg-maestro-accent/20 text-maestro-accent text-[10px] px-1.5 rounded-full font-bold">
          {sessions.length}
        </span>
      </div>

      {expanded && (
        <div className="space-y-0.5">
          {sessions.length === 0 ? (
            <div className="px-2 py-1 text-[11px] text-maestro-muted/60">No sessions yet</div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                title={s.statusMessage || s.needsInputPrompt || STATUS_LABEL[s.status]}
                className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-maestro-text hover:bg-maestro-border/40"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT_CLASS[s.status]}`} />
                <Bot size={12} className="text-maestro-purple shrink-0" />
                <span className="flex-1 font-medium">#{s.id}</span>
                <span className="text-[10px] text-maestro-muted">{STATUS_LABEL[s.status]}</span>
                <ChevronDown size={12} className="text-maestro-muted" />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ── 4. Status ── */

const AI_MODES: AiMode[] = ["Claude", "Gemini", "Codex", "Plain"];
const SESSION_STATUSES: BackendSessionStatus[] = [
  "Starting",
  "Idle",
  "Working",
  "NeedsInput",
  "Done",
  "Error",
];

const MODE_ICON: Record<AiMode, React.ElementType> = {
  Claude: Bot,
  Gemini: Sparkles,
  Codex: Cpu,
  Plain: Globe,
};

function StatusSection() {
  const allSessions = useSessionStore((s) => s.sessions);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.active);
  const activeProjectPath = activeTab?.projectPath ?? "";

  // Filter sessions to only count those belonging to the active project
  const sessions = allSessions.filter((s) => s.project_path === activeProjectPath);
  const counts = sessions.reduce(
    (acc, session) => {
      acc.status[session.status] = (acc.status[session.status] ?? 0) + 1;
      acc.mode[session.mode] = (acc.mode[session.mode] ?? 0) + 1;
      return acc;
    },
    {
      status: {
        Starting: 0,
        Idle: 0,
        Working: 0,
        NeedsInput: 0,
        Done: 0,
        Error: 0,
      } as Record<BackendSessionStatus, number>,
      mode: {
        Claude: 0,
        Gemini: 0,
        Codex: 0,
        Plain: 0,
      } as Record<AiMode, number>,
    },
  );

  return (
    <div className={cardClass}>
      <SectionHeader icon={Activity} label="Status" iconColor="text-maestro-accent" />
      <div className="space-y-0.5">
        {/* AI mode buckets - only show modes with count > 0 */}
        {AI_MODES.filter((mode) => counts.mode[mode] > 0).map((mode) => {
          const ModeIcon = MODE_ICON[mode];
          return (
            <div
              key={mode}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-maestro-text"
            >
              <ModeIcon size={12} className="text-maestro-purple shrink-0" />
              <span className="flex-1">{mode}:</span>
              <span className="font-semibold text-maestro-text">{counts.mode[mode]}</span>
            </div>
          );
        })}
        {/* Divider between types and states - only show if both sections have items */}
        {AI_MODES.some((mode) => counts.mode[mode] > 0) &&
          SESSION_STATUSES.some((st) => counts.status[st] > 0) && (
            <div className="h-px bg-maestro-border/40 my-1.5" />
          )}
        {/* Session status buckets - only show statuses with count > 0 */}
        {SESSION_STATUSES.filter((st) => counts.status[st] > 0).map((st) => (
          <div
            key={st}
            className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-maestro-text"
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT_CLASS[st]}`} />
            <span className="flex-1">{STATUS_LABEL[st]}:</span>
            <span className="font-semibold text-maestro-text">{counts.status[st]}</span>
          </div>
        ))}
        {/* Empty state when no sessions */}
        {!AI_MODES.some((mode) => counts.mode[mode] > 0) &&
          !SESSION_STATUSES.some((st) => counts.status[st] > 0) && (
            <div className="px-2 py-1 text-[11px] text-maestro-muted/60">No active sessions</div>
          )}
      </div>
    </div>
  );
}

/* ── 5. Maestro MCP ── */

function MaestroMCPSection() {
  return (
    <div className={cardClass}>
      <SectionHeader
        icon={Server}
        label="Maestro MCP"
        iconColor="text-maestro-green"
        right={
          <button type="button" className="rounded p-0.5 hover:bg-maestro-border/40">
            <RefreshCw size={12} className="text-maestro-muted" />
          </button>
        }
      />
      <div className="flex items-center gap-2 px-1 py-1">
        <span className="h-2 w-2 shrink-0 rounded-full bg-maestro-green" />
        <span className="text-xs text-maestro-text font-medium">Available</span>
      </div>
      <div className="pl-5 text-[10px] text-maestro-muted truncate">
        /usr/lib/maestro...MCPServer
      </div>
    </div>
  );
}

/* ── 6. MCP Servers ── */

function MCPServersSection() {
  const [expanded, setExpanded] = useState(false);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.active);
  const projectPath = activeTab?.projectPath ?? "";

  const { projectServers, fetchProjectServers, refreshProjectServers, isLoading } = useMcpStore();
  // Filter out the internal "maestro" server - it's shown in the dedicated Maestro MCP section
  const servers = projectPath
    ? (projectServers[projectPath] ?? []).filter((s) => s.name !== "maestro")
    : [];
  const loading = projectPath ? (isLoading[projectPath] ?? false) : false;

  // Fetch servers when project changes
  useEffect(() => {
    if (projectPath) {
      fetchProjectServers(projectPath);
    }
  }, [projectPath, fetchProjectServers]);

  const handleRefresh = useCallback(() => {
    if (projectPath) {
      refreshProjectServers(projectPath);
    }
  }, [projectPath, refreshProjectServers]);

  return (
    <div className={cardClass}>
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-maestro-muted">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 hover:text-maestro-text"
        >
          {expanded ? (
            <ChevronDown size={13} className="text-maestro-muted/80" />
          ) : (
            <ChevronRight size={13} className="text-maestro-muted/80" />
          )}
        </button>
        <Server size={13} className={servers.length > 0 ? "text-maestro-green" : "text-maestro-muted/80"} />
        <span className="flex-1">MCP Servers</span>
        {servers.length > 0 && (
          <span className="bg-maestro-green/20 text-maestro-green text-[10px] px-1.5 rounded-full font-bold">
            {servers.length}
          </span>
        )}
        <button
          type="button"
          onClick={handleRefresh}
          className="rounded p-0.5 hover:bg-maestro-border/40"
          title="Refresh MCP servers"
        >
          <RefreshCw size={12} className={`text-maestro-muted ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {expanded && (
        <div className="space-y-0.5">
          {!projectPath ? (
            <div className="px-2 py-1 text-[11px] text-maestro-muted/60">No project selected</div>
          ) : servers.length === 0 ? (
            <div className="px-2 py-1 text-[11px] text-maestro-muted/60">
              No MCP servers in .mcp.json
            </div>
          ) : (
            servers.map((server) => {
              const serverType = server.type;
              const isHttp = serverType === "http";
              return (
                <div
                  key={server.name}
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-maestro-text hover:bg-maestro-border/40"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full bg-maestro-green" />
                  <span className="flex-1 truncate font-medium">{server.name}</span>
                  <span className="text-[10px] text-maestro-muted">
                    {isHttp ? "HTTP" : "stdio"}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/* ── 7. Plugins & Skills ── */

import type { SkillSource } from "@/lib/plugins";

/** Returns badge styling and text for a skill source. */
function getSkillSourceBadge(source: SkillSource): { text: string; className: string; icon: React.ElementType } {
  switch (source.type) {
    case "project":
      return {
        text: "Project",
        className: "bg-maestro-accent/20 text-maestro-accent",
        icon: FileText,
      };
    case "personal":
      return {
        text: "Personal",
        className: "bg-maestro-green/20 text-maestro-green",
        icon: Home,
      };
    case "plugin":
      return {
        text: source.name,
        className: "bg-maestro-purple/20 text-maestro-purple",
        icon: Package,
      };
    case "legacy":
      return {
        text: "Legacy",
        className: "bg-maestro-muted/20 text-maestro-muted",
        icon: FileText,
      };
  }
}

function PluginsSection() {
  const [expanded, setExpanded] = useState(false);
  const [expandedPlugins, setExpandedPlugins] = useState<Set<string>>(new Set());
  const [showMarketplace, setShowMarketplace] = useState(false);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.active);
  const projectPath = activeTab?.projectPath ?? "";

  const { projectSkills, projectPlugins, fetchProjectPlugins, refreshProjectPlugins, isLoading } =
    usePluginStore();
  const skills = projectPath ? (projectSkills[projectPath] ?? []) : [];
  const plugins = projectPath ? (projectPlugins[projectPath] ?? []) : [];
  const loading = projectPath ? (isLoading[projectPath] ?? false) : false;

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

  // Total count = plugins + standalone skills
  const totalCount = plugins.length + standaloneSkills.length;

  const togglePlugin = (pluginId: string) => {
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

  // Fetch plugins when project changes
  useEffect(() => {
    if (projectPath) {
      fetchProjectPlugins(projectPath);
    }
  }, [projectPath, fetchProjectPlugins]);

  const handleRefresh = useCallback(() => {
    if (projectPath) {
      refreshProjectPlugins(projectPath);
    }
  }, [projectPath, refreshProjectPlugins]);

  return (
    <div className={cardClass}>
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-maestro-muted">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 hover:text-maestro-text"
        >
          {expanded ? (
            <ChevronDown size={13} className="text-maestro-muted/80" />
          ) : (
            <ChevronRight size={13} className="text-maestro-muted/80" />
          )}
        </button>
        <Store size={13} className={totalCount > 0 ? "text-maestro-purple" : "text-maestro-muted/80"} />
        <span className="flex-1">Plugins & Skills</span>
        {totalCount > 0 && (
          <span className="bg-maestro-purple/20 text-maestro-purple text-[10px] px-1.5 rounded-full font-bold">
            {totalCount}
          </span>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleRefresh}
            className="rounded p-0.5 hover:bg-maestro-border/40"
            title="Refresh plugins"
          >
            <RefreshCw size={12} className={`text-maestro-muted ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => setShowMarketplace(true)}
            className="rounded p-0.5 hover:bg-maestro-border/40"
            title="Add plugin"
          >
            <PlusCircle size={12} className="text-maestro-accent" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-0.5">
          {!projectPath ? (
            <div className="px-2 py-1 text-[11px] text-maestro-muted/60">No project selected</div>
          ) : totalCount === 0 ? (
            <>
              <div className="px-2 py-1 text-[11px] text-maestro-muted/60">
                No skills found
              </div>
              <div className="px-2 text-[10px] text-maestro-muted/40">
                Add skills to .claude/skills/ or ~/.claude/skills/
              </div>
            </>
          ) : (
            <>
              {/* Plugins with their skills */}
              {plugins.length > 0 && (
                <>
                  <div className="px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-maestro-muted/60">
                    Plugins ({plugins.length})
                  </div>
                  {plugins.map((plugin) => {
                    const pluginSkills = pluginSkillsMap.get(plugin.name) ?? [];
                    const isPluginExpanded = expandedPlugins.has(plugin.id);

                    return (
                      <div key={plugin.id}>
                        {/* Plugin row - clickable to expand */}
                        <button
                          type="button"
                          onClick={() => togglePlugin(plugin.id)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs text-maestro-text hover:bg-maestro-border/40"
                          title={plugin.description || plugin.path || undefined}
                        >
                          {pluginSkills.length > 0 ? (
                            isPluginExpanded ? (
                              <ChevronDown size={10} className="shrink-0 text-maestro-muted" />
                            ) : (
                              <ChevronRight size={10} className="shrink-0 text-maestro-muted" />
                            )
                          ) : (
                            <span className="w-[10px]" />
                          )}
                          <Package size={12} className="shrink-0 text-maestro-purple" />
                          <span className="flex-1 truncate font-medium text-left">{plugin.name}</span>
                          {pluginSkills.length > 0 && (
                            <span className="text-[10px] text-maestro-muted">{pluginSkills.length}</span>
                          )}
                          <span className="text-[10px] text-maestro-muted">v{plugin.version}</span>
                        </button>

                        {/* Expanded skills */}
                        {isPluginExpanded && pluginSkills.length > 0 && (
                          <div className="ml-4 border-l border-maestro-border/40 pl-2">
                            {pluginSkills.map((skill) => (
                              <div
                                key={skill.id}
                                className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-maestro-text hover:bg-maestro-border/40"
                                title={skill.description || skill.path || undefined}
                              >
                                <Zap size={11} className="shrink-0 text-maestro-orange" />
                                <span className="flex-1 truncate">{skill.name}</span>
                              </div>
                            ))}
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
                  <div className="px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-maestro-muted/60">
                    Skills ({standaloneSkills.length})
                  </div>
                  {standaloneSkills.map((skill) => {
                    const badge = getSkillSourceBadge(skill.source);
                    return (
                      <div
                        key={skill.id}
                        className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-maestro-text hover:bg-maestro-border/40"
                        title={skill.description || skill.path || undefined}
                      >
                        <Zap size={12} className="shrink-0 text-maestro-orange" />
                        <span className="flex-1 truncate font-medium">{skill.name}</span>
                        <span className={`shrink-0 rounded px-1 text-[9px] ${badge.className}`}>
                          {badge.text}
                        </span>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Marketplace Browser Modal */}
      {showMarketplace && (
        <MarketplaceBrowser
          onClose={() => setShowMarketplace(false)}
          currentProjectPath={projectPath}
        />
      )}
    </div>
  );
}

/* ── 8. Quick Actions ── */

function QuickActionsSection() {
  const [showManager, setShowManager] = useState(false);

  const actions = [
    { label: "Run App", icon: Play, color: "text-maestro-green" },
    { label: "Commit & Push", icon: Circle, color: "text-maestro-accent" },
    { label: "Fix Errors", icon: AlertTriangle, color: "text-maestro-orange" },
    { label: "Lint & Format", icon: Wrench, color: "text-maestro-purple" },
  ];

  return (
    <>
      <div className={cardClass}>
        <SectionHeader
          icon={Zap}
          label="Quick Actions"
          iconColor="text-maestro-orange"
          breathe
          right={
            <div className="flex items-center gap-1">
              <span className="h-2 w-2 shrink-0 rounded-full bg-maestro-yellow" />
              <button
                type="button"
                className="rounded p-0.5 hover:bg-maestro-border/40"
                onClick={() => setShowManager(true)}
                title="Manage Quick Actions"
              >
                <Settings size={12} className="text-maestro-muted" />
              </button>
            </div>
          }
        />
        <div className="space-y-0.5">
          {actions.map((a) => (
            <button
              type="button"
              key={a.label}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs text-maestro-text transition-colors hover:bg-maestro-border/40"
            >
              <a.icon size={14} className={a.color} />
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      {showManager && (
        <QuickActionsManager onClose={() => setShowManager(false)} />
      )}
    </>
  );
}

/* ── 9. Appearance ── */

function AppearanceSection({
  theme,
  onToggle,
}: {
  theme?: "dark" | "light";
  onToggle?: () => void;
}) {
  const isDark = theme !== "light";

  return (
    <div className={cardClass}>
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-maestro-muted">
        {isDark ? <Moon size={13} /> : <Sun size={13} />}
        Appearance
      </div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs text-maestro-text transition-colors hover:bg-maestro-border/40"
      >
        {isDark ? (
          <Sun size={14} className="text-maestro-orange" />
        ) : (
          <Moon size={14} className="text-maestro-accent" />
        )}
        <span>{isDark ? "Switch to Light" : "Switch to Dark"}</span>
      </button>
    </div>
  );
}

/* ================================================================ */
/*  PROCESSES TAB                                                    */
/* ================================================================ */

function ProcessesTab() {
  return (
    <>
      <AgentSessionsSection />
      {divider}
      <ProcessTreeSection />
      {divider}
      <OrphanedProcessesSection />
    </>
  );
}

/* ── 1. Agent Sessions ── */

function AgentSessionsSection() {
  const allSessions = useSessionStore((s) => s.sessions);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.active);
  const activeProjectPath = activeTab?.projectPath ?? "";

  // Filter sessions to only show those belonging to the active project
  const sessions = allSessions.filter((s) => s.project_path === activeProjectPath);

  return (
    <div className={cardClass}>
      <SectionHeader
        icon={Cpu}
        label="Agent Sessions"
        iconColor="text-maestro-accent"
        breathe
        badge={
          <span className="bg-maestro-accent/20 text-maestro-accent text-[10px] px-1.5 rounded-full font-bold">
            {sessions.length}
          </span>
        }
      />
      <div className="space-y-0.5">
        {sessions.length === 0 ? (
          <div className="px-2 py-1 text-[11px] text-maestro-muted/60">No active agents</div>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-maestro-text hover:bg-maestro-border/40"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT_CLASS[s.status]}`} />
              <span className="flex-1 truncate">
                <span className="font-medium">#{s.id}</span>{" "}
                <span className="text-maestro-muted">{s.mode}</span>{" "}
                <span className="text-maestro-muted">-</span>{" "}
                <span className="text-maestro-muted">{STATUS_LABEL[s.status]}</span>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ── 2. Process Tree ── */

function ProcessTreeSection() {
  const [expanded, setExpanded] = useState(true);
  const [expandedSessions, setExpandedSessions] = useState<Set<number>>(new Set());

  const { trees, isLoading, fetchAllTrees, killProcess } = useProcessTreeStore();
  const allSessions = useSessionStore((s) => s.sessions);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.active);
  const activeProjectPath = activeTab?.projectPath ?? "";

  // Filter sessions to only show those belonging to the active project
  const projectSessions = allSessions.filter((s) => s.project_path === activeProjectPath);
  const projectSessionIds = new Set(projectSessions.map((s) => s.id));

  // Filter trees to only show those for the active project's sessions
  const projectTrees = trees.filter((t) => projectSessionIds.has(t.sessionId));

  // Total process count across all trees
  const totalProcesses = projectTrees.reduce((sum, t) => sum + t.processes.length, 0);

  // Fetch trees on mount and when sessions change
  useEffect(() => {
    if (projectSessions.length > 0) {
      fetchAllTrees();
    }
  }, [projectSessions.length, fetchAllTrees]);

  const handleRefresh = useCallback(() => {
    fetchAllTrees();
  }, [fetchAllTrees]);

  const toggleSession = (sessionId: number) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  // Build hierarchical tree for a session
  const buildProcessHierarchy = (tree: SessionProcessTree) => {
    const processMap = new Map<number, ProcessInfo>();
    const childrenMap = new Map<number, ProcessInfo[]>();

    for (const proc of tree.processes) {
      processMap.set(proc.pid, proc);
      if (proc.parentPid !== null) {
        const children = childrenMap.get(proc.parentPid) ?? [];
        children.push(proc);
        childrenMap.set(proc.parentPid, children);
      }
    }

    return { processMap, childrenMap, rootPid: tree.rootPid };
  };

  // Recursive process node renderer
  const ProcessNode = ({
    process,
    childrenMap,
    depth,
    isRoot,
  }: {
    process: ProcessInfo;
    childrenMap: Map<number, ProcessInfo[]>;
    depth: number;
    isRoot: boolean;
  }) => {
    const [nodeExpanded, setNodeExpanded] = useState(depth < 2);
    const [isKilling, setIsKilling] = useState(false);
    const children = childrenMap.get(process.pid) ?? [];
    const hasChildren = children.length > 0;

    // Format memory for display
    const formatMemory = (bytes: number) => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const handleKill = async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isRoot || isKilling) return;

      setIsKilling(true);
      await killProcess(process.pid);
      setIsKilling(false);
    };

    return (
      <div className={depth > 0 ? "ml-3 border-l border-maestro-border/40 pl-2" : ""}>
        <div className="group flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] text-maestro-text hover:bg-maestro-border/40">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setNodeExpanded(!nodeExpanded)}
              className="shrink-0 p-0.5 hover:bg-maestro-border/40 rounded"
            >
              {nodeExpanded ? (
                <ChevronDown size={10} className="text-maestro-muted" />
              ) : (
                <ChevronRight size={10} className="text-maestro-muted" />
              )}
            </button>
          ) : (
            <span className="w-[18px]" />
          )}
          <Cpu size={10} className="shrink-0 text-maestro-accent" />
          <span className="flex-1 truncate font-medium">{process.name}</span>
          <span className="shrink-0 text-[9px] text-maestro-muted">{process.pid}</span>
          <span className="shrink-0 text-[9px] text-maestro-muted/60">
            {formatMemory(process.memoryBytes)}
          </span>
          {/* Kill button - only for non-root processes */}
          {!isRoot && (
            <button
              type="button"
              onClick={handleKill}
              disabled={isKilling}
              className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-maestro-red/20 transition-opacity"
              title={`Kill process ${process.pid}`}
            >
              <X size={10} className={isKilling ? "text-maestro-muted animate-pulse" : "text-maestro-red"} />
            </button>
          )}
        </div>
        {nodeExpanded &&
          children.map((child) => (
            <ProcessNode
              key={child.pid}
              process={child}
              childrenMap={childrenMap}
              depth={depth + 1}
              isRoot={false}
            />
          ))}
      </div>
    );
  };

  return (
    <div className={cardClass}>
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-maestro-muted">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 hover:text-maestro-text"
        >
          {expanded ? (
            <ChevronDown size={13} className="text-maestro-muted/80" />
          ) : (
            <ChevronRight size={13} className="text-maestro-muted/80" />
          )}
        </button>
        <Globe size={13} className={totalProcesses > 0 ? "text-maestro-green" : "text-maestro-muted/80"} />
        <span className="flex-1">Process Tree</span>
        {totalProcesses > 0 && (
          <span className="bg-maestro-green/20 text-maestro-green text-[10px] px-1.5 rounded-full font-bold">
            {totalProcesses}
          </span>
        )}
        <button
          type="button"
          onClick={handleRefresh}
          className="rounded p-0.5 hover:bg-maestro-border/40"
          title="Refresh process tree"
        >
          <RefreshCw size={12} className={`text-maestro-muted ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {expanded && (
        <div className="space-y-1">
          {projectTrees.length === 0 ? (
            <div className="px-2 py-1 text-[11px] text-maestro-muted/60">
              {projectSessions.length === 0 ? "No active sessions" : "No running processes"}
            </div>
          ) : (
            projectTrees.map((tree) => {
              const session = projectSessions.find((s) => s.id === tree.sessionId);
              const isSessionExpanded = expandedSessions.has(tree.sessionId);
              const { childrenMap, rootPid } = buildProcessHierarchy(tree);
              const rootProcess = tree.processes.find((p) => p.pid === rootPid);

              return (
                <div key={tree.sessionId}>
                  {/* Session header */}
                  <button
                    type="button"
                    onClick={() => toggleSession(tree.sessionId)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs text-maestro-text hover:bg-maestro-border/40"
                  >
                    {isSessionExpanded ? (
                      <ChevronDown size={10} className="shrink-0 text-maestro-muted" />
                    ) : (
                      <ChevronRight size={10} className="shrink-0 text-maestro-muted" />
                    )}
                    <Bot size={12} className="shrink-0 text-maestro-purple" />
                    <span className="flex-1 text-left font-medium">
                      Session #{tree.sessionId}
                      {session && (
                        <span className="ml-1 text-maestro-muted font-normal">
                          ({session.mode})
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] text-maestro-muted">
                      {tree.processes.length} proc{tree.processes.length !== 1 && "s"}
                    </span>
                  </button>

                  {/* Expanded process tree */}
                  {isSessionExpanded && rootProcess && (
                    <div className="ml-4 mt-1">
                      <ProcessNode
                        process={rootProcess}
                        childrenMap={childrenMap}
                        depth={0}
                        isRoot={true}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/* ── 3. Orphaned Processes ── */

function OrphanedProcessesSection() {
  return (
    <div className={cardClass}>
      <SectionHeader
        icon={Skull}
        label="Orphaned Processes"
        iconColor="text-maestro-red"
        right={
          <button type="button" className="rounded p-0.5 hover:bg-maestro-border/40">
            <RefreshCw size={12} className="text-maestro-muted" />
          </button>
        }
      />
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="h-2 w-2 shrink-0 rounded-full bg-maestro-green" />
        <span className="text-[11px] text-maestro-muted/60">No orphaned processes</span>
      </div>
    </div>
  );
}
