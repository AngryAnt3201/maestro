//! IPC commands for MCP server discovery and session configuration.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_store::StoreExt;

use crate::commands::shared::{canonicalize_path, hash_project_path};
use crate::core::mcp_config_writer;
use crate::core::mcp_manager::{McpManager, McpServerConfig};
use crate::core::status_server::StatusServer;

/// Store filename for custom MCP servers (global, user-level).
const CUSTOM_MCP_SERVERS_STORE: &str = "mcp-custom-servers.json";

/// Store key for the custom servers list.
const STORE_KEY_SERVERS: &str = "servers";

/// Store key for enabled MCP servers per project.
const STORE_KEY_ENABLED_MCP: &str = "enabled_mcp_servers";

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
}

/// Discovers and returns MCP servers configured in the project's `.mcp.json`.
///
/// The project path is canonicalized before lookup. Results are cached.
#[tauri::command]
pub async fn get_project_mcp_servers(
    state: State<'_, McpManager>,
    project_path: String,
) -> Result<Vec<McpServerConfig>, String> {
    let canonical = canonicalize_path(&project_path)?;
    Ok(state.get_project_servers(&canonical))
}

/// Re-parses the `.mcp.json` file for a project, updating the cache.
#[tauri::command]
pub async fn refresh_project_mcp_servers(
    state: State<'_, McpManager>,
    project_path: String,
) -> Result<Vec<McpServerConfig>, String> {
    let canonical = canonicalize_path(&project_path)?;
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
    let canonical = canonicalize_path(&project_path)?;
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
    let canonical = canonicalize_path(&project_path)?;
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
    let canonical = canonicalize_path(&project_path)?;
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
    let canonical = canonicalize_path(&project_path)?;
    let store = project_store(&app, &canonical)?;

    store.set(STORE_KEY_ENABLED_MCP, serde_json::json!(enabled_servers));
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
    let canonical = canonicalize_path(&project_path)?;
    let store = project_store(&app, &canonical)?;

    let result = store
        .get(STORE_KEY_ENABLED_MCP)
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
/// No-op in the HTTP-based architecture. Kept for backwards compatibility.
#[tauri::command]
pub async fn add_mcp_project(_project_path: String) -> Result<(), String> {
    Ok(())
}

/// Removes a project from monitoring.
///
/// No-op in the HTTP-based architecture. Kept for backwards compatibility.
#[tauri::command]
pub async fn remove_mcp_project(_project_path: String) -> Result<(), String> {
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

/// Gets the status server info (URL, port, instance ID).
///
/// This is needed by the frontend when writing MCP configs so the
/// MCP server knows where to POST status updates.
#[tauri::command]
pub async fn get_status_server_info(
    status_server: State<'_, Arc<StatusServer>>,
) -> Result<StatusServerInfo, String> {
    let registered = status_server.registered_sessions().await;
    log::info!(
        "get_status_server_info: instance_id={}, registered_sessions={:?}",
        status_server.instance_id(),
        registered
    );
    Ok(StatusServerInfo {
        port: status_server.port(),
        status_url: status_server.status_url(),
        instance_id: status_server.instance_id().to_string(),
    })
}

/// Context prepared for writing MCP session configs.
struct McpSessionContext {
    status_url: String,
    instance_id: String,
    enabled_discovered: Vec<McpServerConfig>,
    enabled_custom: Vec<McpCustomServer>,
}

/// Shared setup for write_session_mcp_config and write_opencode_mcp_config.
async fn prepare_mcp_session(
    app: &AppHandle,
    mcp_state: &McpManager,
    status_server: &StatusServer,
    project_path: &str,
    session_id: u32,
    enabled_server_names: &[String],
) -> Result<McpSessionContext, String> {
    let canonical = canonicalize_path(project_path)?;

    status_server
        .register_session(session_id, &canonical)
        .await;

    let all_discovered = mcp_state.get_project_servers(&canonical);
    let enabled_discovered: Vec<_> = all_discovered
        .into_iter()
        .filter(|s| enabled_server_names.contains(&s.name))
        .collect();

    let enabled_custom: Vec<_> = get_custom_mcp_servers_internal(app)?
        .into_iter()
        .filter(|s| s.is_enabled)
        .collect();

    Ok(McpSessionContext {
        status_url: status_server.status_url(),
        instance_id: status_server.instance_id().to_string(),
        enabled_discovered,
        enabled_custom,
    })
}

/// Writes a session-specific `.mcp.json` file to the working directory.
///
/// Must be called BEFORE launching the Claude CLI so it can discover
/// the configured MCP servers, including the Maestro status server.
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
    let ctx = prepare_mcp_session(
        &app, &mcp_state, &status_server, &project_path, session_id, &enabled_server_names,
    ).await?;

    log::info!(
        "Writing MCP config for session {} to {} ({} discovered + {} custom servers)",
        session_id, working_dir, ctx.enabled_discovered.len(), ctx.enabled_custom.len(),
    );

    mcp_config_writer::write_session_mcp_config(
        Path::new(&working_dir),
        session_id,
        &ctx.status_url,
        &ctx.instance_id,
        &ctx.enabled_discovered,
        &ctx.enabled_custom,
    )
    .await
}

/// Writes a session-specific `opencode.json` to the working directory for OpenCode CLI.
///
/// See write_session_mcp_config for full documentation.
#[tauri::command]
pub async fn write_opencode_mcp_config(
    app: AppHandle,
    mcp_state: State<'_, McpManager>,
    status_server: State<'_, Arc<StatusServer>>,
    working_dir: String,
    session_id: u32,
    project_path: String,
    enabled_server_names: Vec<String>,
) -> Result<(), String> {
    let ctx = prepare_mcp_session(
        &app, &mcp_state, &status_server, &project_path, session_id, &enabled_server_names,
    ).await?;

    log::info!(
        "Writing OpenCode MCP config for session {} to {} ({} discovered + {} custom servers)",
        session_id, working_dir, ctx.enabled_discovered.len(), ctx.enabled_custom.len(),
    );

    mcp_config_writer::write_opencode_mcp_config(
        Path::new(&working_dir),
        session_id,
        &ctx.status_url,
        &ctx.instance_id,
        &ctx.enabled_discovered,
        &ctx.enabled_custom,
    )
    .await
}

/// Internal helper to get custom MCP servers (non-async for use within commands).
fn get_custom_mcp_servers_internal(app: &AppHandle) -> Result<Vec<McpCustomServer>, String> {
    let store = app
        .store(CUSTOM_MCP_SERVERS_STORE)
        .map_err(|e| e.to_string())?;

    Ok(store
        .get(STORE_KEY_SERVERS)
        .and_then(|v| serde_json::from_value::<Vec<McpCustomServer>>(v.clone()).ok())
        .unwrap_or_default())
}

/// Opens the per-project store using the hashed project path.
fn project_store(
    app: &AppHandle,
    canonical_path: &str,
) -> Result<std::sync::Arc<tauri_plugin_store::Store<tauri::Wry>>, String> {
    let store_name = format!("maestro-{}.json", hash_project_path(canonical_path));
    app.store(&store_name).map_err(|e| e.to_string())
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

/// Removes a session-specific Maestro server from `opencode.json`.
///
/// This should be called when an OpenCode session is killed to clean up the config file.
#[tauri::command]
pub async fn remove_opencode_mcp_config(working_dir: String, session_id: u32) -> Result<(), String> {
    let path = PathBuf::from(&working_dir);
    mcp_config_writer::remove_opencode_mcp_config(&path, session_id).await
}

/// Generates a project hash for the given path.
///
/// This hash is used for identification purposes. In the new HTTP-based
/// architecture, it's less critical but kept for backwards compatibility
/// and potential future use.
#[tauri::command]
pub async fn generate_project_hash(project_path: String) -> Result<String, String> {
    let canonical = canonicalize_path(&project_path)?;
    Ok(StatusServer::generate_project_hash(&canonical))
}

/// Gets all custom MCP servers configured by the user.
///
/// Custom servers are stored globally (user-level) and available across all projects.
#[tauri::command]
pub async fn get_custom_mcp_servers(app: AppHandle) -> Result<Vec<McpCustomServer>, String> {
    let servers = get_custom_mcp_servers_internal(&app)?;
    log::debug!("Loaded {} custom MCP servers", servers.len());
    Ok(servers)
}

/// Loads custom servers from the store, applies a mutation, and saves back.
fn with_custom_servers(
    app: &AppHandle,
    f: impl FnOnce(&mut Vec<McpCustomServer>),
) -> Result<(), String> {
    let store = app
        .store(CUSTOM_MCP_SERVERS_STORE)
        .map_err(|e| e.to_string())?;

    let mut servers: Vec<McpCustomServer> = store
        .get(STORE_KEY_SERVERS)
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    f(&mut servers);

    store.set(
        STORE_KEY_SERVERS,
        serde_json::to_value(&servers).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())
}

/// Saves a custom MCP server configuration.
///
/// If a server with the same ID already exists, it will be updated.
/// Otherwise, the new server is added to the list.
#[tauri::command]
pub async fn save_custom_mcp_server(app: AppHandle, server: McpCustomServer) -> Result<(), String> {
    with_custom_servers(&app, |servers| {
        if let Some(index) = servers.iter().position(|s| s.id == server.id) {
            log::debug!("Updated custom MCP server: {}", server.name);
            servers[index] = server;
        } else {
            log::debug!("Added new custom MCP server: {}", server.name);
            servers.push(server);
        }
    })
}

/// Deletes a custom MCP server by ID.
#[tauri::command]
pub async fn delete_custom_mcp_server(app: AppHandle, server_id: String) -> Result<(), String> {
    with_custom_servers(&app, |servers| {
        let before = servers.len();
        servers.retain(|s| s.id != server_id);
        if servers.len() < before {
            log::debug!("Deleted custom MCP server with ID: {}", server_id);
        }
    })
}
