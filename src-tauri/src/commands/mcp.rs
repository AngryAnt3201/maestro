//! IPC commands for MCP server discovery and session configuration.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};
use tauri_plugin_store::StoreExt;

use crate::core::mcp_config_writer;
use crate::core::mcp_manager::{McpManager, McpServerConfig};
use crate::core::mcp_status_monitor::McpStatusMonitor;

/// Store filename for custom MCP servers (global, user-level).
const CUSTOM_MCP_SERVERS_STORE: &str = "mcp-custom-servers.json";

/// A custom MCP server configured by the user.
/// Stored globally (user-level) and available across all projects.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCustomServer {
    /// Unique identifier for the custom server.
    pub id: String,
    /// Display name for the server.
    pub name: String,
    /// Command to run (e.g., "npx", "node", "python").
    pub command: String,
    /// Arguments to pass to the command.
    pub args: Vec<String>,
    /// Environment variables for the server process.
    pub env: HashMap<String, String>,
    /// Working directory for the server process.
    pub working_directory: Option<String>,
    /// Whether this server is enabled by default.
    pub is_enabled: bool,
    /// ISO timestamp of when the server was created.
    pub created_at: String,
}

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

/// Adds a project to the MCP status monitor for polling.
///
/// This enables the monitor to watch for agent state files in the
/// project-specific directory under `/tmp/maestro/agents/<hash>/`.
/// Multiple projects can be monitored simultaneously.
#[tauri::command]
pub async fn add_mcp_project(
    state: State<'_, Arc<McpStatusMonitor>>,
    project_path: String,
) -> Result<(), String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

    log::info!(
        "add_mcp_project called with path='{}', canonical='{}'",
        project_path,
        canonical
    );

    state.add_project(&canonical).await;
    Ok(())
}

/// Removes a project from the MCP status monitor.
///
/// Call this when all sessions for a project have been closed.
/// Does nothing if the project wasn't being monitored.
#[tauri::command]
pub async fn remove_mcp_project(
    state: State<'_, Arc<McpStatusMonitor>>,
    project_path: String,
) -> Result<(), String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

    state.remove_project(&canonical).await;
    Ok(())
}

/// Removes a session's status file to prevent stale status pollution.
///
/// Call this when a session is killed to clean up its status file.
#[tauri::command]
pub async fn remove_session_status(
    state: State<'_, Arc<McpStatusMonitor>>,
    project_path: String,
    session_id: u32,
) -> Result<(), String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

    state.remove_session_status(&canonical, session_id).await;
    Ok(())
}

/// Writes a session-specific `.mcp.json` file to the working directory.
///
/// This must be called BEFORE launching the Claude CLI so it can discover
/// and connect to the configured MCP servers, including the Maestro status server.
///
/// The written config includes:
/// - The `maestro` MCP server with session-specific environment variables
/// - All enabled servers from the project's `.mcp.json`
/// - All enabled custom servers (user-defined, global)
///
/// Existing user-defined servers in the working directory's `.mcp.json` are
/// preserved (only Maestro-managed servers are replaced).
#[tauri::command]
pub async fn write_session_mcp_config(
    app: AppHandle,
    mcp_state: State<'_, McpManager>,
    working_dir: String,
    session_id: u32,
    project_path: String,
    enabled_server_names: Vec<String>,
) -> Result<(), String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

    let project_hash = McpStatusMonitor::generate_project_hash(&canonical);

    // Get full server configs for enabled discovered servers
    let all_discovered = mcp_state.get_project_servers(&canonical);
    let enabled_discovered: Vec<_> = all_discovered
        .into_iter()
        .filter(|s| enabled_server_names.contains(&s.name))
        .collect();

    // Get enabled custom servers
    let custom_servers = get_custom_mcp_servers_internal(&app)?;
    let enabled_custom: Vec<_> = custom_servers
        .into_iter()
        .filter(|s| s.is_enabled)
        .collect();

    log::info!(
        "Writing MCP config for session {} to {} ({} discovered + {} custom servers)",
        session_id,
        working_dir,
        enabled_discovered.len(),
        enabled_custom.len()
    );

    mcp_config_writer::write_session_mcp_config(
        Path::new(&working_dir),
        session_id,
        &project_hash,
        &enabled_discovered,
        &enabled_custom,
    )
    .await
}

