//! IPC commands for plugin/skill discovery and session configuration.

use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};
use tauri_plugin_store::StoreExt;

use crate::core::plugin_manager::{PluginManager, ProjectPlugins};

/// Creates a stable hash of a project path for use in store filenames.
fn hash_project_path(path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    let result = hasher.finalize();
    // Take first 12 hex characters for a reasonably short but unique filename
    format!("{:x}", &result)[..12].to_string()
}

/// Discovers and returns plugins/skills configured in the project's `.plugins.json`.
///
/// The project path is canonicalized before lookup. Results are cached.
#[tauri::command]
pub async fn get_project_plugins(
    state: State<'_, PluginManager>,
    project_path: String,
) -> Result<ProjectPlugins, String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

    Ok(state.get_project_plugins(&canonical))
}

/// Re-parses the `.plugins.json` file for a project, updating the cache.
#[tauri::command]
pub async fn refresh_project_plugins(
    state: State<'_, PluginManager>,
    project_path: String,
) -> Result<ProjectPlugins, String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

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
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

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
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

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
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

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
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

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
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

    Ok(state.get_skills_count(&canonical, session_id))
}

/// Returns the count of enabled plugins for a session.
#[tauri::command]
pub async fn get_session_plugins_count(
    state: State<'_, PluginManager>,
    project_path: String,
    session_id: u32,
) -> Result<usize, String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

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
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

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
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

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
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

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
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

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
