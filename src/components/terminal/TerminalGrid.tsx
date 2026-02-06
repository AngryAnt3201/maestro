import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import { invoke } from "@tauri-apps/api/core";

import { getBranchesWithWorktreeStatus, type BranchWithWorktreeStatus } from "@/lib/git";
import { removeSessionMcpConfig, setSessionMcpServers, writeSessionMcpConfig, type McpServerConfig } from "@/lib/mcp";
import {
  loadBranchConfig,
  removeSessionPluginConfig,
  saveBranchConfig,
  setSessionPlugins,
  setSessionSkills,
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
  spawnShell,
  waitForTerminalReady,
  writeStdin,
} from "@/lib/terminal";
import { useCliSettingsStore } from "@/stores/useCliSettingsStore";
import { cleanupSessionWorktree, prepareSessionWorktree } from "@/lib/worktreeManager";
import { useTerminalKeyboard } from "@/hooks/useTerminalKeyboard";
import { useMcpStore } from "@/stores/useMcpStore";
import { usePluginStore } from "@/stores/usePluginStore";
import { useSessionStore } from "@/stores/useSessionStore";
import type { AiMode } from "@/stores/useSessionStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { PreLaunchCard, type SessionSlot } from "./PreLaunchCard";
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

/**
 * Returns Tailwind grid-cols/grid-rows classes that produce a compact layout
 * for the given session count (1x1, 2x1, 3x1, 2x2, 3x2, etc.).
 */
function gridClass(count: number): string {
  if (count <= 1) return "grid-cols-1 grid-rows-1";
  if (count === 2) return "grid-cols-2 grid-rows-1";
  if (count === 3) return "grid-cols-3 grid-rows-1";
  if (count === 4) return "grid-cols-2 grid-rows-2";
  if (count <= 6) return "grid-cols-3 grid-rows-2";
  if (count <= 9) return "grid-cols-3 grid-rows-3";
  if (count <= 12) return "grid-cols-4 grid-rows-3";
  return "grid-cols-4";
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
  launchAll: () => Promise<void>;
}

/**
 * @property projectPath - Working directory passed to `spawnShell`; when absent the backend
 *   uses its own default cwd.
 * @property tabId - Workspace tab ID for session-project association.
 * @property preserveOnHide - If true, don't kill sessions when component unmounts (for project switching).
 * @property onSessionCountChange - Fires whenever session counts change,
 *   providing both total slot count and launched session count.
 */
