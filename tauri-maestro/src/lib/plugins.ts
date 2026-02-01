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

/** Union of all plugin config types. */
export type PluginConfig =
  | BuiltinPluginConfig
  | ProjectPluginConfig
  | InstalledPluginConfig
  | MarketplacePluginConfig;

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
export async function getSessionSkills(
  projectPath: string,
  sessionId: number
): Promise<string[]> {
  return invoke<string[]>("get_session_skills", { projectPath, sessionId });
}

/**
 * Sets the enabled skill IDs for a specific session.
 */
export async function setSessionSkills(
  projectPath: string,
  sessionId: number,
  enabled: string[]
): Promise<void> {
  return invoke("set_session_skills", { projectPath, sessionId, enabled });
}

/**
 * Gets the enabled plugin IDs for a specific session.
 * If not explicitly set, returns plugins where enabled_by_default is true.
 */
export async function getSessionPlugins(
  projectPath: string,
  sessionId: number
): Promise<string[]> {
  return invoke<string[]>("get_session_plugins", { projectPath, sessionId });
}

/**
 * Sets the enabled plugin IDs for a specific session.
 */
export async function setSessionPlugins(
  projectPath: string,
  sessionId: number,
  enabled: string[]
): Promise<void> {
  return invoke("set_session_plugins", { projectPath, sessionId, enabled });
}

/**
 * Returns the count of enabled skills for a session.
 */
export async function getSessionSkillsCount(
  projectPath: string,
  sessionId: number
): Promise<number> {
  return invoke<number>("get_session_skills_count", { projectPath, sessionId });
}

/**
 * Returns the count of enabled plugins for a session.
 */
export async function getSessionPluginsCount(
  projectPath: string,
  sessionId: number
): Promise<number> {
  return invoke<number>("get_session_plugins_count", { projectPath, sessionId });
}

/**
 * Saves the default enabled skills for a project.
 * These persist across app restarts.
 */
export async function saveProjectSkillDefaults(
  projectPath: string,
  enabledSkills: string[]
): Promise<void> {
  return invoke("save_project_skill_defaults", { projectPath, enabledSkills });
}

/**
 * Loads the default enabled skills for a project.
 * Returns null if no defaults have been saved.
 */
export async function loadProjectSkillDefaults(
  projectPath: string
): Promise<string[] | null> {
  return invoke<string[] | null>("load_project_skill_defaults", { projectPath });
}

/**
 * Saves the default enabled plugins for a project.
 * These persist across app restarts.
 */
export async function saveProjectPluginDefaults(
  projectPath: string,
  enabledPlugins: string[]
): Promise<void> {
  return invoke("save_project_plugin_defaults", { projectPath, enabledPlugins });
}

/**
 * Loads the default enabled plugins for a project.
 * Returns null if no defaults have been saved.
 */
export async function loadProjectPluginDefaults(
  projectPath: string
): Promise<string[] | null> {
  return invoke<string[] | null>("load_project_plugin_defaults", { projectPath });
}
