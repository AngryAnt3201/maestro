import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";

import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";

import { getBranchesWithWorktreeStatus, type BranchWithWorktreeStatus } from "@/lib/git";
import { removeSessionMcpConfig, removeOpenCodeMcpConfig, setSessionMcpServers, writeSessionMcpConfig, writeOpenCodeMcpConfig, type McpServerConfig } from "@/lib/mcp";
import {
  loadBranchConfig,
  removeSessionPluginConfig,
  saveBranchConfig,
  setSessionPlugins,
  setSessionSkills,
  writeSessionPluginConfig,
  type PluginConfig,
  type SkillConfig,
} from "@/lib/plugins";
import {
  AI_CLI_CONFIG,
  assignSessionBranch,
  buildCliCommand,
  checkCliAvailable,
  createSession,
  killSession,
  removeSessionHooksConfig,
  spawnShell,
  waitForTerminalReady,
  writeSessionHooksConfig,
  writeStdin,
} from "@/lib/terminal";
import { checkFullDiskAccess, pathRequiresFDA } from "@/lib/permissions";
import { useFDAStore } from "@/stores/useFDAStore";
import { useCliSettingsStore } from "@/stores/useCliSettingsStore";
import { cleanupSessionWorktree, prepareSessionWorktree } from "@/lib/worktreeManager";
import { useTerminalKeyboard } from "@/hooks/useTerminalKeyboard";
import { useMcpStore } from "@/stores/useMcpStore";
import { usePluginStore } from "@/stores/usePluginStore";
import { useSessionStore } from "@/stores/useSessionStore";
import type { AiMode } from "@/stores/useSessionStore";
import { useTemplateStore } from "@/stores/useTemplateStore";
import { useWorkspaceStore, type RepositoryInfo, type WorkspaceType } from "@/stores/useWorkspaceStore";
import { PreLaunchCard, type SessionSlot } from "./PreLaunchCard";
import { SplitPaneView } from "./SplitPaneView";
import { createLeaf, splitLeaf, removeLeaf, updateRatio, collectSlotIds, findSiblingSlotId, buildGridTree, swapLeaves, type TreeNode, type SplitDirection } from "./splitTree";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { TerminalView } from "./TerminalView";

/** Stable empty arrays to avoid infinite re-render loops in Zustand selectors. */
const EMPTY_MCP_SERVERS: McpServerConfig[] = [];
const EMPTY_SKILLS: SkillConfig[] = [];
const EMPTY_PLUGINS: PluginConfig[] = [];

/** Hard ceiling on concurrent PTY sessions per grid to bound resource usage. */
const MAX_SESSIONS = 6;

/**
 * Launch mutex to serialize session launches within the same project.
 * This prevents race conditions where multiple sessions share the same .mcp.json file.
 * Without worktrees, sessions can overwrite each other's MCP config before Claude CLI reads it.
 */
const projectLaunchLocks = new Map<string, Promise<void>>();

async function withProjectLock<T>(projectPath: string, fn: () => Promise<T>): Promise<T> {
  // Wait for any pending launches to complete.
  // Use a while loop because multiple waiters may wake up when a lock resolves.
  // After waking, we must re-check if another waiter grabbed the lock first.
  while (projectLaunchLocks.has(projectPath)) {
    await projectLaunchLocks.get(projectPath);
  }

  // Now we're guaranteed to be the only one proceeding
  let resolve: () => void;
  const newLock = new Promise<void>((r) => {
    resolve = r;
  });
  projectLaunchLocks.set(projectPath, newLock);

  try {
    return await fn();
  } finally {
    resolve!();
    if (projectLaunchLocks.get(projectPath) === newLock) {
      projectLaunchLocks.delete(projectPath);
    }
  }
}

