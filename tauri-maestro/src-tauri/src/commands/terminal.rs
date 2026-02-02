use serde::Serialize;
use tauri::{AppHandle, State};

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
#[tauri::command]
pub async fn spawn_shell(
    app_handle: AppHandle,
    state: State<'_, ProcessManager>,
    cwd: Option<String>,
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
    pm.spawn_shell(app_handle, canonical_cwd)
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
#[tauri::command]
pub async fn kill_session(
    state: State<'_, ProcessManager>,
    session_id: u32,
) -> Result<(), PtyError> {
    let pm = state.inner().clone();
    pm.kill_session(session_id).await
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

/// Checks if a command is available in the user's PATH.
/// Uses platform-appropriate method:
/// - Unix: runs `command -v <cmd>` via login shell
/// - Windows: runs `where.exe <cmd>`
#[tauri::command]
pub async fn check_cli_available(command: String) -> Result<bool, String> {
    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        let output = tokio::process::Command::new(&shell)
            .args(["-l", "-c", &format!("command -v {}", command)])
            .output()
            .await
            .map_err(|e| format!("Failed to check CLI: {}", e))?;
        Ok(output.status.success())
    }

    #[cfg(windows)]
    {
        let output = tokio::process::Command::new("where.exe")
            .arg(&command)
            .output()
            .await
            .map_err(|e| format!("Failed to check CLI: {}", e))?;
        Ok(output.status.success())
    }
}