interface TerminalGridProps {
  projectPath?: string;
  tabId?: string;
  preserveOnHide?: boolean;
  isActive?: boolean;
  onSessionCountChange?: (slotCount: number, launchedCount: number) => void;
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
export const TerminalGrid = forwardRef<TerminalGridHandle, TerminalGridProps>(function TerminalGrid(
  { projectPath, tabId, preserveOnHide = false, isActive = true, onSessionCountChange },
  ref,
) {
  const addSessionToProject = useWorkspaceStore((s) => s.addSessionToProject);
  const removeSessionFromProject = useWorkspaceStore((s) => s.removeSessionFromProject);

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

  // Git branch data
  const [branches, setBranches] = useState<BranchWithWorktreeStatus[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [isGitRepo, setIsGitRepo] = useState(true);

  // Refs for cleanup
  const slotsRef = useRef<SessionSlot[]>([]);
  const mounted = useRef(false);
  // Track debounce timers for saving branch config (keyed by slot ID)
  const branchConfigSaveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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

  // Compute launched slots for keyboard navigation
  const launchedSlots = useMemo(
    () => slots.filter((s) => s.sessionId !== null),
    [slots]
  );

  // Map focusedSlotId to an index in launchedSlots
  const focusedIndex = useMemo(() => {
    if (!focusedSlotId) return null;
    const idx = launchedSlots.findIndex((s) => s.id === focusedSlotId);
    return idx >= 0 ? idx : null;
  }, [focusedSlotId, launchedSlots]);

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
  });

  // Sync refs with state and report counts to parent
  useEffect(() => {
    slotsRef.current = slots;
    const launchedCount = slots.filter((s) => s.sessionId !== null).length;
    onSessionCountChange?.(slots.length, launchedCount);
  }, [slots, onSessionCountChange]);

  // Fetch branches and MCP servers when projectPath is available
  useEffect(() => {
    // Lazy Load: Only fetch project metadata if the tab is active.
    // This prevents background projects from triggering macOS permission prompts on boot.
    if (!projectPath || !isActive) {
      if (!projectPath) setIsGitRepo(false);
      return;
    }

    setIsLoadingBranches(true);
    getBranchesWithWorktreeStatus(projectPath)
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

  // Auto-respawn a slot when all slots are removed (not on initial mount)
  useEffect(() => {
    if (slots.length === 0 && mounted.current && !error) {
      setSlots([createEmptySlot(mcpServers, skills, plugins)]);
    }
  }, [slots.length, error, mcpServers, skills, plugins]);

  /**
   * Saves branch config with debouncing.
   * Called when slot config changes (plugins, skills, MCP servers).
   */
  const debouncedSaveBranchConfig = useCallback((slot: SessionSlot) => {
    if (!projectPath || !slot.branch) return;

    // Clear existing timer for this slot
    const existingTimer = branchConfigSaveTimers.current.get(slot.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      saveBranchConfig(projectPath, slot.branch!, {
        enabled_plugins: slot.enabledPlugins,
        enabled_skills: slot.enabledSkills,
        enabled_mcp_servers: slot.enabledMcpServers,
      }).catch((err) => {
        console.error("Failed to save branch config:", err);
      });
      branchConfigSaveTimers.current.delete(slot.id);
    }, 500);

    branchConfigSaveTimers.current.set(slot.id, timer);
  }, [projectPath]);

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
      if (projectPath && slot.branch) {
        await saveBranchConfig(projectPath, slot.branch, {
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
      let workingDirectory = projectPath;
      let worktreePath: string | null = null;
      let worktreeWarning: string | null = null;

      if (projectPath && slot.branch) {
        const result = await prepareSessionWorktree(projectPath, slot.branch);
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

              // NOTE: We no longer write plugin config to settings.local.json
              // Claude CLI auto-discovers plugins from ~/.claude/plugins/
              // Writing a `plugins` array was interfering with auto-discovery
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
  }, [projectPath, tabId, addSessionToProject]);

  /**
   * Launches a single slot by spawning a shell with the configured settings.
   *
   * NOTE: Uses withProjectLock to serialize launches within the same project.
   * This prevents race conditions where multiple sessions share the same .mcp.json file.
   */
  const launchSlot = useCallback(async (slotId: string) => {
    const slot = slotsRef.current.find((s) => s.id === slotId);
    if (!slot || slot.sessionId !== null) return;

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

    // Clean up cached focus callback for this slot
    if (slot) {
      focusCallbacksRef.current.delete(slot.id);
    }

    setSlots((prev) => prev.filter((s) => s.sessionId !== sessionId));

    // Remove session from the session store
    useSessionStore.getState().removeSession(sessionId);

    // Unregister session from the project
    if (tabId) {
      removeSessionFromProject(tabId, sessionId);
    }

    // Clean up session-specific MCP config (fire-and-forget)
    if (workingDir) {
      removeSessionMcpConfig(workingDir, sessionId).catch(console.error);
    }

    // Clean up session-specific plugin config (fire-and-forget)
    if (workingDir) {
      removeSessionPluginConfig(workingDir).catch(console.error);
    }

    // Clean up worktree if one was created (fire-and-forget)
    if (projectPath && worktreePath) {
      cleanupSessionWorktree(projectPath, worktreePath).catch(console.error);
    }
  }, [tabId, projectPath, removeSessionFromProject]);

  /**
   * Removes a pre-launch slot (before it's launched).
   */
  const removeSlot = useCallback((slotId: string) => {
    focusCallbacksRef.current.delete(slotId);
    setSlots((prev) => prev.filter((s) => s.id !== slotId));
  }, []);

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

    // If a branch is selected and we have a project path, try to load saved config
    if (branch && projectPath) {
      try {
        const savedConfig = await loadBranchConfig(projectPath, branch);
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
  }, [projectPath]);

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
   * Adds a new pre-launch slot to the grid.
   */
  const addSession = useCallback(() => {
    if (slotsRef.current.length >= MAX_SESSIONS) return;
    setSlots((prev) => {
      if (prev.length >= MAX_SESSIONS) return prev;
      return [...prev, createEmptySlot(mcpServers, skills, plugins)];
    });
  }, [mcpServers, skills, plugins]);

  useImperativeHandle(ref, () => ({ addSession, launchAll }), [addSession, launchAll]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-maestro-muted">
        <span className="text-sm text-maestro-red">{error}</span>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setSlots([createEmptySlot()]);
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
    <div className={`grid h-full ${gridClass(slots.length)} gap-2 bg-maestro-bg p-2`}>
      {slots.map((slot) =>
        slot.sessionId !== null ? (
          <TerminalView
            key={slot.id}
            sessionId={slot.sessionId}
            isFocused={focusedSlotId === slot.id}
            isActive={isActive}
            onFocus={getFocusCallback(slot.id)}
            onKill={handleKill}
          />
        ) : (
          <PreLaunchCard
            key={slot.id}
            slot={slot}
            projectPath={projectPath ?? ""}
            branches={branches}
            isLoadingBranches={isLoadingBranches}
            isGitRepo={isGitRepo}
            mcpServers={mcpServers}
            skills={skills}
            plugins={plugins}
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
          />
        )
      )}
    </div>
  );
});
