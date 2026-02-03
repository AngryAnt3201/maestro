use std::collections::HashMap;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::core::session_manager::SessionManager;
use crate::core::status_server::StatusServer;
use crate::core::windows_process::TokioCommandExt;
use crate::core::{BackendCapabilities, BackendType, ProcessManager, PtyError, SessionProcessTree};

/// Backend information returned to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendInfo {
    /// The active backend type.
    pub backend_type: BackendType,
    /// Backend capabilities.
    pub capabilities: BackendCapabilitiesDto,
}

/// DTO for backend capabilities (frontend-friendly naming).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendCapabilitiesDto {
    pub enhanced_state: bool,
    pub text_reflow: bool,
    pub kitty_graphics: bool,
    pub shell_integration: bool,
    pub backend_name: String,
}

impl From<BackendCapabilities> for BackendCapabilitiesDto {
    fn from(caps: BackendCapabilities) -> Self {
        Self {
            enhanced_state: caps.enhanced_state,
            text_reflow: caps.text_reflow,
            kitty_graphics: caps.kitty_graphics,
            shell_integration: caps.shell_integration,
            backend_name: caps.backend_name.to_string(),
        }
    }
}

/// Returns information about the active terminal backend.
///
/// The frontend can use this to enable/disable features based on
/// backend capabilities (e.g., enhanced terminal state queries).
#[tauri::command]
pub fn get_backend_info() -> BackendInfo {
    let backend_type = BackendType::platform_default();

    let capabilities = match backend_type {
        BackendType::XtermPassthrough => BackendCapabilities {
            enhanced_state: false,
            text_reflow: false,
            kitty_graphics: false,
            shell_integration: false,
            backend_name: "xterm-passthrough",
        },
        BackendType::VteParser => BackendCapabilities {
            enhanced_state: true,
            text_reflow: false,
            kitty_graphics: false,
            shell_integration: false,
            backend_name: "vte-parser",
        },
    };

    BackendInfo {
        backend_type,
        capabilities: capabilities.into(),
    }
}

/// Exposes `ProcessManager::spawn_shell` to the frontend.
///
/// Validates that `cwd` (if provided) exists and is a directory before
/// forwarding to the process manager. Returns the new session ID.
/// The frontend should listen on `pty-output-{id}` for shell output events.
///
/// # Environment Variables
/// The `env` parameter allows passing environment variables to the shell process.
/// These are inherited by all child processes (including Claude CLI → MCP server).
/// Common usage: `{ "MAESTRO_PROJECT_HASH": "<hash>" }` for MCP status identification.
/// Note: `MAESTRO_SESSION_ID` is automatically set by the process manager.
#[tauri::command]
pub async fn spawn_shell(
    app_handle: AppHandle,
    state: State<'_, ProcessManager>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<u32, PtyError> {
    // Validate cwd if provided: must exist and be a directory
    let canonical_cwd = if let Some(ref dir) = cwd {
        let path = std::path::Path::new(dir);
        let canonical = path
            .canonicalize()
            .map_err(|e| PtyError::spawn_failed(format!("Invalid cwd '{dir}': {e}")))?;
        if !canonical.is_dir() {
            return Err(PtyError::spawn_failed(format!(
                "cwd '{dir}' is not a directory"
            )));
        }
        Some(canonical.to_string_lossy().into_owned())
    } else {
        None
    };
    let pm = state.inner().clone();
    pm.spawn_shell(app_handle, canonical_cwd, env)
}

/// Exposes `ProcessManager::write_stdin` to the frontend.
/// Sends raw text (including control sequences like `\r`) to the PTY.
#[tauri::command]
pub async fn write_stdin(
    state: State<'_, ProcessManager>,
    session_id: u32,
    data: String,
) -> Result<(), PtyError> {
    let pm = state.inner().clone();
    pm.write_stdin(session_id, &data)
}

/// Exposes `ProcessManager::resize_pty` to the frontend.
/// Rejects dimensions that are zero or exceed 500 to prevent misuse.
#[tauri::command]
pub async fn resize_pty(
    state: State<'_, ProcessManager>,
    session_id: u32,
    rows: u16,
    cols: u16,
) -> Result<(), PtyError> {
    if rows == 0 || cols == 0 || rows > 500 || cols > 500 {
        return Err(PtyError::resize_failed("Invalid dimensions"));
    }
    let pm = state.inner().clone();
    pm.resize_pty(session_id, rows, cols)
}

/// Exposes `ProcessManager::kill_session` to the frontend.
/// Gracefully terminates the PTY session (SIGTERM, then SIGKILL after 3s).
/// Also unregisters the session from the status server.
#[tauri::command]
pub async fn kill_session(
    state: State<'_, ProcessManager>,
    session_mgr: State<'_, SessionManager>,
    status_server: State<'_, Arc<StatusServer>>,
    session_id: u32,
) -> Result<(), PtyError> {
    // Kill the PTY session
    let pm = state.inner().clone();
    let result = pm.kill_session(session_id).await;

    // Unregister the session from the status server so it stops accepting updates
    status_server.unregister_session(session_id).await;

    // Log for debugging
    let _project_path = session_mgr
        .all_sessions()
        .into_iter()
        .find(|s| s.id == session_id)
        .map(|s| s.project_path);

    result
}

