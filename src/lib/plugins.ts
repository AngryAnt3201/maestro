/**
 * Thin wrappers around Tauri `invoke` for plugin/skill discovery and configuration.
 *
 * Each function maps 1:1 to a Rust `#[tauri::command]` handler.
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * Source of a skill - where it was discovered from.
 */
export type SkillSource =
  | { type: "project" }
  | { type: "personal" }
  | { type: "plugin"; name: string }
  | { type: "legacy" };

/**
 * Common fields shared by all skill config types.
 */
interface BaseSkillConfig {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  plugin_id: string | null;
  source: SkillSource;
  /** Path to the skill file (SKILL.md or command.md). */
  path: string | null;

  // Frontmatter fields
  /** Hint shown during autocomplete (e.g., "[issue-number]"). */
  argument_hint: string | null;
  /** If true, Claude won't auto-invoke this skill. */
  disable_model_invocation: boolean;
  /** If false, hide from the / menu (default true). */
  user_invocable: boolean;
  /** Tools that don't require permission prompts. */
  allowed_tools: string | null;
  /** Model override for this skill. */
  model: string | null;
  /** Run context ("fork" for subagent). */
  context: string | null;
  /** Subagent type when context="fork". */
  agent: string | null;
}

/**
 * Prompt-based skill config (flattened from backend).
 * The backend uses `#[serde(flatten)]` so type fields are at the root level.
 */
export interface PromptSkillConfig extends BaseSkillConfig {
  skill_type: "prompt";
  prompt: string;
}

/**
 * File-based skill config (flattened from backend).
 */
export interface FileSkillConfig extends BaseSkillConfig {
  skill_type: "file";
}

/**
 * Command-based skill config (flattened from backend).
 */
export interface CommandSkillConfig extends BaseSkillConfig {
  skill_type: "command";
  command: string;
  args: string[];
}

/** Union of all skill config types. */
export type SkillConfig = PromptSkillConfig | FileSkillConfig | CommandSkillConfig;

/** Hook configuration. */
export interface HookConfig {
  event: string;
  command: string;
  args: string[];
}

/**
 * Common fields shared by all plugin config types.
 */
interface BasePluginConfig {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string | null;
  /** Claude CLI plugin ID (e.g. "name@marketplace") for enabledPlugins config. */
  cli_id: string | null;
  skills: string[];
  mcp_servers: string[];
  hooks: HookConfig[];
  enabled_by_default: boolean;
  /** Path to the plugin directory. */
  path: string | null;
}

/**
 * Plugin config with builtin source.
 */
export interface BuiltinPluginConfig extends BasePluginConfig {
  plugin_source: "builtin";
}

/**
 * Plugin config with project source (legacy .plugins.json).
 */
export interface ProjectPluginConfig extends BasePluginConfig {
  plugin_source: "project";
}

/**
 * Plugin config with installed source (~/.claude/plugins/).
 */
export interface InstalledPluginConfig extends BasePluginConfig {
  plugin_source: "installed";
}

/**
 * Plugin config with marketplace source.
 */
export interface MarketplacePluginConfig extends BasePluginConfig {
  plugin_source: "marketplace";
  url: string;
}

/**
 * Plugin config installed via Claude CLI (from installed_plugins.json / cache).
 */
export interface CliInstalledPluginConfig extends BasePluginConfig {
  plugin_source: "cli_installed";
}

/** Union of all plugin config types. */
export type PluginConfig =
  | BuiltinPluginConfig
  | ProjectPluginConfig
  | InstalledPluginConfig
  | MarketplacePluginConfig
  | CliInstalledPluginConfig;

/** Combined result of plugin discovery for a project. */
export interface ProjectPlugins {
  skills: SkillConfig[];
  plugins: PluginConfig[];
}

/**
 * Discovers plugins/skills configured in the project's `.plugins.json`.
 * Results are cached by the backend.
 */
export async function getProjectPlugins(projectPath: string): Promise<ProjectPlugins> {
  return invoke<ProjectPlugins>("get_project_plugins", { projectPath });
}

/**
 * Re-parses the `.plugins.json` file for a project, updating the cache.
 */
export async function refreshProjectPlugins(projectPath: string): Promise<ProjectPlugins> {
  return invoke<ProjectPlugins>("refresh_project_plugins", { projectPath });
}

/**
 * Gets the enabled skill IDs for a specific session.
 * If not explicitly set, returns all available skills.
 */
export async function getSessionSkills(projectPath: string, sessionId: number): Promise<string[]> {
  return invoke<string[]>("get_session_skills", { projectPath, sessionId });
}

/**
 * Sets the enabled skill IDs for a specific session.
 */
export async function setSessionSkills(
  projectPath: string,
  sessionId: number,
  enabled: string[],
): Promise<void> {
  return invoke("set_session_skills", { projectPath, sessionId, enabled });
}

