//! IPC commands for plugin/skill discovery and session configuration.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_store::StoreExt;

/// Configuration stored per branch for a project.
/// This allows different branches to have different plugin/skill/MCP configurations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchConfig {
    pub enabled_plugins: Vec<String>,
    pub enabled_skills: Vec<String>,
    pub enabled_mcp_servers: Vec<String>,
}

use crate::commands::shared::{canonicalize_path, hash_project_path};
use crate::core::plugin_config_writer;
use crate::core::plugin_manager::{PluginManager, ProjectPlugins};

/// Discovers and returns plugins/skills configured in the project's `.plugins.json`.
///
/// The project path is canonicalized before lookup. Results are cached.
#[tauri::command]
pub async fn get_project_plugins(
    state: State<'_, PluginManager>,
    project_path: String,
) -> Result<ProjectPlugins, String> {
    let canonical = canonicalize_path(&project_path)?;

    Ok(state.get_project_plugins(&canonical))
}

/// Re-parses the `.plugins.json` file for a project, updating the cache.
#[tauri::command]
pub async fn refresh_project_plugins(
    state: State<'_, PluginManager>,
    project_path: String,
) -> Result<ProjectPlugins, String> {
    let canonical = canonicalize_path(&project_path)?;

    Ok(state.refresh_project_plugins(&canonical))
}

/// Gets the enabled skill IDs for a specific session.
///
/// If not explicitly set, returns all available skills as enabled.
#[tauri::command]
pub async fn get_session_skills(
    state: State<'_, PluginManager>,
    project_path: String,
    session_id: u32,
) -> Result<Vec<String>, String> {
    let canonical = canonicalize_path(&project_path)?;

    Ok(state.get_session_skills(&canonical, session_id))
}

/// Sets the enabled skill IDs for a specific session.
#[tauri::command]
pub async fn set_session_skills(
    state: State<'_, PluginManager>,
    project_path: String,
    session_id: u32,
    enabled: Vec<String>,
) -> Result<(), String> {
    let canonical = canonicalize_path(&project_path)?;

    state.set_session_skills(&canonical, session_id, enabled);
    Ok(())
}

/// Gets the enabled plugin IDs for a specific session.
///
/// If not explicitly set, returns plugins where enabled_by_default is true.
#[tauri::command]
pub async fn get_session_plugins(
    state: State<'_, PluginManager>,
    project_path: String,
    session_id: u32,
) -> Result<Vec<String>, String> {
    let canonical = canonicalize_path(&project_path)?;

    Ok(state.get_session_plugins(&canonical, session_id))
}

/// Sets the enabled plugin IDs for a specific session.
#[tauri::command]
pub async fn set_session_plugins(
    state: State<'_, PluginManager>,
    project_path: String,
    session_id: u32,
    enabled: Vec<String>,
) -> Result<(), String> {
    let canonical = canonicalize_path(&project_path)?;

    state.set_session_plugins(&canonical, session_id, enabled);
    Ok(())
}

/// Returns the count of enabled skills for a session.
#[tauri::command]
pub async fn get_session_skills_count(
    state: State<'_, PluginManager>,
    project_path: String,
    session_id: u32,
) -> Result<usize, String> {
    let canonical = canonicalize_path(&project_path)?;

    Ok(state.get_skills_count(&canonical, session_id))
}

/// Returns the count of enabled plugins for a session.
#[tauri::command]
pub async fn get_session_plugins_count(
    state: State<'_, PluginManager>,
    project_path: String,
    session_id: u32,
) -> Result<usize, String> {
    let canonical = canonicalize_path(&project_path)?;

    Ok(state.get_plugins_count(&canonical, session_id))
}

/// Saves the default enabled skills for a project.
///
/// These defaults are loaded when a new session starts, so skill selections
/// persist across app restarts.
#[tauri::command]
pub async fn save_project_skill_defaults(
    app: AppHandle,
    project_path: String,
    enabled_skills: Vec<String>,
) -> Result<(), String> {
    let canonical = canonicalize_path(&project_path)?;

    let store_name = format!("maestro-{}.json", hash_project_path(&canonical));
    let store = app.store(&store_name).map_err(|e| e.to_string())?;

    store.set("enabled_skills", serde_json::json!(enabled_skills));
    store.save().map_err(|e| e.to_string())?;

    log::debug!("Saved skill defaults for project: {}", canonical);
    Ok(())
}