/// Returns the process tree for a specific session.
///
/// The tree includes the root shell process and all its descendants.
/// Returns None if the session doesn't exist or its root process has exited.
#[tauri::command]
pub async fn get_session_process_tree(
    state: State<'_, ProcessManager>,
    session_id: u32,
) -> Result<Option<SessionProcessTree>, String> {
    let pm = state.inner().clone();
    let root_pid = match pm.get_session_pid(session_id) {
        Some(pid) => pid,
        None => return Ok(None),
    };

    Ok(crate::core::process_tree::get_process_tree(session_id, root_pid))
}

/// Returns process trees for all active sessions.
///
/// More efficient than calling get_session_process_tree for each session
/// since it only refreshes the process list once.
#[tauri::command]
pub async fn get_all_process_trees(
    state: State<'_, ProcessManager>,
) -> Result<Vec<SessionProcessTree>, String> {
    let pm = state.inner().clone();
    let sessions = pm.get_all_session_pids();
    Ok(crate::core::process_tree::get_all_process_trees(&sessions))
}

/// Kills a specific process by PID.
///
/// Sends SIGTERM first, waits up to 2 seconds, then SIGKILL if still alive.
/// Will refuse to kill root session processes (use kill_session for that).
#[tauri::command]
pub async fn kill_process(
    state: State<'_, ProcessManager>,
    pid: u32,
) -> Result<(), String> {
    let pm = state.inner().clone();
    let session_root_pids: Vec<i32> = pm
        .get_all_session_pids()
        .into_iter()
        .map(|(_, root_pid)| root_pid)
        .collect();

    crate::core::process_tree::kill_process(pid, &session_root_pids)
        .await
        .map_err(|e| e.to_string())
}

/// Kills all active PTY sessions.
///
/// Used to clean up orphaned sessions when the frontend reloads.
/// Returns the number of sessions that were killed.
#[tauri::command]
pub async fn kill_all_sessions(state: State<'_, ProcessManager>) -> Result<u32, PtyError> {
    let pm = state.inner().clone();
    pm.kill_all_sessions().await
}

/// Checks if a command is available in the user's PATH.
///
/// On macOS/Linux, when the app is launched from GUI launchers (Raycast, Spotlight),
/// the PATH is minimal and doesn't include user installations. This function searches
/// common installation directories directly without spawning a shell (which can cause
/// issues with shell plugins like powerlevel10k).
///
/// On Windows, uses `where.exe` to check.
#[tauri::command]
pub async fn check_cli_available(command: String) -> Result<bool, String> {
    #[cfg(unix)]
    {
        // Search for command in PATH and common installation directories
        // We avoid spawning a shell because shell plugins (oh-my-zsh, powerlevel10k)
        // can hang or abort when run without a TTY
        let mut paths: Vec<String> = Vec::new();

        // Start with current environment PATH
        if let Ok(env_path) = std::env::var("PATH") {
            paths.extend(env_path.split(':').map(String::from));
        }

        // Add common user installation directories that GUI launchers often miss
        if let Ok(home) = std::env::var("HOME") {
            // Homebrew on Apple Silicon
            paths.push("/opt/homebrew/bin".to_string());
            paths.push("/opt/homebrew/sbin".to_string());
            // Homebrew on Intel Mac
            paths.push("/usr/local/bin".to_string());
            paths.push("/usr/local/sbin".to_string());
            // npm global installations
            paths.push(format!("{}/.npm-global/bin", home));
            paths.push(format!("{}/node_modules/.bin", home));
            // Cargo/Rust
            paths.push(format!("{}/.cargo/bin", home));
            // Go
            paths.push(format!("{}/go/bin", home));
            // Python user installs
            paths.push(format!("{}/.local/bin", home));
            // pyenv
            paths.push(format!("{}/.pyenv/shims", home));
            // rbenv
            paths.push(format!("{}/.rbenv/shims", home));
        }

        // Search for command in all PATH directories
        for dir in &paths {
            let cmd_path = format!("{}/{}", dir, command);
            if std::path::Path::new(&cmd_path).exists() {
                log::debug!("Found {} at {}", command, cmd_path);
                return Ok(true);
            }
        }

        log::debug!("Command {} not found in PATH", command);
        Ok(false)
    }

    #[cfg(windows)]
    {
        use crate::core::windows_process::TokioCommandExt;
        let output = tokio::process::Command::new("where.exe")
            .arg(&command)
            .hide_console_window()
            .output()
            .await
            .map_err(|e| format!("Failed to check CLI: {}", e))?;
        Ok(output.status.success())
    }
}
