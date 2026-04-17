use std::path::Path;
use std::sync::Arc;

use tauri::State;

use crate::core::mcp_config_writer;
use crate::core::mcp_manager::McpManager;
use crate::core::plugin_manager::PluginManager;
use crate::core::process_manager::ProcessManager;
use crate::core::session_manager::{AiMode, SessionConfig, SessionManager, SessionStatus};
use crate::core::status_server::StatusServer;

/// Exposes `SessionManager::all_sessions` to the frontend.
/// Returns a snapshot of all active sessions in arbitrary order.
#[tauri::command]
pub async fn get_sessions(state: State<'_, SessionManager>) -> Result<Vec<SessionConfig>, String> {
    Ok(state.all_sessions())
}

/// Exposes `SessionManager::create_session` to the frontend.
/// Registers a new session with `Idle` status. Returns an error if the
/// session ID already exists.
#[tauri::command]
pub async fn create_session(
    state: State<'_, SessionManager>,
    id: u32,
    mode: AiMode,
    project_path: String,
    working_directory: Option<String>,
) -> Result<SessionConfig, String> {
    // Canonicalize path for consistent storage
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

    // Canonicalize working_directory too when provided — it may point at a
    // worktree or a sub-repo that differs from the workspace root.
    let canonical_wd = match working_directory {
        Some(wd) => {
            let c = std::fs::canonicalize(&wd)
                .map_err(|e| format!("Invalid working directory '{}': {}", wd, e))?
                .to_string_lossy()
                .into_owned();
            Some(c)
        }
        None => None,
    };

    state
        .create_session(id, mode, canonical, canonical_wd)
        .map_err(|existing| format!("Session {} already exists", existing.id))
}

/// Exposes `SessionManager::update_status` to the frontend.
/// Returns `false` if the session does not exist (no error raised).
#[tauri::command]
pub async fn update_session_status(
    state: State<'_, SessionManager>,
    session_id: u32,
    status: SessionStatus,
) -> Result<bool, String> {
    Ok(state.update_status(session_id, status))
}

/// Exposes `SessionManager::assign_branch` to the frontend.
/// Links a session to a branch and optional worktree path. Returns an error
/// string if the session does not exist.
#[tauri::command]
pub async fn assign_session_branch(
    state: State<'_, SessionManager>,
    session_id: u32,
    branch: String,
    worktree_path: Option<String>,
) -> Result<SessionConfig, String> {
    state
        .assign_branch(session_id, branch, worktree_path)
        .ok_or_else(|| format!("Session {} not found", session_id))
}

/// Renames a session. Empty or whitespace-only names are treated as `None`,
/// which resets the display name to the default `{provider} #{id}` format.
#[tauri::command]
pub async fn rename_session(
    state: State<'_, SessionManager>,
    session_id: u32,
    name: Option<String>,
) -> Result<SessionConfig, String> {
    let normalized = name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty());
    state
        .rename_session(session_id, normalized)
        .ok_or_else(|| format!("Session {} not found", session_id))
}

/// Exposes `SessionManager::remove_session` to the frontend.
/// Returns the removed session config, or `None` if it was not found.
#[tauri::command]
pub async fn remove_session(
    state: State<'_, SessionManager>,
    session_id: u32,
) -> Result<Option<SessionConfig>, String> {
    Ok(state.remove_session(session_id))
}

/// Gets all sessions for a specific project.
#[tauri::command]
pub async fn get_sessions_for_project(
    state: State<'_, SessionManager>,
    project_path: String,
) -> Result<Vec<SessionConfig>, String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

    Ok(state.get_sessions_for_project(&canonical))
}

/// Removes all sessions for a project (used when closing a project tab).
/// Also kills the associated PTY sessions and cleans up MCP/plugin state.
#[tauri::command]
pub async fn remove_sessions_for_project(
    state: State<'_, SessionManager>,
    process_manager: State<'_, ProcessManager>,
    mcp_manager: State<'_, McpManager>,
    status_server: State<'_, Arc<StatusServer>>,
    plugin_manager: State<'_, PluginManager>,
    project_path: String,
) -> Result<Vec<SessionConfig>, String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?
        .to_string_lossy()
        .into_owned();

    let removed = state.remove_sessions_for_project(&canonical);

    // Clean up MCP, plugin, and PTY state for each removed session
    for session in &removed {
        // Clean up in-memory MCP and plugin state
        mcp_manager.remove_session(&canonical, session.id);
        plugin_manager.remove_session(&canonical, session.id);

        // Unregister session from status server
        status_server.unregister_session(session.id).await;

        // Clean up .mcp.json entry (use worktree_path if set, otherwise project_path)
        let working_dir = session
            .worktree_path
            .as_deref()
            .unwrap_or(&session.project_path);
        if let Err(e) =
            mcp_config_writer::remove_session_mcp_config(Path::new(working_dir), session.id).await
        {
            log::warn!(
                "Failed to remove MCP config for session {}: {}",
                session.id,
                e
            );
        }

        // Fire-and-forget kill -- log errors but don't fail the removal
        if let Err(e) = process_manager.kill_session(session.id).await {
            log::warn!("Failed to kill PTY for session {}: {}", session.id, e);
        }
    }

    log::debug!(
        "Removed {} sessions for project {}",
        removed.len(),
        canonical
    );

    Ok(removed)
}
