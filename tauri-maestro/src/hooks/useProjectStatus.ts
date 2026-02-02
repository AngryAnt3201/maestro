import { useMemo } from "react";
import { useSessionStore, type BackendSessionStatus } from "@/stores/useSessionStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";

/**
 * Aggregated status for a project, derived from its sessions.
 * Priority order: Working > NeedsInput > Error > Done > Starting > Idle
 */
export type ProjectStatus =
  | "idle"
  | "starting"
  | "working"
  | "needs-input"
  | "done"
  | "error";

/**
 * Maps backend session status to CSS color class names.
 */
export const STATUS_COLORS: Record<ProjectStatus, string> = {
  idle: "bg-maestro-muted",
  starting: "bg-orange-500",
  working: "bg-maestro-accent",
  "needs-input": "bg-yellow-500",
  done: "bg-maestro-green",
  error: "bg-red-500",
};

/**
 * Hook to get the aggregated status for a project tab.
 * Derives status from all sessions belonging to the project.
 */
export function useProjectStatus(tabId: string): {
  status: ProjectStatus;
  sessionCount: number;
  activeSessionCount: number;
} {
  const tab = useWorkspaceStore((s) => s.tabs.find((t) => t.id === tabId));
  const sessions = useSessionStore((s) => s.sessions);

  return useMemo(() => {
    if (!tab) {
      return { status: "idle" as ProjectStatus, sessionCount: 0, activeSessionCount: 0 };
    }

    // Filter by both session ID and project_path to prevent cross-project session matching
    // This guards against session ID collision when IDs reset after app restart
    const projectSessions = sessions.filter(
      (s) => tab.sessionIds.includes(s.id) && s.project_path === tab.projectPath
    );
    const sessionCount = projectSessions.length;

    if (sessionCount === 0) {
      return { status: "idle" as ProjectStatus, sessionCount: 0, activeSessionCount: 0 };
    }

    // Count active sessions (not Done or Error)
    const activeSessionCount = projectSessions.filter(
      (s) => s.status !== "Done" && s.status !== "Error"
    ).length;

    // Priority-based status aggregation
    const hasStatus = (status: BackendSessionStatus) =>
      projectSessions.some((s) => s.status === status);

    let status: ProjectStatus;
    if (hasStatus("Working")) {
      status = "working";
    } else if (hasStatus("NeedsInput")) {
      status = "needs-input";
    } else if (hasStatus("Error")) {
      status = "error";
    } else if (projectSessions.every((s) => s.status === "Done")) {
      status = "done";
    } else if (hasStatus("Starting")) {
      status = "starting";
    } else {
      status = "idle";
    }

    return { status, sessionCount, activeSessionCount };
  }, [tab, sessions]);
}
