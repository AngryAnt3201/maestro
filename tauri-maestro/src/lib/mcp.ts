/**
 * Thin wrappers around Tauri `invoke` for MCP server discovery and configuration.
 *
 * Each function maps 1:1 to a Rust `#[tauri::command]` handler.
 */

import { invoke } from "@tauri-apps/api/core";

/** Environment variables for stdio MCP servers. */
export type McpEnv = Record<string, string>;

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