/**
 * Gets the enabled plugin IDs for a specific session.
 * If not explicitly set, returns plugins where enabled_by_default is true.
 */
export async function getSessionPlugins(projectPath: string, sessionId: number): Promise<string[]> {
  return invoke<string[]>("get_session_plugins", { projectPath, sessionId });
}

/**
 * Sets the enabled plugin IDs for a specific session.
 */
export async function setSessionPlugins(
  projectPath: string,
  sessionId: number,
  enabled: string[],
): Promise<void> {
  return invoke("set_session_plugins", { projectPath, sessionId, enabled });
}

/**
 * Returns the count of enabled skills for a session.
 */
export async function getSessionSkillsCount(
  projectPath: string,
  sessionId: number,
): Promise<number> {
  return invoke<number>("get_session_skills_count", { projectPath, sessionId });
}

/**
 * Returns the count of enabled plugins for a session.
 */
export async function getSessionPluginsCount(
  projectPath: string,
  sessionId: number,
): Promise<number> {
  return invoke<number>("get_session_plugins_count", { projectPath, sessionId });
}

/**
 * Saves the default enabled skills for a project.
 * These persist across app restarts.
 */
export async function saveProjectSkillDefaults(
  projectPath: string,
  enabledSkills: string[],
): Promise<void> {
  return invoke("save_project_skill_defaults", { projectPath, enabledSkills });
}

/**
 * Loads the default enabled skills for a project.
 * Returns null if no defaults have been saved.
 */
export async function loadProjectSkillDefaults(projectPath: string): Promise<string[] | null> {
  return invoke<string[] | null>("load_project_skill_defaults", { projectPath });
}

/**
 * Saves the default enabled plugins for a project.
 * These persist across app restarts.
 */
export async function saveProjectPluginDefaults(
  projectPath: string,
  enabledPlugins: string[],
): Promise<void> {
  return invoke("save_project_plugin_defaults", { projectPath, enabledPlugins });
}

/**
 * Loads the default enabled plugins for a project.
 * Returns null if no defaults have been saved.
 */
export async function loadProjectPluginDefaults(projectPath: string): Promise<string[] | null> {
  return invoke<string[] | null>("load_project_plugin_defaults", { projectPath });
}

/**
 * Writes plugin enabled/disabled state to the session's .claude/settings.local.json.
 *
 * Uses Claude CLI's `enabledPlugins` format to control which plugins are active.
 * Resolves Maestro internal plugin IDs to CLI plugin IDs (e.g. "name@marketplace").
 */
export async function writeSessionPluginConfig(
  workingDir: string,
  projectPath: string,
  enabledPluginIds: string[],
): Promise<void> {
  return invoke("write_session_plugin_config", { workingDir, projectPath, enabledPluginIds });
}

/**
 * Removes the plugins array from the session's .claude/settings.local.json.
 *
 * This should be called when a session is killed to clean up.
 */
export async function removeSessionPluginConfig(workingDir: string): Promise<void> {
  return invoke("remove_session_plugin_config", { workingDir });
}

/**
 * Deletes a skill directory from the filesystem.
 *
 * Only allows deletion of paths within .claude/skills/ (project) or ~/.claude/skills/ (personal).
 */
export async function deleteSkill(skillPath: string): Promise<void> {
  return invoke("delete_skill", { skillPath });
}

/**
 * Deletes a plugin directory from the filesystem.
 *
 * Only allows deletion of paths within .claude/plugins/ (project) or ~/.claude/plugins/ (personal).
 */
export async function deletePlugin(pluginPath: string): Promise<void> {
  return invoke("delete_plugin", { pluginPath });
}

/**
 * Configuration stored per branch for a project.
 * This allows different branches to have different plugin/skill/MCP configurations.
 */
export interface BranchConfig {
  enabled_plugins: string[];
  enabled_skills: string[];
  enabled_mcp_servers: string[];
}

/**
 * Saves the plugin/skill/MCP configuration for a specific branch.
 *
 * This allows per-branch configuration persistence. When a user selects
 * a branch and configures plugins, that configuration is remembered
 * for future sessions on the same branch.
 */
export async function saveBranchConfig(
  projectPath: string,
  branch: string,
  config: BranchConfig,
): Promise<void> {
  return invoke("save_branch_config", {
    projectPath,
    branch,
    enabledPlugins: config.enabled_plugins,
    enabledSkills: config.enabled_skills,
    enabledMcpServers: config.enabled_mcp_servers,
  });
}

/**
 * Loads the plugin/skill/MCP configuration for a specific branch.
 *
 * Returns null if no configuration has been saved for this branch yet.
 */
export async function loadBranchConfig(
  projectPath: string,
  branch: string,
): Promise<BranchConfig | null> {
  return invoke<BranchConfig | null>("load_branch_config", { projectPath, branch });
}
