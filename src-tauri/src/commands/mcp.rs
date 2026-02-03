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
use crate::core::status_server::StatusServer;

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

/// Status server info returned to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusServerInfo {
    pub port: u16,
    pub status_url: String,
    pub instance_id: String,
    /// Path to the maestro-mcp-server binary, if found.
    pub mcp_binary_path: Option<String>,
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

/// Registers a project with the status server.
///
/// This is a no-op in the new HTTP-based architecture since we don't need
/// file-based monitoring anymore. Kept for backwards compatibility.
#[tauri::command]
pub async fn add_mcp_project(project_path: String) -> Result<(), String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

    log::debug!(
        "add_mcp_project called for '{}' (no-op in HTTP architecture)",
        canonical
    );
    Ok(())
}

/// Removes a project from monitoring.
///
/// This is a no-op in the new HTTP-based architecture since we don't need
/// file-based monitoring anymore. Kept for backwards compatibility.
#[tauri::command]
pub async fn remove_mcp_project(project_path: String) -> Result<(), String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

    log::debug!(
        "remove_mcp_project called for '{}' (no-op in HTTP architecture)",
        canonical
    );
    Ok(())
}

/// Removes a session's status from tracking.
///
/// In the new HTTP-based architecture, this unregisters the session from
/// the status server so it stops accepting updates for this session.
#[tauri::command]
pub async fn remove_session_status(
    status_server: State<'_, Arc<StatusServer>>,
    _project_path: String,
    session_id: u32,
) -> Result<(), String> {
    status_server.unregister_session(session_id).await;
    log::debug!("Unregistered session {} from status server", session_id);
    Ok(())
}

/// Gets the status server info (URL, port, instance ID, and binary path).
///
/// This is needed by the frontend when writing MCP configs so the
/// MCP server knows where to POST status updates. Also used by the
/// sidebar to display MCP server status.
#[tauri::command]
pub async fn get_status_server_info(
    status_server: State<'_, Arc<StatusServer>>,
) -> Result<StatusServerInfo, String> {
    let registered = status_server.registered_sessions().await;
    let mcp_binary_path = mcp_config_writer::find_maestro_mcp_path()
        .map(|p| p.to_string_lossy().into_owned());
    log::info!(
        "get_status_server_info: instance_id={}, registered_sessions={:?}, mcp_binary={:?}",
        status_server.instance_id(),
        registered,
        mcp_binary_path
    );
    Ok(StatusServerInfo {
        port: status_server.port(),
        status_url: status_server.status_url(),
        instance_id: status_server.instance_id().to_string(),
        mcp_binary_path,
    })
}

/// Writes a session-specific `.mcp.json` file to the working directory.
///
/// This must be called BEFORE launching the Claude CLI so it can discover
/// and connect to the configured MCP servers, including the Maestro status server.
///
/// The written config includes:
/// - The `maestro` MCP server with HTTP-based status reporting
/// - All enabled servers from the project's `.mcp.json`
/// - All enabled custom servers (user-defined, global)
///
/// Existing user-defined servers in the working directory's `.mcp.json` are
/// preserved (only Maestro-managed servers are replaced).
#[tauri::command]
pub async fn write_session_mcp_config(
    app: AppHandle,
    mcp_state: State<'_, McpManager>,
    status_server: State<'_, Arc<StatusServer>>,
    working_dir: String,
    session_id: u32,
    project_path: String,
    enabled_server_names: Vec<String>,
) -> Result<(), String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

    // Register this session with the status server
    status_server
        .register_session(session_id, &canonical)
        .await;

    // Get the status URL and instance ID from the status server
    let status_url = status_server.status_url();
    let instance_id = status_server.instance_id();

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
        "Writing MCP config for session {} to {} ({} discovered + {} custom servers), status_url={}",
        session_id,
        working_dir,
        enabled_discovered.len(),
        enabled_custom.len(),
        status_url
    );

    mcp_config_writer::write_session_mcp_config(
        Path::new(&working_dir),
        session_id,
        &status_url,
        instance_id,
        &enabled_discovered,
        &enabled_custom,
    )
    .await
}

/// Internal helper to get custom MCP servers (non-async for use within commands).
fn get_custom_mcp_servers_internal(app: &AppHandle) -> Result<Vec<McpCustomServer>, String> {
    let store = app
        .store(CUSTOM_MCP_SERVERS_STORE)
        .map_err(|e| e.to_string())?;

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
pub async fn remove_session_mcp_config(working_dir: String, session_id: u32) -> Result<(), String> {
    let path = PathBuf::from(&working_dir);
    mcp_config_writer::remove_session_mcp_config(&path, session_id).await
}

/// Generates a project hash for the given path.
///
/// This hash is used for identification purposes. In the new HTTP-based
/// architecture, it's less critical but kept for backwards compatibility
/// and potential future use.
#[tauri::command]
pub async fn generate_project_hash(project_path: String) -> Result<String, String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

    Ok(StatusServer::generate_project_hash(&canonical))
}

/// Gets all custom MCP servers configured by the user.
///
/// Custom servers are stored globally (user-level) and available across all projects.
#[tauri::command]
pub async fn get_custom_mcp_servers(app: AppHandle) -> Result<Vec<McpCustomServer>, String> {
    let store = app
        .store(CUSTOM_MCP_SERVERS_STORE)
        .map_err(|e| e.to_string())?;

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
pub async fn save_custom_mcp_server(app: AppHandle, server: McpCustomServer) -> Result<(), String> {
    let store = app
        .store(CUSTOM_MCP_SERVERS_STORE)
        .map_err(|e| e.to_string())?;

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
pub async fn delete_custom_mcp_server(app: AppHandle, server_id: String) -> Result<(), String> {
    let store = app
        .store(CUSTOM_MCP_SERVERS_STORE)
        .map_err(|e| e.to_string())?;

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