/// Internal helper to get custom MCP servers (non-async for use within commands).
fn get_custom_mcp_servers_internal(app: &AppHandle) -> Result<Vec<McpCustomServer>, String> {
    let store = app.store(CUSTOM_MCP_SERVERS_STORE).map_err(|e| e.to_string())?;

    let servers = store
        .get("servers")
        .and_then(|v| serde_json::from_value::<Vec<McpCustomServer>>(v.clone()).ok())
        .unwrap_or_default();

    Ok(servers)
}

/// Removes a session-specific Maestro server from `.mcp.json`.
///
/// This should be called when a session is killed to clean up the config file.
/// The function is idempotent - it does nothing if the session entry doesn't exist.
#[tauri::command]
pub async fn remove_session_mcp_config(
    working_dir: String,
    session_id: u32,
) -> Result<(), String> {
    let path = PathBuf::from(&working_dir);
    mcp_config_writer::remove_session_mcp_config(&path, session_id).await
}

/// Generates a project hash for the given path.
///
/// This hash is used by MCP status monitoring to create session-specific
/// status files in `/tmp/maestro/agents/<hash>/`. The hash is also passed
/// as `MAESTRO_PROJECT_HASH` environment variable to the shell process.
#[tauri::command]
pub async fn generate_project_hash(
    project_path: String,
) -> Result<String, String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

    Ok(McpStatusMonitor::generate_project_hash(&canonical))
}

/// Gets all custom MCP servers configured by the user.
///
/// Custom servers are stored globally (user-level) and available across all projects.
#[tauri::command]
pub async fn get_custom_mcp_servers(app: AppHandle) -> Result<Vec<McpCustomServer>, String> {
    let store = app.store(CUSTOM_MCP_SERVERS_STORE).map_err(|e| e.to_string())?;

    let servers = store
        .get("servers")
        .and_then(|v| serde_json::from_value::<Vec<McpCustomServer>>(v.clone()).ok())
        .unwrap_or_default();

    log::debug!("Loaded {} custom MCP servers", servers.len());
    Ok(servers)
}

/// Saves a custom MCP server configuration.
///
/// If a server with the same ID already exists, it will be updated.
/// Otherwise, the new server is added to the list.
#[tauri::command]
pub async fn save_custom_mcp_server(
    app: AppHandle,
    server: McpCustomServer,
) -> Result<(), String> {
    let store = app.store(CUSTOM_MCP_SERVERS_STORE).map_err(|e| e.to_string())?;

    // Load existing servers
    let mut servers: Vec<McpCustomServer> = store
        .get("servers")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    // Update or add the server
    if let Some(index) = servers.iter().position(|s| s.id == server.id) {
        servers[index] = server.clone();
        log::debug!("Updated custom MCP server: {}", server.name);
    } else {
        log::debug!("Added new custom MCP server: {}", server.name);
        servers.push(server);
    }

    // Save back to store
    store.set(
        "servers",
        serde_json::to_value(&servers).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())?;

    Ok(())
}

/// Deletes a custom MCP server by ID.
#[tauri::command]
pub async fn delete_custom_mcp_server(
    app: AppHandle,
    server_id: String,
) -> Result<(), String> {
    let store = app.store(CUSTOM_MCP_SERVERS_STORE).map_err(|e| e.to_string())?;

    // Load existing servers
    let mut servers: Vec<McpCustomServer> = store
        .get("servers")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    // Remove the server
    let original_len = servers.len();
    servers.retain(|s| s.id != server_id);

    if servers.len() < original_len {
        log::debug!("Deleted custom MCP server with ID: {}", server_id);
    }

    // Save back to store
    store.set(
        "servers",
        serde_json::to_value(&servers).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())?;

    Ok(())
}
