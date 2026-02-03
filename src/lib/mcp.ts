/**
 * Thin wrappers around Tauri `invoke` for MCP server discovery and configuration.
 *
 * Each function maps 1:1 to a Rust `#[tauri::command]` handler.
 */

import { invoke } from "@tauri-apps/api/core";

/** Environment variables for stdio MCP servers. */
export type McpEnv = Record<string, string>;

/**
 * A custom MCP server configured by the user.
 * Stored globally (user-level) and available across all projects.
 */
export interface McpCustomServer {
  /** Unique identifier for the custom server. */
  id: string;
  /** Display name for the server. */
  name: string;
  /** Command to run (e.g., "npx", "node", "python"). */
  command: string;
  /** Arguments to pass to the command. */
  args: string[];
  /** Environment variables for the server process. */
  env: McpEnv;
  /** Working directory for the server process. */
  workingDirectory?: string;
  /** Whether this server is enabled by default. */
  isEnabled: boolean;
  /** ISO timestamp of when the server was created. */
  createdAt: string;
}

/**
 * Stdio MCP server config (flattened from backend).
 * The backend uses `#[serde(flatten)]` so type fields are at the root level.
 */
export interface McpStdioServerConfig {
  name: string;
  type: "stdio";
  command: string;
  args: string[];
  env: McpEnv;
}

/**
 * HTTP MCP server config (flattened from backend).
 * The backend uses `#[serde(flatten)]` so type fields are at the root level.
 */
export interface McpHttpServerConfig {
  name: string;
  type: "http";
  url: string;
}

/** Union of all MCP server config types. */
export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

/**
 * Discovers MCP servers configured in the project's `.mcp.json`.
 * Results are cached by the backend.
 */
export async function getProjectMcpServers(projectPath: string): Promise<McpServerConfig[]> {
  return invoke<McpServerConfig[]>("get_project_mcp_servers", { projectPath });
}

/**
 * Re-parses the `.mcp.json` file for a project, updating the cache.
 */
export async function refreshProjectMcpServers(projectPath: string): Promise<McpServerConfig[]> {
  return invoke<McpServerConfig[]>("refresh_project_mcp_servers", { projectPath });
}

/**
 * Gets the enabled MCP server names for a specific session.
 * If not explicitly set, returns all available servers.
 */
export async function getSessionMcpServers(
  projectPath: string,
  sessionId: number
): Promise<string[]> {
  return invoke<string[]>("get_session_mcp_servers", { projectPath, sessionId });
}

/**
 * Sets the enabled MCP server names for a specific session.
 */
export async function setSessionMcpServers(
  projectPath: string,
  sessionId: number,
  enabled: string[]
): Promise<void> {
  return invoke("set_session_mcp_servers", { projectPath, sessionId, enabled });
}

/**
 * Returns the count of enabled MCP servers for a session.
 */
export async function getSessionMcpCount(
  projectPath: string,
  sessionId: number
): Promise<number> {
  return invoke<number>("get_session_mcp_count", { projectPath, sessionId });
}

/**
 * Saves the default enabled MCP servers for a project.
 * These persist across app restarts.
 */
export async function saveProjectMcpDefaults(
  projectPath: string,
  enabledServers: string[]
): Promise<void> {
  return invoke("save_project_mcp_defaults", { projectPath, enabledServers });
}

/**
 * Loads the default enabled MCP servers for a project.
 * Returns null if no defaults have been saved.
 */
export async function loadProjectMcpDefaults(
  projectPath: string
): Promise<string[] | null> {
  return invoke<string[] | null>("load_project_mcp_defaults", { projectPath });
}

/**
 * Writes a session-specific `.mcp.json` to the working directory.
 *
 * This MUST be called BEFORE launching the Claude CLI so it can discover
 * the configured MCP servers, including the Maestro status server.
 *
 * @param workingDir - Directory where the CLI will be launched
 * @param sessionId - Session ID for the Maestro MCP server env vars
 * @param projectPath - Project path for hash generation and server lookup
 * @param enabledServerNames - Names of MCP servers enabled for this session
 */
export async function writeSessionMcpConfig(
  workingDir: string,
  sessionId: number,
  projectPath: string,
  enabledServerNames: string[]
): Promise<void> {
  return invoke("write_session_mcp_config", {
    workingDir,
    sessionId,
    projectPath,
    enabledServerNames,
  });
}

/**
 * Removes a session-specific Maestro server from `.mcp.json`.
 *
 * This should be called when a session is killed to clean up the config file.
 * The function is idempotent - it does nothing if the session entry doesn't exist.
 *
 * @param workingDir - Directory containing the `.mcp.json` file
 * @param sessionId - Session ID to remove from the config
 */
export async function removeSessionMcpConfig(
  workingDir: string,
  sessionId: number,
): Promise<void> {
  return invoke("remove_session_mcp_config", { workingDir, sessionId });
}

/**
 * Gets all custom MCP servers configured by the user.
 * Custom servers are stored globally and available across all projects.
 */
export async function getCustomMcpServers(): Promise<McpCustomServer[]> {
  return invoke<McpCustomServer[]>("get_custom_mcp_servers");
}

/**
 * Saves a custom MCP server configuration.
 * If the server already exists (by ID), it will be updated.
 */
export async function saveCustomMcpServer(server: McpCustomServer): Promise<void> {
  return invoke("save_custom_mcp_server", { server });
}

/**
 * Deletes a custom MCP server by ID.
 */
export async function deleteCustomMcpServer(serverId: string): Promise<void> {
  return invoke("delete_custom_mcp_server", { serverId });
}

/**
 * Status server information returned from the backend.
 */
export interface StatusServerInfo {
  /** Port the status server is listening on. */
  port: number;
  /** Full URL for posting status updates. */
  statusUrl: string;
  /** Instance ID for this Maestro app instance. */
  instanceId: string;
  /** Path to the maestro-mcp-server binary, if found. */
  mcpBinaryPath: string | null;
}

/**
 * Gets the status server info (URL, port, instance ID, and binary path).
 * Used to display MCP server status in the sidebar.
 */
export async function getStatusServerInfo(): Promise<StatusServerInfo> {
  return invoke<StatusServerInfo>("get_status_server_info");
}