/// Loads the default enabled skills for a project.
///
/// Returns None if no defaults have been saved yet.
#[tauri::command]
pub async fn load_project_skill_defaults(
    app: AppHandle,
    project_path: String,
) -> Result<Option<Vec<String>>, String> {
    let canonical = canonicalize_path(&project_path)?;

    let store_name = format!("maestro-{}.json", hash_project_path(&canonical));
    let store = app.store(&store_name).map_err(|e| e.to_string())?;

    let result = store
        .get("enabled_skills")
        .and_then(|v| v.as_array().cloned())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        });

    Ok(result)
}

/// Saves the default enabled plugins for a project.
///
/// These defaults are loaded when a new session starts, so plugin selections
/// persist across app restarts.
#[tauri::command]
pub async fn save_project_plugin_defaults(
    app: AppHandle,
    project_path: String,
    enabled_plugins: Vec<String>,
) -> Result<(), String> {
    let canonical = canonicalize_path(&project_path)?;

    let store_name = format!("maestro-{}.json", hash_project_path(&canonical));
    let store = app.store(&store_name).map_err(|e| e.to_string())?;

    store.set("enabled_plugins", serde_json::json!(enabled_plugins));
    store.save().map_err(|e| e.to_string())?;

    log::debug!("Saved plugin defaults for project: {}", canonical);
    Ok(())
}

/// Loads the default enabled plugins for a project.
///
/// Returns None if no defaults have been saved yet.
#[tauri::command]
pub async fn load_project_plugin_defaults(
    app: AppHandle,
    project_path: String,
) -> Result<Option<Vec<String>>, String> {
    let canonical = canonicalize_path(&project_path)?;

    let store_name = format!("maestro-{}.json", hash_project_path(&canonical));
    let store = app.store(&store_name).map_err(|e| e.to_string())?;

    let result = store
        .get("enabled_plugins")
        .and_then(|v| v.as_array().cloned())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        });

    Ok(result)
}

/// Writes plugin enabled/disabled state to the session's .claude/settings.local.json.
///
/// Uses Claude CLI's `enabledPlugins` format to control which plugins are active.
/// Resolves Maestro internal plugin IDs to CLI plugin IDs (e.g. "name@marketplace").
#[tauri::command]
pub async fn write_session_plugin_config(
    state: State<'_, PluginManager>,
    working_dir: String,
    project_path: String,
    enabled_plugin_ids: Vec<String>,
) -> Result<(), String> {
    let canonical = canonicalize_path(&project_path)?;

    // Resolve Maestro plugin IDs to CLI enabledPlugins map
    let enabled_plugins_map = state.resolve_enabled_plugins_map(&canonical, &enabled_plugin_ids);

    plugin_config_writer::write_session_plugin_config(Path::new(&working_dir), &enabled_plugins_map)
        .await
}

/// Removes the plugins array from the session's .claude/settings.local.json.
///
/// This should be called when a session is killed to clean up.
#[tauri::command]
pub async fn remove_session_plugin_config(working_dir: String) -> Result<(), String> {
    plugin_config_writer::remove_session_plugin_config(Path::new(&working_dir)).await
}

/// Deletes a skill directory from the filesystem.
///
/// For security, this command only allows deletion of paths that are within:
/// - A project's `.claude/skills/` directory
/// - The user's `~/.claude/skills/` directory
///
/// This prevents accidental or malicious deletion of arbitrary files.
#[tauri::command]
pub async fn delete_skill(skill_path: String) -> Result<(), String> {
    use directories::BaseDirs;

    let skill_path = PathBuf::from(&skill_path);

    // Canonicalize the path to resolve symlinks and relative paths
    let canonical_path = skill_path
        .canonicalize()
        .map_err(|e| format!("Invalid skill path '{}': {}", skill_path.display(), e))?;

    // Get the user's home directory
    let base_dirs = BaseDirs::new()
        .ok_or_else(|| "Could not determine home directory".to_string())?;
    let home_dir = base_dirs.home_dir();

    // Build allowed paths
    let personal_skills_dir = home_dir.join(".claude").join("skills");

    // Check if the path is within allowed directories
    let is_personal_skill = canonical_path.starts_with(&personal_skills_dir);

    // Check if it's a project skill (path contains .claude/skills/)
    let path_str = canonical_path.to_string_lossy();
    let is_project_skill = path_str.contains("/.claude/skills/") || path_str.contains("\\.claude\\skills\\");

    if !is_personal_skill && !is_project_skill {
        return Err(format!(
            "Cannot delete skill: path '{}' is not within .claude/skills/ or ~/.claude/skills/",
            skill_path.display()
        ));
    }

    // Verify it's a directory (skills are directories containing SKILL.md or command files)
    if !canonical_path.is_dir() {
        return Err(format!(
            "Skill path '{}' is not a directory",
            skill_path.display()
        ));
    }

    // Delete the skill directory
    tokio::fs::remove_dir_all(&canonical_path)
        .await
        .map_err(|e| format!("Failed to delete skill '{}': {}", skill_path.display(), e))?;

    log::info!("Deleted skill directory: {}", canonical_path.display());
    Ok(())
}