/** Generates a unique ID for a new session slot. */
function generateSlotId(): string {
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Creates a new empty session slot with default configuration. */
function createEmptySlot(
  mcpServers: McpServerConfig[] = [],
  skills: SkillConfig[] = [],
  plugins: PluginConfig[] = []
): SessionSlot {
  return {
    id: generateSlotId(),
    mode: "Claude",
    branch: null,
    sessionId: null,
    worktreePath: null,
    worktreeWarning: null,
    enabledMcpServers: mcpServers.map((s) => s.name), // All enabled by default
    enabledSkills: skills.map((s) => s.id), // All enabled by default
    enabledPlugins: plugins.filter((p) => p.enabled_by_default).map((p) => p.id),
  };
}

/**
 * Imperative handle exposed via `useImperativeHandle` so parent components
 * (e.g. a toolbar button) can add sessions or launch all without lifting state up.
 */
export interface TerminalGridHandle {
  addSession: () => void;
  addSessionWithConfig: (branch: string, worktreePath: string) => void;
  launchAll: () => Promise<void>;
  refreshBranches: () => void;
  focusSession: (sessionId: number) => void;
}

/**
 * @property projectPath - Working directory passed to `spawnShell`; when absent the backend
 *   uses its own default cwd.
 * @property repoPath - Git repository path for branch/worktree operations. Defaults to projectPath.
 *   For multi-repo workspaces, this is the selected repository path.
 * @property repositories - List of all repositories in the workspace (for multi-repo workspaces).
 * @property workspaceType - Type of workspace: "single-repo" | "multi-repo" | "non-git".
 * @property onRepoChange - Callback to change the selected repository in multi-repo workspaces.
 * @property tabId - Workspace tab ID for session-project association.
 * @property preserveOnHide - If true, don't kill sessions when component unmounts (for project switching).
 * @property onSessionCountChange - Fires whenever session counts change,
 *   providing both total slot count and launched session count.
 */
interface TerminalGridProps {
  projectPath?: string;
  repoPath?: string;
  repositories?: RepositoryInfo[];
  workspaceType?: WorkspaceType;
  onRepoChange?: (path: string) => void;
  tabId?: string;
  preserveOnHide?: boolean;
  isActive?: boolean;
  onSessionCountChange?: (slotCount: number, launchedCount: number) => void;
  onAllSessionsClosed?: () => void;
  onZoomChange?: (isZoomed: boolean) => void;
}

/**
 * Manages a dynamic grid of session slots that can be either:
 * - Pre-launch cards (allowing user to configure AI mode and branch before launching)
 * - Active terminal views (connected to a backend PTY session)
 *
 * Lifecycle:
 * - On mount, creates a single empty slot for the user to configure.
 * - User configures AI mode and branch, then clicks "Launch" to spawn a shell.
 * - `addSession` creates new pre-launch slots up to MAX_SESSIONS.
 * - "Launch All" spawns all unlaunched slots with their configured settings.
 * - When all sessions are killed by the user, an auto-respawn effect creates
 *   a fresh slot so the user is never left with an empty grid.
 */
function PlaceholderLeaf({ container, isZoomed, slotId, isDropTarget }: {
  container: HTMLDivElement;
  isZoomed: boolean;
  slotId: string;
  isDropTarget?: boolean;
}) {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const { setNodeRef, isOver } = useDroppable({ id: slotId });

  const combinedRef = useCallback(
    (node: HTMLDivElement | null) => {
      (placeholderRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      setNodeRef(node);
    },
    [setNodeRef],
  );

  useEffect(() => {
    const placeholder = placeholderRef.current;
    if (!placeholder || isZoomed) return;
    placeholder.appendChild(container);
    return () => {
      if (container.parentNode === placeholder) {
        placeholder.removeChild(container);
      }
    };
  }, [container, isZoomed]);

  return (
    <div
      ref={combinedRef}
      className={`h-full w-full relative ${isOver && isDropTarget ? "ring-2 ring-maestro-accent ring-inset rounded" : ""}`}
    />
  );
}

export const TerminalGrid = forwardRef<TerminalGridHandle, TerminalGridProps>(function TerminalGrid(
  { projectPath, repoPath, repositories, workspaceType, onRepoChange, tabId, preserveOnHide = false, isActive = true, onSessionCountChange, onAllSessionsClosed, onZoomChange },
  ref,
) {
  // Use repoPath for git operations, falling back to projectPath
  const effectiveRepoPath = repoPath ?? projectPath;

  const addSessionToProject = useWorkspaceStore((s) => s.addSessionToProject);
  const removeSessionFromProject = useWorkspaceStore((s) => s.removeSessionFromProject);
  const worktreeBasePath = useWorkspaceStore((s) =>
    tabId ? s.tabs.find((t) => t.id === tabId)?.worktreeBasePath ?? null : null
  );

  // MCP store - use stable empty array reference to avoid infinite re-render loops
  const mcpServers = useMcpStore((s) =>
    projectPath ? (s.projectServers[projectPath] ?? EMPTY_MCP_SERVERS) : EMPTY_MCP_SERVERS
  );
  const fetchMcpServers = useMcpStore((s) => s.fetchProjectServers);

  // Plugin store - use stable empty array references
  const skills = usePluginStore((s) =>
    projectPath ? (s.projectSkills[projectPath] ?? EMPTY_SKILLS) : EMPTY_SKILLS
  );
  const plugins = usePluginStore((s) =>
    projectPath ? (s.projectPlugins[projectPath] ?? EMPTY_PLUGINS) : EMPTY_PLUGINS
  );
  const fetchPlugins = usePluginStore((s) => s.fetchProjectPlugins);

  // Track session slots (pre-launch and launched)
  const [slots, setSlots] = useState<SessionSlot[]>(() => [createEmptySlot()]);
  const [error, setError] = useState<string | null>(null);

  // Track which terminal slot is focused (by slot ID)
  const [focusedSlotId, setFocusedSlotId] = useState<string | null>(null);

  // Track which terminal slot is zoomed (takes full screen)
  const [zoomedSlotId, setZoomedSlotId] = useState<string | null>(null);

  // Notify parent when zoom state changes
  useEffect(() => {
    onZoomChange?.(zoomedSlotId !== null);
  }, [zoomedSlotId, onZoomChange]);

  // Persistent container divs for DOM reparenting (preserves xterm instances across zoom)
  const terminalContainersRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const zoomedContainerRef = useRef<HTMLDivElement>(null);

  const getOrCreateContainer = useCallback((slotId: string) => {
    let container = terminalContainersRef.current.get(slotId);
    if (!container) {
      container = document.createElement('div');
      container.style.width = '100%';
      container.style.height = '100%';
      terminalContainersRef.current.set(slotId, container);
    }
    return container;
  }, []);

  // Binary split tree layout (drives pane arrangement)
  const [layoutTree, setLayoutTree] = useState<TreeNode>(() => createLeaf(slots[0].id));

  // Track whether a divider is being dragged (disables xterm pointer events)
  const [isDragging, setIsDragging] = useState(false);

  // Git branch data
  const [branches, setBranches] = useState<BranchWithWorktreeStatus[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [isGitRepo, setIsGitRepo] = useState(true);

  // Refs for cleanup
  const slotsRef = useRef<SessionSlot[]>([]);
  const mounted = useRef(false);
  // Track debounce timers for saving branch config (keyed by slot ID)
  const branchConfigSaveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Ref to access latest onAllSessionsClosed without adding it to callback deps
  const onAllSessionsClosedRef = useRef(onAllSessionsClosed);
  onAllSessionsClosedRef.current = onAllSessionsClosed;

  // Stable per-slot focus callbacks — avoids creating new arrow functions on every render,
  // which would defeat React.memo on TerminalView.
  const focusCallbacksRef = useRef(new Map<string, () => void>());
  const getFocusCallback = useCallback((slotId: string) => {
    let cb = focusCallbacksRef.current.get(slotId);
    if (!cb) {
      cb = () => setFocusedSlotId(slotId);
      focusCallbacksRef.current.set(slotId, cb);
    }
    return cb;
  }, []);

  // Ordered slot IDs from the split tree (defines Cmd+1-9 ordering)
  const orderedSlotIds = useMemo(() => collectSlotIds(layoutTree), [layoutTree]);

  // Compute launched slots in tree order for keyboard navigation
  const launchedSlots = useMemo(() => {
    const slotMap = new Map(slots.map((s) => [s.id, s]));
    return orderedSlotIds
      .map((id) => slotMap.get(id))
      .filter((s): s is SessionSlot => s != null && s.sessionId !== null);
  }, [slots, orderedSlotIds]);

  // Map focusedSlotId to an index in launchedSlots
  const focusedIndex = useMemo(() => {
    if (!focusedSlotId) return null;
    const idx = launchedSlots.findIndex((s) => s.id === focusedSlotId);
    return idx >= 0 ? idx : null;
  }, [focusedSlotId, launchedSlots]);

  // Ref-based close callback to avoid forward-reference issues with handleKill/removeSlot
  const closePaneRef = useRef<() => void>(() => {});

  /**
   * Splits the focused terminal pane in the given direction.
   * Creates a new pre-launch slot and inserts it as a sibling.
   * Debounced to prevent double-fire from duplicate keyboard events.
   */
  const lastSplitRef = useRef(0);
  const handleSplit = useCallback((direction: SplitDirection) => {
    const now = Date.now();
    if (now - lastSplitRef.current < 200) return; // debounce
    lastSplitRef.current = now;

    if (slotsRef.current.length >= MAX_SESSIONS) return;
    // Default to first slot if nothing is focused
    const targetSlotId = focusedSlotId ?? slotsRef.current[0]?.id;
    if (!targetSlotId) return;
    const newSlot = createEmptySlot(mcpServers, skills, plugins);
    setSlots((prev) => [...prev, newSlot]);
    setLayoutTree((prev) => splitLeaf(prev, targetSlotId, newSlot.id, direction));
    setFocusedSlotId(newSlot.id);
  }, [focusedSlotId, mcpServers, skills, plugins]);

  // Terminal keyboard navigation hook
  useTerminalKeyboard({
    terminalCount: launchedSlots.length,
    focusedIndex,
    onFocusTerminal: useCallback((index: number) => {
      const slot = launchedSlots[index];
      if (slot) {
        setFocusedSlotId(slot.id);
      }
    }, [launchedSlots]),
    onCycleNext: useCallback(() => {
      if (launchedSlots.length === 0) return;
      const currentIdx = focusedIndex ?? -1;
      const nextIdx = (currentIdx + 1) % launchedSlots.length;
      setFocusedSlotId(launchedSlots[nextIdx].id);
    }, [launchedSlots, focusedIndex]),
    onCyclePrevious: useCallback(() => {
      if (launchedSlots.length === 0) return;
      const currentIdx = focusedIndex ?? 0;
      const prevIdx = (currentIdx - 1 + launchedSlots.length) % launchedSlots.length;
      setFocusedSlotId(launchedSlots[prevIdx].id);
    }, [launchedSlots, focusedIndex]),
    onSplitVertical: useCallback(() => handleSplit("vertical"), [handleSplit]),
    onSplitHorizontal: useCallback(() => handleSplit("horizontal"), [handleSplit]),
    onClosePane: closePaneRef.current,
    enabled: isActive,
  });

  // Sync refs with state and report counts to parent
  useEffect(() => {
    slotsRef.current = slots;
    const launchedCount = slots.filter((s) => s.sessionId !== null).length;
    onSessionCountChange?.(slots.length, launchedCount);
  }, [slots, onSessionCountChange]);

  // Refresh branches callback (used by useEffect and exposed via handle)
  const refreshBranches = useCallback(() => {
    if (!effectiveRepoPath) {
      setIsGitRepo(false);
      return;
    }

    setIsLoadingBranches(true);
    getBranchesWithWorktreeStatus(effectiveRepoPath)
      .then((branchList) => {
        setBranches(branchList);
        setIsGitRepo(true);
        setIsLoadingBranches(false);
      })
      .catch((err) => {
        console.error("Failed to fetch branches:", err);
        setIsGitRepo(false);
        setIsLoadingBranches(false);
      });
  }, [effectiveRepoPath]);

  // Fetch branches when effectiveRepoPath is available
  // Lazy Load: Only fetch project metadata if the tab is active.
  // This prevents background projects from triggering macOS permission prompts on boot.
  useEffect(() => {
    if (!isActive) return;
    refreshBranches();
  }, [refreshBranches, isActive]);

  // Fetch MCP servers and plugins when projectPath is available
  useEffect(() => {
    if (!projectPath) return;

    // Fetch MCP servers
    fetchMcpServers(projectPath).catch(console.error);

    // Fetch plugins/skills
    fetchPlugins(projectPath).catch(console.error);
  }, [projectPath, isActive, fetchMcpServers, fetchPlugins]);

  // Update slot enabled MCP servers when servers are fetched
  useEffect(() => {
    if (mcpServers.length > 0) {
      setSlots((prev) =>
        prev.map((slot) => {
          // Only update if the slot has no enabled servers (fresh slot)
          if (slot.enabledMcpServers.length === 0) {
            return { ...slot, enabledMcpServers: mcpServers.map((s) => s.name) };
          }
          return slot;
        })
      );
    }
  }, [mcpServers]);

  // Update slot enabled skills/plugins when they are fetched
  useEffect(() => {
    if (skills.length > 0 || plugins.length > 0) {
      setSlots((prev) =>
        prev.map((slot) => {
          let updated = slot;
          // Only update if the slot has no enabled skills (fresh slot)
          if (slot.enabledSkills.length === 0 && skills.length > 0) {
            updated = { ...updated, enabledSkills: skills.map((s) => s.id) };
          }
          // Only update if the slot has no enabled plugins (fresh slot)
          if (slot.enabledPlugins.length === 0 && plugins.length > 0) {
            updated = {
              ...updated,
              enabledPlugins: plugins.filter((p) => p.enabled_by_default).map((p) => p.id),
            };
          }
          return updated;
        })
      );
    }
  }, [skills, plugins]);

  // Mark as mounted after first render
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Clear any pending branch config save timers
      for (const timer of branchConfigSaveTimers.current.values()) {
        clearTimeout(timer);
      }
      branchConfigSaveTimers.current.clear();
      // Kill all launched sessions on unmount (unless preserving)
      if (!preserveOnHide) {
        for (const slot of slotsRef.current) {
          if (slot.sessionId !== null) {
            killSession(slot.sessionId).catch(console.error);
          }
        }
      }
    };
  }, [preserveOnHide]);

  // When all slots are removed: either return to idle landing view or respawn a slot
  useEffect(() => {
    if (slots.length === 0 && mounted.current && !error) {
      if (onAllSessionsClosed) {
        onAllSessionsClosed();
      } else {
        const freshSlot = createEmptySlot(mcpServers, skills, plugins);
        setSlots([freshSlot]);
        setLayoutTree(createLeaf(freshSlot.id));
      }
    }
  }, [slots.length, error, mcpServers, skills, plugins, onAllSessionsClosed]);

  /**
   * Saves branch config with debouncing.
   * Called when slot config changes (plugins, skills, MCP servers).
   */
  const debouncedSaveBranchConfig = useCallback((slot: SessionSlot) => {
    if (!effectiveRepoPath || !slot.branch) return;

    // Clear existing timer for this slot
    const existingTimer = branchConfigSaveTimers.current.get(slot.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      saveBranchConfig(effectiveRepoPath, slot.branch!, {
        enabled_plugins: slot.enabledPlugins,
        enabled_skills: slot.enabledSkills,
        enabled_mcp_servers: slot.enabledMcpServers,
      }).catch((err) => {
        console.error("Failed to save branch config:", err);
      });
      branchConfigSaveTimers.current.delete(slot.id);
    }, 500);

    branchConfigSaveTimers.current.set(slot.id, timer);
  }, [effectiveRepoPath]);

  // Save branch config when slot config changes (debounced)
  // Track previous slots to detect config changes
  const prevSlotsRef = useRef<SessionSlot[]>([]);
  useEffect(() => {
    // Compare each slot's config with previous state
    for (const slot of slots) {
      // Skip slots without a branch (non-worktree sessions)
      if (!slot.branch) continue;
      // Skip already-launched sessions (no need to save pre-launch config)
      if (slot.sessionId !== null) continue;

      const prevSlot = prevSlotsRef.current.find((s) => s.id === slot.id);
      if (!prevSlot) continue; // New slot, no previous state

      // Check if config changed (but not the branch itself - that's handled by updateSlotBranch)
      const configChanged =
        prevSlot.branch === slot.branch && // Same branch
        (
          JSON.stringify(prevSlot.enabledPlugins) !== JSON.stringify(slot.enabledPlugins) ||
          JSON.stringify(prevSlot.enabledSkills) !== JSON.stringify(slot.enabledSkills) ||
          JSON.stringify(prevSlot.enabledMcpServers) !== JSON.stringify(slot.enabledMcpServers)
        );

      if (configChanged) {
        debouncedSaveBranchConfig(slot);
      }
    }

    prevSlotsRef.current = slots;
  }, [slots, debouncedSaveBranchConfig]);

  /**
   * Inner implementation of launchSlot, called within the project lock.
   * Spawns a shell with the configured settings. If a branch is selected,
   * prepares a worktree for that branch first.
   */
  const launchSlotInner = useCallback(async (slotId: string) => {
    const slot = slotsRef.current.find((s) => s.id === slotId);
    if (!slot || slot.sessionId !== null) return;

    try {
      // Save branch config before launching (ensures it's persisted)
      if (effectiveRepoPath && slot.branch) {
        await saveBranchConfig(effectiveRepoPath, slot.branch, {
          enabled_plugins: slot.enabledPlugins,
          enabled_skills: slot.enabledSkills,
          enabled_mcp_servers: slot.enabledMcpServers,
        }).catch((err) => {
          console.error("Failed to save branch config on launch:", err);
          // Non-fatal - continue with launch
        });
      }

      // Determine the working directory
      // If a branch is selected, prepare a worktree first
      // For multi-repo workspaces, use effectiveRepoPath for git operations
      let workingDirectory = effectiveRepoPath ?? projectPath;
      let worktreePath: string | null = null;
      let worktreeWarning: string | null = null;

      if (effectiveRepoPath && slot.branch) {
        const result = await prepareSessionWorktree(effectiveRepoPath, slot.branch, worktreeBasePath);
        workingDirectory = result.working_directory;
        worktreePath = result.worktree_path;
        worktreeWarning = result.warning;

        if (worktreeWarning) {
          console.error(`[Worktree] Warning for branch "${slot.branch}": ${worktreeWarning}`);
        }
      }

      // Generate project hash for MCP status identification
      // This is passed as MAESTRO_PROJECT_HASH env var to enable process-isolated
      // session identification (avoiding .mcp.json race conditions)
      let envVars: Record<string, string> | undefined;
      if (projectPath) {
        const projectHash = await invoke<string>("generate_project_hash", { projectPath });
        envVars = { MAESTRO_PROJECT_HASH: projectHash };
      }

      // Spawn the shell in the correct directory (worktree or project path)
      // MAESTRO_SESSION_ID is automatically injected by the backend
      const sessionId = await spawnShell(workingDirectory, envVars);

      // Register the session in SessionManager (required before assigning branch)
      if (projectPath) {
        const sessionConfig = await createSession(sessionId, slot.mode, projectPath);
        // Add project to MCP status monitor for polling status updates
        await invoke("add_mcp_project", { projectPath });
        // Add session to store directly (don't refetch all sessions to avoid status reset)
        useSessionStore.getState().addSession({
          ...sessionConfig,
          status: sessionConfig.status as import("@/stores/useSessionStore").BackendSessionStatus,
        });
      }

      // Assign the branch to the session so the header displays it
      if (slot.branch) {
        const updatedConfig = await assignSessionBranch(sessionId, slot.branch, worktreePath);
        useSessionStore.getState().updateSession(sessionId, {
          branch: updatedConfig.branch,
          worktree_path: updatedConfig.worktree_path,
        });
      }

      // Save enabled MCP servers for this session
      if (projectPath) {
        await setSessionMcpServers(projectPath, sessionId, slot.enabledMcpServers);
      }

      // Save enabled skills and plugins for this session
      if (projectPath) {
        await setSessionSkills(projectPath, sessionId, slot.enabledSkills);
        await setSessionPlugins(projectPath, sessionId, slot.enabledPlugins);
      }

      // Update slot state FIRST to mount TerminalView and initialize xterm.js.
      // This MUST happen before sending any commands to the PTY, otherwise
      // xterm.js won't be listening when output arrives and it will be lost.
      // This is also critical because CLIs like Codex send DSR (cursor position)
      // queries on startup, and xterm.js must be mounted to respond to them.
      setSlots((prev) =>
        prev.map((s) =>
          s.id === slotId ? { ...s, sessionId, worktreePath, worktreeWarning } : s
        )
      );

      // Register session with the project
      if (tabId) {
        addSessionToProject(tabId, sessionId);
      }

      // Auto-launch AI CLI after shell initializes
      // IMPORTANT: For Claude mode, we must write MCP config and launch CLI atomically
      // to prevent race conditions when multiple sessions launch without worktrees.
      // Without worktrees, all sessions share the same .mcp.json file, so we must:
      // 1. Write .mcp.json for this session
      // 2. Launch CLI immediately (before any other session can overwrite .mcp.json)
      // 3. Wait for CLI to read the config
      if (slot.mode !== "Plain") {
        const cliConfig = AI_CLI_CONFIG[slot.mode];
        if (cliConfig.command) {
          const isAvailable = await checkCliAvailable(cliConfig.command);

          if (isAvailable) {
            // Write MCP config IMMEDIATELY before launching CLI
            // This allows the CLI to discover MCP servers including the Maestro status server
            if (workingDirectory && slot.mode === "Claude") {
              try {
                await writeSessionMcpConfig(
                  workingDirectory,
                  sessionId,
                  projectPath ?? workingDirectory,
                  slot.enabledMcpServers
                );
              } catch (err) {
                console.error("Failed to write MCP config:", err);
                // Non-fatal - continue with CLI launch, MCP servers just won't be available
              }

              // Write plugin enabled/disabled state to settings.local.json
              // Uses enabledPlugins format (not the legacy plugins array)
              try {
                await writeSessionPluginConfig(
                  workingDirectory,
                  projectPath ?? workingDirectory,
                  slot.enabledPlugins
                );
              } catch (err) {
                console.error("Failed to write plugin config:", err);
                // Non-fatal - continue with CLI launch
              }

              // Write hooks config for Claude sessions
              // This configures Claude Code to POST hook events back to Maestro's status server
              try {
                await writeSessionHooksConfig(workingDirectory, sessionId);
              } catch (err) {
                console.warn("Failed to write hooks config:", err);
                // Non-fatal: hooks are enhancement, session can work without them
              }
            } else if (workingDirectory && slot.mode === "OpenCode") {
              // Write OpenCode MCP config (opencode.json format)
              try {
                await writeOpenCodeMcpConfig(
                  workingDirectory,
                  sessionId,
                  projectPath ?? workingDirectory,
                  slot.enabledMcpServers
                );
              } catch (err) {
                console.error("Failed to write OpenCode MCP config:", err);
                // Non-fatal - continue with CLI launch
              }

              // Write plugin enabled/disabled state to settings.local.json
              try {
                await writeSessionPluginConfig(
                  workingDirectory,
                  projectPath ?? workingDirectory,
                  slot.enabledPlugins
                );
              } catch (err) {
                console.error("Failed to write plugin config:", err);
                // Non-fatal - continue with CLI launch
              }
            }

            // Wait for xterm.js to mount and start listening for PTY output
            // This ensures we don't send CLI commands before the terminal is ready
            // (which would cause output to be lost since Tauri events aren't buffered)
            try {
              await waitForTerminalReady(sessionId);
            } catch (err) {
              console.warn("Terminal ready timeout, proceeding anyway:", err);
            }

            // Brief delay for shell to initialize
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Build CLI command with user-configured flags
            const cliFlags = useCliSettingsStore.getState().getFlags(slot.mode);
            const cliCommand = buildCliCommand(slot.mode, cliFlags);

            // Send CLI launch command
            await writeStdin(sessionId, `${cliCommand}\r`);

            // Brief delay for CLI initialization.
            // With session-specific MCP server names (maestro-1, maestro-2, etc.),
            // we no longer have race conditions on .mcp.json, so we only need
            // a minimal delay for general CLI startup.
            await new Promise((resolve) => setTimeout(resolve, 500));
          } else {
            console.warn(
              `CLI '${cliConfig.command}' not found. Install with: ${cliConfig.installHint}`
            );
          }
        }
      }
    } catch (err) {
      console.error("Failed to spawn shell:", err);
      setError("Failed to start terminal session");
    }
  }, [projectPath, effectiveRepoPath, tabId, addSessionToProject]);

  /**
   * Launches a single slot by spawning a shell with the configured settings.
   *
   * NOTE: Uses withProjectLock to serialize launches within the same project.
   * This prevents race conditions where multiple sessions share the same .mcp.json file.
   */
  const launchSlot = useCallback(async (slotId: string) => {
    const slot = slotsRef.current.find((s) => s.id === slotId);
    if (!slot || slot.sessionId !== null) return;

    // Gate on FDA: if the project is in a TCC-protected directory, check
    // Full Disk Access before any Rust-side filesystem operations.
    if (projectPath && pathRequiresFDA(projectPath)) {
      const hasAccess = await checkFullDiskAccess();
      if (!hasAccess) {
        useFDAStore.getState().requireAccess(projectPath, () => launchSlot(slotId));
        return;
      }
    }

    // Serialize launches within the same project to prevent .mcp.json race conditions
    const lockPath = projectPath ?? "no-project";
    await withProjectLock(lockPath, async () => {
      await launchSlotInner(slotId);
    });
  }, [projectPath, launchSlotInner]);

  /**
   * Launches all unlaunched slots sequentially.
   * Note: launchSlot already uses withProjectLock, so launches are serialized.
   */
  const launchAll = useCallback(async () => {
    const unlaunchedSlots = slotsRef.current.filter((s) => s.sessionId === null);
    for (const slot of unlaunchedSlots) {
      await launchSlot(slot.id);
    }
  }, [launchSlot]);

  /**
   * Handles killing/closing a session, updating the slot state.
   * Also cleans up any associated worktree and session-specific MCP config.
   */
  const handleKill = useCallback((sessionId: number) => {
    // Find the slot to get worktree path before removing
    const slot = slotsRef.current.find((s) => s.sessionId === sessionId);
    const worktreePath = slot?.worktreePath;
    const workingDir = worktreePath || projectPath;

    // If this is the last slot, return to idle landing view immediately
    if (slotsRef.current.length <= 1 && onAllSessionsClosedRef.current) {
      // Clean up focus callback
      if (slot) {
        focusCallbacksRef.current.delete(slot.id);
      }
      setZoomedSlotId(null);
      onAllSessionsClosedRef.current();
    } else {
      // Clean up cached focus callback for this slot
      if (slot) {
        focusCallbacksRef.current.delete(slot.id);

        // If the closed pane was zoomed, switch zoom to its sibling
        setZoomedSlotId((prev) => {
          if (prev !== slot.id) return prev;
          return findSiblingSlotId(layoutTree, slot.id);
        });

        // If the closed pane was focused, focus its sibling
        if (focusedSlotId === slot.id) {
          const sibling = findSiblingSlotId(layoutTree, slot.id);
          setFocusedSlotId(sibling);
        }

        // Remove leaf from split tree
        setLayoutTree((prev) => {
          const result = removeLeaf(prev, slot.id);
          return result ?? prev;
        });
      }

      setSlots((prev) => prev.filter((s) => s.sessionId !== sessionId));
    }

    // Remove session from the session store
    useSessionStore.getState().removeSession(sessionId);

    // Unregister session from the project
    if (tabId) {
      removeSessionFromProject(tabId, sessionId);
    }

    // Clean up session-specific MCP config (fire-and-forget)
    if (workingDir) {
      if (slot?.mode === "OpenCode") {
        removeOpenCodeMcpConfig(workingDir, sessionId).catch(console.error);
      } else {
        removeSessionMcpConfig(workingDir, sessionId).catch(console.error);
      }
    }

    // Clean up session-specific settings.local.json config (serialized to prevent race)
    // Both removeSessionPluginConfig and removeSessionHooksConfig modify the same file,
    // so they must be awaited sequentially to avoid concurrent write corruption.
    if (workingDir) {
      const cleanupSettings = async () => {
        try {
          await removeSessionPluginConfig(workingDir);
        } catch (err) {
          console.error("Failed to remove plugin config:", err);
        }
        if (slot?.mode === "Claude") {
          try {
            await removeSessionHooksConfig(workingDir);
          } catch (err) {
            console.error("Failed to remove hooks config:", err);
          }
        }
      };
      cleanupSettings().catch(console.error);
    }

    // Clean up worktree if one was created (fire-and-forget)
    // Use effectiveRepoPath for worktree cleanup since worktrees are git-repo specific
    if (effectiveRepoPath && worktreePath) {
      cleanupSessionWorktree(effectiveRepoPath, worktreePath)
        .then(() => refreshBranches())
        .catch(console.error);
    }
  }, [tabId, effectiveRepoPath, projectPath, removeSessionFromProject, refreshBranches, focusedSlotId, layoutTree]);

  /**
   * Removes a pre-launch slot (before it's launched).
   */
  const removeSlot = useCallback((slotId: string) => {
    focusCallbacksRef.current.delete(slotId);
    terminalContainersRef.current.delete(slotId);

    // If removing the last slot, return to idle landing view immediately
    // rather than going through an intermediate empty state
    if (slotsRef.current.length <= 1 && onAllSessionsClosedRef.current) {
      setZoomedSlotId(null);
      onAllSessionsClosedRef.current();
      return;
    }

    // If the removed pane was zoomed, switch zoom to its sibling
    setZoomedSlotId((prev) => {
      if (prev !== slotId) return prev;
      return findSiblingSlotId(layoutTree, slotId);
    });

    // If the removed pane was focused, focus its sibling
    if (focusedSlotId === slotId) {
      const sibling = findSiblingSlotId(layoutTree, slotId);
      setFocusedSlotId(sibling);
    }

    // Remove leaf from split tree
    setLayoutTree((prev) => {
      const result = removeLeaf(prev, slotId);
      return result ?? prev;
    });

    setSlots((prev) => prev.filter((s) => s.id !== slotId));
  }, [focusedSlotId, layoutTree]);

  // Keep closePaneRef in sync with latest handleKill/removeSlot
  closePaneRef.current = () => {
    const targetId = focusedSlotId ?? slotsRef.current[0]?.id;
    if (!targetId) return;
    if (slotsRef.current.length <= 1) return; // don't close the last pane
    const slot = slotsRef.current.find((s) => s.id === targetId);
    if (!slot) return;

    if (slot.sessionId !== null) {
      // Confirm before closing a launched session (async native dialog)
      ask("Are you sure you want to close this session?", {
        title: "Close Session",
        kind: "warning",
      }).then((confirmed) => {
        if (!confirmed) return;
        // Kill the backend PTY process (fire-and-forget)
        killSession(slot.sessionId!).catch(console.error);
        handleKill(slot.sessionId!);
      }).catch(console.error);
    } else {
      removeSlot(slot.id);
    }
  };

  /**
   * Updates the AI mode for a slot.
   */
  const updateSlotMode = useCallback((slotId: string, mode: AiMode) => {
    setSlots((prev) =>
      prev.map((s) =>
        s.id === slotId ? { ...s, mode } : s
      )
    );
  }, []);

  /**
   * Updates the branch for a slot.
   * When a branch is selected, loads any saved config for that branch.
   */
  const updateSlotBranch = useCallback(async (slotId: string, branch: string | null) => {
    // First update the branch
    setSlots((prev) =>
      prev.map((s) =>
        s.id === slotId ? { ...s, branch } : s
      )
    );

    // If a branch is selected and we have a repo path, try to load saved config
    if (branch && effectiveRepoPath) {
      try {
        const savedConfig = await loadBranchConfig(effectiveRepoPath, branch);
        if (savedConfig) {
          // Apply saved config to the slot
          setSlots((prev) =>
            prev.map((s) => {
              if (s.id !== slotId) return s;
              return {
                ...s,
                enabledPlugins: savedConfig.enabled_plugins,
                enabledSkills: savedConfig.enabled_skills,
                enabledMcpServers: savedConfig.enabled_mcp_servers,
              };
            })
          );
        }
      } catch (err) {
        console.error("Failed to load branch config:", err);
        // Non-fatal - continue with current slot config
      }
    }
  }, [effectiveRepoPath]);

  /**
   * Toggles an MCP server for a slot.
   */
  const toggleSlotMcp = useCallback((slotId: string, serverName: string) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== slotId) return s;
        const isEnabled = s.enabledMcpServers.includes(serverName);
        const newEnabled = isEnabled
          ? s.enabledMcpServers.filter((n) => n !== serverName)
          : [...s.enabledMcpServers, serverName];
        return { ...s, enabledMcpServers: newEnabled };
      })
    );
  }, []);

  /**
   * Toggles a skill for a slot.
   */
  const toggleSlotSkill = useCallback((slotId: string, skillId: string) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== slotId) return s;
        const isEnabled = s.enabledSkills.includes(skillId);
        const newEnabled = isEnabled
          ? s.enabledSkills.filter((id) => id !== skillId)
          : [...s.enabledSkills, skillId];
        return { ...s, enabledSkills: newEnabled };
      })
    );
  }, []);

  /**
   * Selects all MCP servers for a slot.
   */
  const selectAllMcp = useCallback((slotId: string) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== slotId) return s;
        return { ...s, enabledMcpServers: mcpServers.map((server) => server.name) };
      })
    );
  }, [mcpServers]);

  /**
   * Unselects all MCP servers for a slot.
   */
  const unselectAllMcp = useCallback((slotId: string) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== slotId) return s;
        return { ...s, enabledMcpServers: [] };
      })
    );
  }, []);

  /**
   * Selects all plugins and skills for a slot.
   */
  const selectAllPlugins = useCallback((slotId: string) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== slotId) return s;
        return {
          ...s,
          enabledPlugins: plugins.map((p) => p.id),
          enabledSkills: skills.map((sk) => sk.id),
        };
      })
    );
  }, [plugins, skills]);

  /**
   * Unselects all plugins and skills for a slot.
   */
  const unselectAllPlugins = useCallback((slotId: string) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== slotId) return s;
        return { ...s, enabledPlugins: [], enabledSkills: [] };
      })
    );
  }, []);

  /**
   * Toggles a plugin for a slot.
   * Also toggles all skills belonging to that plugin.
   */
  const toggleSlotPlugin = useCallback((slotId: string, pluginId: string) => {
    // Find the plugin and its associated skills
    const plugin = plugins.find((p) => p.id === pluginId);
    if (!plugin) return;

    // Helper to extract base name from skill ID
    const getSkillBaseName = (skillId: string): string => {
      const colonIndex = skillId.indexOf(":");
      return colonIndex >= 0 ? skillId.slice(colonIndex + 1) : skillId;
    };

    // Build map of base name -> skill for lookup
    const skillByBaseName = new Map(skills.map((s) => [getSkillBaseName(s.id), s]));

    // Find all skill IDs that belong to this plugin
    const pluginSkillIds: string[] = [];
    for (const skillId of plugin.skills) {
      const baseName = getSkillBaseName(skillId);
      const skill = skillByBaseName.get(baseName);
      if (skill) {
        pluginSkillIds.push(skill.id);
      }
    }

    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== slotId) return s;
        const isEnabled = s.enabledPlugins.includes(pluginId);

        // Toggle plugin
        const newEnabledPlugins = isEnabled
          ? s.enabledPlugins.filter((id) => id !== pluginId)
          : [...s.enabledPlugins, pluginId];

        // Toggle all associated skills
        let newEnabledSkills: string[];
        if (isEnabled) {
          // Disabling plugin - remove all its skills
          newEnabledSkills = s.enabledSkills.filter((id) => !pluginSkillIds.includes(id));
        } else {
          // Enabling plugin - add all its skills (avoid duplicates)
          const skillsToAdd = pluginSkillIds.filter((id) => !s.enabledSkills.includes(id));
          newEnabledSkills = [...s.enabledSkills, ...skillsToAdd];
        }

        return { ...s, enabledPlugins: newEnabledPlugins, enabledSkills: newEnabledSkills };
      })
    );
  }, [plugins, skills]);

  /**
   * Creates a new branch and optionally checks it out.
   * Passed to PreLaunchCard for inline branch creation.
   */
  const handleCreateBranch = useCallback(
    async (name: string, andCheckout: boolean, repoPath?: string) => {
      const targetRepo = repoPath ?? effectiveRepoPath;
      if (!targetRepo) return;
      await invoke("git_create_branch", {
        repoPath: targetRepo,
        branchName: name,
        startPoint: null,
      });
      if (andCheckout) {
        await invoke("git_checkout_branch", {
          repoPath: targetRepo,
          branchName: name,
        });
      }
      refreshBranches();
    },
    [effectiveRepoPath, refreshBranches],
  );

  /**
   * Adds a new pre-launch slot to the grid.
   */
  const addSession = useCallback(() => {
    if (slotsRef.current.length >= MAX_SESSIONS) return;
    const newSlot = createEmptySlot(mcpServers, skills, plugins);
    setSlots((prev) => {
      if (prev.length >= MAX_SESSIONS) return prev;
      return [...prev, newSlot];
    });
    // Rebuild layout as a clean 2D grid (matching old CSS grid dimensions)
    setLayoutTree(() => buildGridTree([...orderedSlotIds, newSlot.id]));
    setFocusedSlotId(newSlot.id);
    // Refresh branch list so new slots see the latest branches
    refreshBranches();
  }, [mcpServers, skills, plugins, refreshBranches, orderedSlotIds]);

  const addSessionWithConfig = useCallback((branch: string, worktreePath: string) => {
    if (slotsRef.current.length >= MAX_SESSIONS) return;
    const newSlot = createEmptySlot(mcpServers, skills, plugins);
    newSlot.branch = branch;
    newSlot.worktreePath = worktreePath;
    setSlots((prev) => {
      if (prev.length >= MAX_SESSIONS) return prev;
      return [...prev, newSlot];
    });
    setLayoutTree(() => buildGridTree([...orderedSlotIds, newSlot.id]));
    setFocusedSlotId(newSlot.id);
    refreshBranches();
  }, [mcpServers, skills, plugins, refreshBranches, orderedSlotIds]);

  const focusSession = useCallback((sessionId: number) => {
    const slot = slotsRef.current.find((s) => s.sessionId === sessionId);
    if (slot) {
      setZoomedSlotId(slot.id);
    }
  }, []);

  useImperativeHandle(ref, () => ({ addSession, addSessionWithConfig, launchAll, refreshBranches, focusSession }), [addSession, addSessionWithConfig, launchAll, refreshBranches, focusSession]);

  // Apply pending template from sidebar
  const pendingTemplate = useTemplateStore((s) => s.pendingTemplate);
  const clearPendingTemplate = useTemplateStore((s) => s.clearPendingTemplate);

  useEffect(() => {
    if (!pendingTemplate) return;

    // Find the focused pre-launch slot (not yet launched)
    let targetSlot = slotsRef.current.find(
      (s) => s.id === focusedSlotId && s.sessionId === null,
    );
    // Fallback: any pre-launch slot
    if (!targetSlot) {
      targetSlot = slotsRef.current.find((s) => s.sessionId === null);
    }

    if (targetSlot) {
      const targetId = targetSlot.id;
      setSlots((prev) =>
        prev.map((s) =>
          s.id === targetId
            ? {
                ...s,
                mode: pendingTemplate.mode,
                enabledMcpServers: pendingTemplate.enabledMcpServers,
                enabledSkills: pendingTemplate.enabledSkills,
                enabledPlugins: pendingTemplate.enabledPlugins,
              }
            : s,
        ),
      );
    } else {
      // No pre-launch slot exists — create one and apply template
      if (slotsRef.current.length < MAX_SESSIONS) {
        const newSlot: SessionSlot = {
          id: generateSlotId(),
          mode: pendingTemplate.mode,
          branch: null,
          sessionId: null,
          worktreePath: null,
          worktreeWarning: null,
          enabledMcpServers: pendingTemplate.enabledMcpServers,
          enabledSkills: pendingTemplate.enabledSkills,
          enabledPlugins: pendingTemplate.enabledPlugins,
        };
        setSlots((prev) => [...prev, newSlot]);
        setLayoutTree(() => buildGridTree([...orderedSlotIds, newSlot.id]));
        setFocusedSlotId(newSlot.id);
      }
    }

    clearPendingTemplate();
  }, [pendingTemplate, clearPendingTemplate, focusedSlotId, orderedSlotIds]);

  // DnD: sensors and drag-end handler for reordering panes
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );
  const [activeDragSlotId, setActiveDragSlotId] = useState<string | null>(null);

  const handlePaneDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragSlotId(null);
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setLayoutTree((prev) => swapLeaves(prev, active.id as string, over.id as string));
    }
  }, []);

  // Handle zoom toggle for a slot
  const handleToggleZoom = useCallback((slotId: string) => {
    setZoomedSlotId(prev => prev === slotId ? null : slotId);
  }, []);

  // Handle Escape key to exit zoom mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && zoomedSlotId) {
        handleToggleZoom(zoomedSlotId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomedSlotId, handleToggleZoom]);

  // Reparent container div into zoom overlay when zooming
  useEffect(() => {
    if (!zoomedSlotId || !zoomedContainerRef.current) return;
    const container = terminalContainersRef.current.get(zoomedSlotId);
    if (!container) return;
    zoomedContainerRef.current.appendChild(container);
  }, [zoomedSlotId]);

  const renderLeaf = useCallback((slotId: string) => {
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) return null;

    const container = getOrCreateContainer(slotId);
    const isThisZoomed = zoomedSlotId === slotId;

    const content = slot.sessionId !== null ? (
      <ErrorBoundary>
        <TerminalView
          key={slot.id}
          sessionId={slot.sessionId}
          slotId={slot.id}
          isFocused={isThisZoomed || focusedSlotId === slot.id}
          isActive={isActive}
          onFocus={getFocusCallback(slot.id)}
          onKill={handleKill}
          terminalCount={slots.length}
          isZoomed={isThisZoomed}
          onToggleZoom={() => handleToggleZoom(slot.id)}
        />
      </ErrorBoundary>
    ) : (
      <PreLaunchCard
        key={slot.id}
        slot={slot}
        projectPath={projectPath ?? ""}
        branches={branches}
        isLoadingBranches={isLoadingBranches}
        isGitRepo={isGitRepo}
        repositories={repositories}
        workspaceType={workspaceType}
        selectedRepoPath={effectiveRepoPath}
        onRepoChange={onRepoChange}
        fetchBranchesForRepo={getBranchesWithWorktreeStatus}
        mcpServers={mcpServers}
        skills={skills}
        plugins={plugins}
        onCreateBranch={handleCreateBranch}
        onModeChange={(mode) => updateSlotMode(slot.id, mode)}
        onBranchChange={(branch) => updateSlotBranch(slot.id, branch)}
        onMcpToggle={(serverName) => toggleSlotMcp(slot.id, serverName)}
        onSkillToggle={(skillId) => toggleSlotSkill(slot.id, skillId)}
        onPluginToggle={(pluginId) => toggleSlotPlugin(slot.id, pluginId)}
        onMcpSelectAll={() => selectAllMcp(slot.id)}
        onMcpUnselectAll={() => unselectAllMcp(slot.id)}
        onPluginsSelectAll={() => selectAllPlugins(slot.id)}
        onPluginsUnselectAll={() => unselectAllPlugins(slot.id)}
        onLaunch={() => launchSlot(slot.id)}
        onRemove={() => removeSlot(slot.id)}
        isZoomed={isThisZoomed}
        onToggleZoom={() => handleToggleZoom(slot.id)}
      />
    );

    return (
      <>
        {createPortal(content, container)}
        <PlaceholderLeaf container={container} isZoomed={isThisZoomed} slotId={slot.id} isDropTarget={activeDragSlotId !== null && activeDragSlotId !== slot.id} />
      </>
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Deps cover all render-affecting state
  }, [slots, focusedSlotId, isActive, getFocusCallback, handleKill, handleToggleZoom, projectPath, branches, isLoadingBranches, isGitRepo, repositories, workspaceType, effectiveRepoPath, onRepoChange, mcpServers, skills, plugins, handleCreateBranch, updateSlotMode, updateSlotBranch, toggleSlotMcp, toggleSlotSkill, toggleSlotPlugin, selectAllMcp, unselectAllMcp, selectAllPlugins, unselectAllPlugins, launchSlot, removeSlot, zoomedSlotId, getOrCreateContainer, activeDragSlotId]);

  const handleRatioChange = useCallback((nodeId: string, ratio: number) => {
    setLayoutTree((prev) => updateRatio(prev, nodeId, ratio));
  }, []);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-maestro-muted">
        <span className="text-sm text-maestro-red">{error}</span>
        <button
          type="button"
          onClick={() => {
            setError(null);
            const freshSlot = createEmptySlot();
            setSlots([freshSlot]);
            setLayoutTree(createLeaf(freshSlot.id));
          }}
          className="rounded bg-maestro-border px-3 py-1.5 text-xs text-maestro-text hover:bg-maestro-muted/20"
        >
          Retry
        </button>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-maestro-muted text-sm">
        Initializing...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-maestro-bg">
      {/* Zoom navigation bar */}
      {zoomedSlotId && (() => {
        const zoomedOrderedSlots = orderedSlotIds
          .map((id) => slots.find((s) => s.id === id))
          .filter(Boolean) as SessionSlot[];
        const zoomedIndex = zoomedOrderedSlots.findIndex(s => s.id === zoomedSlotId);
        const sessions = useSessionStore.getState().sessions;

        const getSlotLabel = (slot: SessionSlot, index: number): string => {
          if (slot.sessionId !== null) {
            const session = sessions.find((s) => s.id === slot.sessionId);
            if (session?.name) return session.name;
          }
          return `Terminal ${index + 1}`;
        };

        return (
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-maestro-border bg-maestro-surface px-3">
            <span className="text-[11px] font-medium uppercase tracking-wider text-maestro-muted">
              {getSlotLabel(zoomedOrderedSlots[zoomedIndex], zoomedIndex)} — {zoomedIndex + 1}/{zoomedOrderedSlots.length}
            </span>
            <div className="h-3.5 w-px bg-maestro-border" />
            <div className="flex gap-0.5">
              {zoomedOrderedSlots.map((slot, index) => {
                const isSlotActive = slot.id === zoomedSlotId;
                const hasSession = slot.sessionId !== null;
                const label = getSlotLabel(slot, index);
                return (
                  <button
                    key={slot.id}
                    onClick={() =>
                      isSlotActive
                        ? setZoomedSlotId(null)
                        : setZoomedSlotId(slot.id)
                    }
                    className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      isSlotActive
                        ? 'bg-maestro-accent/15 text-maestro-accent'
                        : 'text-maestro-muted hover:bg-maestro-card hover:text-maestro-text'
                    }`}
                    title={isSlotActive ? 'Exit zoom' : `Switch to ${label}`}
                  >
                    <span className="text-xs">{label}</span>
                    {hasSession && (
                      <span className="h-1.5 w-1.5 rounded-full bg-maestro-green" />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex-1" />
            <button
              onClick={() => setZoomedSlotId(null)}
              className="rounded p-0.5 text-maestro-muted transition-colors hover:bg-maestro-card hover:text-maestro-text"
              title="Exit zoom (Esc)"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })()}

      {/* Content area */}
      <div className="relative flex-1 min-h-0">
        {/* Zoomed terminal target */}
        <div
          ref={zoomedContainerRef}
          className={zoomedSlotId ? "absolute inset-0 z-10 p-2" : "hidden"}
        />

        {/* SplitPaneView - invisible when zoomed (preserves layout/xterm state) */}
        <div className={`h-full p-2 ${isDragging ? "split-dragging" : ""} ${zoomedSlotId ? "invisible" : ""}`}>
          <DndContext
            sensors={dndSensors}
            collisionDetection={closestCenter}
            onDragStart={(event) => setActiveDragSlotId(event.active.id as string)}
            onDragEnd={handlePaneDragEnd}
            onDragCancel={() => setActiveDragSlotId(null)}
          >
            <SplitPaneView
              node={layoutTree}
              renderLeaf={renderLeaf}
              onRatioChange={handleRatioChange}
              onDragStateChange={setIsDragging}
            />
          </DndContext>
        </div>
      </div>
    </div>
  );
});
