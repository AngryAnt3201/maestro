//! IPC commands for MCP server discovery and session configuration.

use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};
use tauri_plugin_store::StoreExt;

use crate::core::mcp_manager::{McpManager, McpServerConfig};

/// Creates a stable hash of a project path for use in store filenames.
fn hash_project_path(path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    let result = hasher.finalize();
    // Take first 12 hex characters for a reasonably short but unique filename
    format!("{:x}", &result)[..12].to_string()
}

/// Discovers and returns MCP servers configured in the project's `.mcp.json`.
///
/// The project path is canonicalized before lookup. Results are cached.
#[tauri::command]
pub async fn get_project_mcp_servers(
    state: State<'_, McpManager>,
    project_path: String,
) -> Result<Vec<McpServerConfig>, String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

    Ok(state.get_project_servers(&canonical))
}

/// Re-parses the `.mcp.json` file for a project, updating the cache.
#[tauri::command]
pub async fn refresh_project_mcp_servers(
    state: State<'_, McpManager>,
    project_path: String,
) -> Result<Vec<McpServerConfig>, String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

    Ok(state.refresh_project_servers(&canonical))
}

/// Gets the enabled MCP server names for a specific session.
///
/// If not explicitly set, returns all available servers as enabled.
#[tauri::command]
pub async fn get_session_mcp_servers(
    state: State<'_, McpManager>,
    project_path: String,
    session_id: u32,
) -> Result<Vec<String>, String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

    Ok(state.get_session_enabled(&canonical, session_id))
}

/// Sets the enabled MCP server names for a specific session.
#[tauri::command]
pub async fn set_session_mcp_servers(
    state: State<'_, McpManager>,
    project_path: String,
    session_id: u32,
    enabled: Vec<String>,
) -> Result<(), String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

    state.set_session_enabled(&canonical, session_id, enabled);
    Ok(())
}

/// Returns the count of enabled MCP servers for a session.
#[tauri::command]
pub async fn get_session_mcp_count(
    state: State<'_, McpManager>,
    project_path: String,
    session_id: u32,
) -> Result<usize, String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

    Ok(state.get_enabled_count(&canonical, session_id))
}

/// Saves the default enabled MCP servers for a project.
///
/// These defaults are loaded when a new session starts, so server selections
/// persist across app restarts.
#[tauri::command]
pub async fn save_project_mcp_defaults(
    app: AppHandle,
    project_path: String,
    enabled_servers: Vec<String>,
) -> Result<(), String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

    let store_name = format!("maestro-{}.json", hash_project_path(&canonical));
    let store = app.store(&store_name).map_err(|e| e.to_string())?;

    store.set("enabled_mcp_servers", serde_json::json!(enabled_servers));
    store.save().map_err(|e| e.to_string())?;

    log::debug!("Saved MCP server defaults for project: {}", canonical);
    Ok(())
}

/// Loads the default enabled MCP servers for a project.
///
/// Returns None if no defaults have been saved yet.
#[tauri::command]
pub async fn load_project_mcp_defaults(
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
        .get("enabled_mcp_servers")
        .and_then(|v| v.as_array().cloned())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        });

    Ok(result)
}
