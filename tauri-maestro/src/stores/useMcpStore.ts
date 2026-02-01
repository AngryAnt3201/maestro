/**
 * Zustand store for MCP server discovery and session-enabled state.
 *
 * Tracks discovered MCP servers per project and which servers are enabled
 * for each session.
 */

import { create } from "zustand";

import {
  getProjectMcpServers,
  refreshProjectMcpServers,
  setSessionMcpServers as setSessionMcpServersApi,
  saveProjectMcpDefaults,
  loadProjectMcpDefaults,
  type McpServerConfig,
} from "@/lib/mcp";

/** Key for session-enabled lookup: "projectPath:sessionId" */
function sessionKey(projectPath: string, sessionId: number): string {
  return `${projectPath}:${sessionId}`;
}

interface McpState {
  /** MCP servers discovered per project path. */
  projectServers: Record<string, McpServerConfig[]>;

  /** Enabled server names per session (keyed by "projectPath:sessionId"). */
  sessionEnabled: Record<string, string[]>;

  /** Persisted default server names per project (loaded from store). */
  projectDefaults: Record<string, string[] | null>;

  /** Loading state per project. */
  isLoading: Record<string, boolean>;

  /** Error state per project. */
  errors: Record<string, string | null>;

  /**
   * Fetches MCP servers for a project (uses cache on backend).
   * Updates the store with discovered servers.
   */
  fetchProjectServers: (projectPath: string) => Promise<McpServerConfig[]>;

  /**
   * Refreshes MCP servers for a project (re-parses .mcp.json).
   */
  refreshProjectServers: (projectPath: string) => Promise<McpServerConfig[]>;

  /**
   * Gets the enabled server names for a session.
   * Returns all servers if not explicitly set.
   */
  getSessionEnabled: (projectPath: string, sessionId: number) => string[];

  /**
   * Sets the enabled server names for a session.
   * Updates both local state and backend.
   */
  setSessionEnabled: (
    projectPath: string,
    sessionId: number,
    enabled: string[]
  ) => Promise<void>;

  /**
   * Toggles a specific server for a session.
   */
  toggleSessionServer: (
    projectPath: string,
    sessionId: number,
    serverName: string
  ) => Promise<void>;

  /**
   * Gets the count of enabled MCP servers for a session.
   */
  getEnabledCount: (projectPath: string, sessionId: number) => number;

  /**
   * Gets the total count of available MCP servers for a project.
   */
  getTotalCount: (projectPath: string) => number;

  /**
   * Clears session-enabled state when a session is closed.
   */
  clearSession: (projectPath: string, sessionId: number) => void;
}

export const useMcpStore = create<McpState>()((set, get) => ({
  projectServers: {},
  sessionEnabled: {},
  projectDefaults: {},
  isLoading: {},
  errors: {},

  fetchProjectServers: async (projectPath: string) => {
    set((state) => ({
      isLoading: { ...state.isLoading, [projectPath]: true },
      errors: { ...state.errors, [projectPath]: null },
    }));

    try {
      // Fetch servers and load persisted defaults in parallel
      const [servers, defaults] = await Promise.all([
        getProjectMcpServers(projectPath),
        loadProjectMcpDefaults(projectPath),
      ]);

      set((state) => ({
        projectServers: { ...state.projectServers, [projectPath]: servers },
        projectDefaults: { ...state.projectDefaults, [projectPath]: defaults },
        isLoading: { ...state.isLoading, [projectPath]: false },
      }));
      return servers;
    } catch (err) {
      const errorMsg = String(err);
      console.error("Failed to fetch MCP servers:", err);
      set((state) => ({
        isLoading: { ...state.isLoading, [projectPath]: false },
        errors: { ...state.errors, [projectPath]: errorMsg },
      }));
      return [];
    }
  },

  refreshProjectServers: async (projectPath: string) => {
    set((state) => ({
      isLoading: { ...state.isLoading, [projectPath]: true },
      errors: { ...state.errors, [projectPath]: null },
    }));

    try {
      const servers = await refreshProjectMcpServers(projectPath);
      set((state) => ({
        projectServers: { ...state.projectServers, [projectPath]: servers },
        isLoading: { ...state.isLoading, [projectPath]: false },
      }));
      return servers;
    } catch (err) {
      const errorMsg = String(err);
      console.error("Failed to refresh MCP servers:", err);
      set((state) => ({
        isLoading: { ...state.isLoading, [projectPath]: false },
        errors: { ...state.errors, [projectPath]: errorMsg },
      }));
      return [];
    }
  },

  getSessionEnabled: (projectPath: string, sessionId: number) => {
    const key = sessionKey(projectPath, sessionId);
    const state = get();

    // If explicitly set for this session, return that
    if (state.sessionEnabled[key] !== undefined) {
      return state.sessionEnabled[key];
    }

    // Use persisted project defaults if available
    const defaults = state.projectDefaults[projectPath];
    if (defaults !== undefined && defaults !== null) {
      return defaults;
    }

    // Final fallback: all servers enabled
    const servers = state.projectServers[projectPath] ?? [];
    return servers.map((s) => s.name);
  },

  setSessionEnabled: async (
    projectPath: string,
    sessionId: number,
    enabled: string[]
  ) => {
    const key = sessionKey(projectPath, sessionId);

    // Update local state optimistically (both session and project defaults)
    set((state) => ({
      sessionEnabled: { ...state.sessionEnabled, [key]: enabled },
      projectDefaults: { ...state.projectDefaults, [projectPath]: enabled },
    }));

    // Persist to backend (session state and project defaults)
    try {
      await Promise.all([
        setSessionMcpServersApi(projectPath, sessionId, enabled),
        saveProjectMcpDefaults(projectPath, enabled),
      ]);
    } catch (err) {
      console.error("Failed to save session MCP servers:", err);
    }
  },

  toggleSessionServer: async (
    projectPath: string,
    sessionId: number,
    serverName: string
  ) => {
    const currentEnabled = get().getSessionEnabled(projectPath, sessionId);
    const isEnabled = currentEnabled.includes(serverName);

    const newEnabled = isEnabled
      ? currentEnabled.filter((n) => n !== serverName)
      : [...currentEnabled, serverName];

    await get().setSessionEnabled(projectPath, sessionId, newEnabled);
  },

  getEnabledCount: (projectPath: string, sessionId: number) => {
    return get().getSessionEnabled(projectPath, sessionId).length;
  },

  getTotalCount: (projectPath: string) => {
    return (get().projectServers[projectPath] ?? []).length;
  },

  clearSession: (projectPath: string, sessionId: number) => {
    const key = sessionKey(projectPath, sessionId);
    set((state) => {
      const { [key]: _, ...rest } = state.sessionEnabled;
      return { sessionEnabled: rest };
    });
  },
}));
