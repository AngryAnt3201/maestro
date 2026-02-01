import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { getBranchesWithWorktreeStatus, type BranchWithWorktreeStatus } from "@/lib/git";
import { killSession, spawnShell } from "@/lib/terminal";
import { cleanupSessionWorktree, prepareSessionWorktree } from "@/lib/worktreeManager";
import type { AiMode } from "@/stores/useSessionStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { PreLaunchCard, type SessionSlot } from "./PreLaunchCard";
import { TerminalView } from "./TerminalView";

/** Hard ceiling on concurrent PTY sessions per grid to bound resource usage. */
const MAX_SESSIONS = 6;

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
function createEmptySlot(): SessionSlot {
  return {
    id: generateSlotId(),
    mode: "Claude",
    branch: null,
    sessionId: null,
    worktreePath: null,
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
  { projectPath, tabId, preserveOnHide = false, onSessionCountChange },
  ref,
) {
  const addSessionToProject = useWorkspaceStore((s) => s.addSessionToProject);
  const removeSessionFromProject = useWorkspaceStore((s) => s.removeSessionFromProject);

  // Track session slots (pre-launch and launched)
  const [slots, setSlots] = useState<SessionSlot[]>(() => [createEmptySlot()]);
  const [error, setError] = useState<string | null>(null);

  // Git branch data
  const [branches, setBranches] = useState<BranchWithWorktreeStatus[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [isGitRepo, setIsGitRepo] = useState(true);

  // Refs for cleanup
  const slotsRef = useRef<SessionSlot[]>([]);
  const mounted = useRef(false);

  // Sync refs with state and report counts to parent
  useEffect(() => {
    slotsRef.current = slots;
    const launchedCount = slots.filter((s) => s.sessionId !== null).length;
    onSessionCountChange?.(slots.length, launchedCount);
  }, [slots, onSessionCountChange]);

  // Fetch branches when projectPath is available
  useEffect(() => {
    if (!projectPath) {
      setIsGitRepo(false);
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
  }, [projectPath]);

  // Mark as mounted after first render
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
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
      setSlots([createEmptySlot()]);
    }
  }, [slots.length, error]);

  /**
   * Launches a single slot by spawning a shell with the configured settings.
   * If a branch is selected, prepares a worktree for that branch first.
   */
  const launchSlot = useCallback(async (slotId: string) => {
    const slot = slotsRef.current.find((s) => s.id === slotId);
    if (!slot || slot.sessionId !== null) return;

    try {
      // Determine the working directory
      // If a branch is selected, prepare a worktree first
      let workingDirectory = projectPath;
      let worktreePath: string | null = null;

      if (projectPath && slot.branch) {
        const result = await prepareSessionWorktree(projectPath, slot.branch);
        workingDirectory = result.working_directory;
        worktreePath = result.worktree_path;
      }

      // Spawn the shell in the correct directory (worktree or project path)
      const sessionId = await spawnShell(workingDirectory);

      setSlots((prev) =>
        prev.map((s) =>
          s.id === slotId ? { ...s, sessionId, worktreePath } : s
        )
      );

      // Register session with the project
      if (tabId) {
        addSessionToProject(tabId, sessionId);
      }
    } catch (err) {
      console.error("Failed to spawn shell:", err);
      setError("Failed to start terminal session");
    }
  }, [projectPath, tabId, addSessionToProject]);

  /**
   * Launches all unlaunched slots sequentially.
   */
  const launchAll = useCallback(async () => {
    const unlaunchedSlots = slotsRef.current.filter((s) => s.sessionId === null);
    for (const slot of unlaunchedSlots) {
      await launchSlot(slot.id);
    }
  }, [launchSlot]);

  /**
   * Handles killing/closing a session, updating the slot state.
   * Also cleans up any associated worktree.
   */
  const handleKill = useCallback((sessionId: number) => {
    // Find the slot to get worktree path before removing
    const slot = slotsRef.current.find((s) => s.sessionId === sessionId);
    const worktreePath = slot?.worktreePath;

    setSlots((prev) => prev.filter((s) => s.sessionId !== sessionId));

    // Unregister session from the project
    if (tabId) {
      removeSessionFromProject(tabId, sessionId);
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
   */
  const updateSlotBranch = useCallback((slotId: string, branch: string | null) => {
    setSlots((prev) =>
      prev.map((s) =>
        s.id === slotId ? { ...s, branch } : s
      )
    );
  }, []);

  /**
   * Adds a new pre-launch slot to the grid.
   */
  const addSession = useCallback(() => {
    if (slotsRef.current.length >= MAX_SESSIONS) return;
    setSlots((prev) => {
      if (prev.length >= MAX_SESSIONS) return prev;
      return [...prev, createEmptySlot()];
    });
  }, []);

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
          <TerminalView key={slot.id} sessionId={slot.sessionId} onKill={handleKill} />
        ) : (
          <PreLaunchCard
            key={slot.id}
            slot={slot}
            projectPath={projectPath ?? ""}
            branches={branches}
            isLoadingBranches={isLoadingBranches}
            isGitRepo={isGitRepo}
            onModeChange={(mode) => updateSlotMode(slot.id, mode)}
            onBranchChange={(branch) => updateSlotBranch(slot.id, branch)}
            onLaunch={() => launchSlot(slot.id)}
            onRemove={() => removeSlot(slot.id)}
          />
        )
      )}
    </div>
  );
});
