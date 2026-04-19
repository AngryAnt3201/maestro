//! Spawn a Claude session for a loop/schedule job, wait for it to be (probably)
//! ready, then inject a slash command via the existing terminal pipe.
//!
//! Composition over the underlying primitives:
//! - `ProcessManager::spawn_shell` to get a PTY-backed shell.
//! - `SessionManager::create_session` to register session metadata so the UI shows the pane.
//! - `ProcessManager::write_stdin` to type `claude` (start the CLI), then later type the slash command.
//! - `ProcessManager::kill_session` to tear down on driver delete.
//!
//! There is no per-session "ready" callback in the current Maestro core, so
//! readiness is approximated with a fixed sleep (configurable per call). When a
//! true readiness signal is added (e.g. the first transcript event), this
//! helper should switch to it.

use crate::core::ops::model::WorktreeSpec;
use crate::core::process_manager::ProcessManager;
use crate::core::session_manager::{AiMode, SessionManager};
use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;

pub struct SessionInjector {
    pub app_handle: AppHandle,
    pub sessions: Arc<SessionManager>,
    pub processes: Arc<ProcessManager>,
}

impl SessionInjector {
    pub fn new(app_handle: AppHandle, sessions: Arc<SessionManager>, processes: Arc<ProcessManager>) -> Self {
        Self { app_handle, sessions, processes }
    }

    /// Resolve the on-disk path for a worktree spec, creating a dedicated
    /// scratch directory at ~/.claude-maestro/worktrees/ops-loops/<loopId>/ if needed.
    pub async fn resolve_worktree(&self, loop_id: &str, spec: &WorktreeSpec) -> Result<PathBuf> {
        match spec {
            WorktreeSpec::Dedicated => {
                let base = directories::BaseDirs::new()
                    .ok_or_else(|| anyhow!("home dir unavailable"))?;
                let dir = base.home_dir()
                    .join(".claude-maestro")
                    .join("worktrees")
                    .join("ops-loops")
                    .join(loop_id);
                tokio::fs::create_dir_all(&dir).await
                    .map_err(|e| anyhow!("create scratch dir {}: {e}", dir.display()))?;
                Ok(dir)
            }
            WorktreeSpec::Existing { path, branch: _ } => {
                let p = PathBuf::from(path);
                if !p.exists() {
                    return Err(anyhow!("worktree path does not exist: {path}"));
                }
                Ok(p)
            }
        }
    }

    /// Spawn a PTY-backed shell in `cwd`, register session metadata, type
    /// `claude` to launch the CLI, then sleep `ready_timeout` to give it time
    /// to print its prompt before returning the session id.
    pub async fn spawn_and_wait_ready(
        &self,
        cwd: &Path,
        ready_timeout: Duration,
    ) -> Result<u32> {
        let cwd_str = cwd.to_string_lossy().into_owned();

        let session_id = self.processes
            .spawn_shell(self.app_handle.clone(), Some(cwd_str.clone()), None)
            .map_err(|e| anyhow!("spawn_shell: {e}"))?;

        // Register metadata so the UI mounts a pane for this session.
        // If the id is somehow already registered (shouldn't happen — spawn_shell
        // hands out fresh ids), surface as an error rather than silently overwriting.
        if let Err(existing) = self.sessions.create_session(session_id, AiMode::Claude, cwd_str) {
            return Err(anyhow!("session id {} already registered (mode {:?})", existing.id, existing.mode));
        }

        // Start the Claude CLI inside the freshly-spawned shell.
        self.processes.write_stdin(session_id, "claude\r")
            .map_err(|e| anyhow!("write_stdin (claude): {e}"))?;

        // Crude readiness wait. Replace with a transcript-event-based signal
        // when one becomes available (see TODO at top of file).
        tokio::time::sleep(ready_timeout).await;

        Ok(session_id)
    }

    /// Write a line (plus carriage return) to the given session's PTY.
    pub async fn inject_line(&self, session_id: u32, line: &str) -> Result<()> {
        let payload = format!("{line}\r");
        self.processes.write_stdin(session_id, &payload)
            .map_err(|e| anyhow!("write_stdin: {e}"))?;
        Ok(())
    }

    /// Kill the PTY process and remove the session metadata.
    pub async fn kill_session(&self, session_id: u32) -> Result<()> {
        let kill_res = self.processes.kill_session(session_id).await;
        self.sessions.remove_session(session_id);
        kill_res.map_err(|e| anyhow!("kill_session: {e}"))?;
        Ok(())
    }
}