/// Deletes a plugin directory from the filesystem.
///
/// For security, this command only allows deletion of paths that are within:
/// - The user's `~/.claude/plugins/` directory
/// - A project's `.claude/plugins/` directory
///
/// This prevents accidental or malicious deletion of arbitrary files.
#[tauri::command]
pub async fn delete_plugin(plugin_path: String) -> Result<(), String> {
    use directories::BaseDirs;

    let plugin_path = PathBuf::from(&plugin_path);

    // Canonicalize the path to resolve symlinks and relative paths
    let canonical_path = plugin_path
        .canonicalize()
        .map_err(|e| format!("Invalid plugin path '{}': {}", plugin_path.display(), e))?;

    // Get the user's home directory
    let base_dirs = BaseDirs::new()
        .ok_or_else(|| "Could not determine home directory".to_string())?;
    let home_dir = base_dirs.home_dir();

    // Build allowed paths
    let personal_plugins_dir = home_dir.join(".claude").join("plugins");

    // Check if the path is within allowed directories
    let is_personal_plugin = canonical_path.starts_with(&personal_plugins_dir);

    // Check if it's a project plugin (path contains .claude/plugins/)
    let path_str = canonical_path.to_string_lossy();
    let is_project_plugin = path_str.contains("/.claude/plugins/") || path_str.contains("\\.claude\\plugins\\");

    if !is_personal_plugin && !is_project_plugin {
        return Err(format!(
            "Cannot delete plugin: path '{}' is not within .claude/plugins/ or ~/.claude/plugins/",
            plugin_path.display()
        ));
    }

    // Verify it's a directory
    if !canonical_path.is_dir() {
        return Err(format!(
            "Plugin path '{}' is not a directory",
            plugin_path.display()
        ));
    }

    // Delete the plugin directory
    tokio::fs::remove_dir_all(&canonical_path)
        .await
        .map_err(|e| format!("Failed to delete plugin '{}': {}", plugin_path.display(), e))?;

    log::info!("Deleted plugin directory: {}", canonical_path.display());
    Ok(())
}

/// Saves the plugin/skill/MCP configuration for a specific branch.
///
/// This allows per-branch configuration persistence. When a user selects
/// a branch and configures plugins, that configuration is remembered
/// for future sessions on the same branch.
#[tauri::command]
pub async fn save_branch_config(
    app: AppHandle,
    project_path: String,
    branch: String,
    enabled_plugins: Vec<String>,
    enabled_skills: Vec<String>,
    enabled_mcp_servers: Vec<String>,
) -> Result<(), String> {
    let canonical = canonicalize_path(&project_path)?;

    let store_name = format!("maestro-{}.json", hash_project_path(&canonical));
    let store = app.store(&store_name).map_err(|e| e.to_string())?;

    let config = BranchConfig {
        enabled_plugins,
        enabled_skills,
        enabled_mcp_servers,
    };

    let key = format!("branch_config:{}", branch);
    store.set(&key, serde_json::json!(config));
    store.save().map_err(|e| e.to_string())?;

    log::debug!("Saved branch config for {}/{}", canonical, branch);
    Ok(())
}

/// Loads the plugin/skill/MCP configuration for a specific branch.
///
/// Returns None if no configuration has been saved for this branch yet.
#[tauri::command]
pub async fn load_branch_config(
    app: AppHandle,
    project_path: String,
    branch: String,
) -> Result<Option<BranchConfig>, String> {
    let canonical = canonicalize_path(&project_path)?;

    let store_name = format!("maestro-{}.json", hash_project_path(&canonical));
    let store = app.store(&store_name).map_err(|e| e.to_string())?;

    let key = format!("branch_config:{}", branch);
    let result = store
        .get(&key)
        .and_then(|v| serde_json::from_value::<BranchConfig>(v.clone()).ok());

    Ok(result)
}
