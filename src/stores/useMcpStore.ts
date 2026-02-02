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
  getCustomMcpServers,
  saveCustomMcpServer,
  deleteCustomMcpServer as deleteCustomMcpServerApi,
  type McpServerConfig,
  type McpCustomServer,
} from "@/lib/mcp";

/** Key for session-enabled lookup: "projectPath:sessionId" */
function sessionKey(projectPath: string, sessionId: number): string {
  return `${projectPath}:${sessionId}`;
}

interface McpState {
  /** MCP servers discovered per project path. */
  projectServers: Record<string, McpServerConfig[]>;

  /** Custom MCP servers configured by the user (global, user-level). */
  customServers: McpCustomServer[];

  /** Whether custom servers have been loaded. */
  customServersLoaded: boolean;

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

  /**
   * Fetches custom MCP servers from the backend.
   */
  fetchCustomServers: () => Promise<McpCustomServer[]>;

  /**
   * Adds or updates a custom MCP server.
   */
  addCustomServer: (server: McpCustomServer) => Promise<void>;

  /**
   * Updates an existing custom MCP server.
   */
  updateCustomServer: (server: McpCustomServer) => Promise<void>;

  /**
   * Deletes a custom MCP server by ID.
   */
  deleteCustomServer: (serverId: string) => Promise<void>;

  /**
   * Gets all servers (discovered + custom) for a project.
   */
  getAllServers: (projectPath: string) => McpServerConfig[];
}

export const useMcpStore = create<McpState>()((set, get) => ({
  projectServers: {},
  customServers: [],
  customServersLoaded: false,
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

  fetchCustomServers: async () => {
    try {
      const servers = await getCustomMcpServers();
      set({ customServers: servers, customServersLoaded: true });
      return servers;
    } catch (err) {
      console.error("Failed to fetch custom MCP servers:", err);
      return [];
    }
  },

  addCustomServer: async (server: McpCustomServer) => {
    // Optimistically update local state
    set((state) => ({
      customServers: [...state.customServers, server],
    }));

    try {
      await saveCustomMcpServer(server);
    } catch (err) {
      console.error("Failed to save custom MCP server:", err);
      // Revert on error
      set((state) => ({
        customServers: state.customServers.filter((s) => s.id !== server.id),
      }));
      throw err;
    }
  },

  updateCustomServer: async (server: McpCustomServer) => {
    const state = get();
    const previousServers = state.customServers;

    // Optimistically update local state
    set((state) => ({
      customServers: state.customServers.map((s) =>
        s.id === server.id ? server : s
      ),
    }));

    try {
      await saveCustomMcpServer(server);
    } catch (err) {
      console.error("Failed to update custom MCP server:", err);
      // Revert on error
      set({ customServers: previousServers });
      throw err;
    }
  },

  deleteCustomServer: async (serverId: string) => {
    const state = get();
    const previousServers = state.customServers;

    // Optimistically update local state
    set((state) => ({
      customServers: state.customServers.filter((s) => s.id !== serverId),
    }));

    try {
      await deleteCustomMcpServerApi(serverId);
    } catch (err) {
      console.error("Failed to delete custom MCP server:", err);
      // Revert on error
      set({ customServers: previousServers });
      throw err;
    }
  },

  getAllServers: (projectPath: string) => {
    const state = get();
    const discoveredServers = state.projectServers[projectPath] ?? [];
    const enabledCustomServers = state.customServers.filter((s) => s.isEnabled);

    // Convert custom servers to McpServerConfig format
    const customServerConfigs: McpServerConfig[] = enabledCustomServers.map(
      (custom) => ({
        name: custom.name,
        type: "stdio" as const,
        command: custom.command,
        args: custom.args,
        env: custom.env,
      })
    );

    return [...discoveredServers, ...customServerConfigs];
  },
}));
