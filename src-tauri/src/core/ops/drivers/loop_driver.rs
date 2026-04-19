//! Loop driver: manages a long-running Claude session that has a /loop
//! slash command running inside it.
//!
//! create        = spawn session in worktree → /loop <interval> <prompt>
//! update        = delete + create (simplest correct implementation)
//! delete        = kill session
//! run_now       = no-op (the loop is continuous); emit a Finished event
//!                 so the UI can show confirmation
//! list_external = empty (loops are tracked locally)

use super::{DispatchContext, DispatchEvent, DispatchTx, Driver, DriverCapabilities, DriverMeta, ExternalJob};
use crate::core::ops::model::{DispatchStatus, Job};
use crate::core::ops::session_injector::SessionInjector;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use std::sync::Arc;
use std::time::Duration;

pub struct LoopDriver {
    pub injector: Arc<SessionInjector>,
}

impl LoopDriver {
    pub fn new(injector: Arc<SessionInjector>) -> Self {
        Self { injector }
    }
}

#[async_trait]
impl Driver for LoopDriver {
    async fn create(&self, job: &Job) -> Result<DriverMeta> {
        let payload = job.loop_.as_ref()
            .ok_or_else(|| anyhow!("loop driver: job.loop is None"))?;
        let cwd = self.injector.resolve_worktree(&job.id, &payload.worktree).await?;
        let session_id = self.injector.spawn_and_wait_ready(&cwd, Duration::from_secs(10)).await?;
        let command = format!("/loop {} {}", payload.interval, payload.prompt);
        self.injector.inject_line(session_id, &command).await?;
        Ok(DriverMeta { trigger_id: Some(session_id.to_string()) })
    }

    async fn update(&self, job: &Job) -> Result<()> {
        // Simplest update = tear down + respawn.
        self.delete(job).await.ok();
        self.create(job).await?;
        Ok(())
    }

    async fn delete(&self, job: &Job) -> Result<()> {
        if let Some(p) = job.loop_.as_ref() {
            if let Some(sid) = p.session_id {
                self.injector.kill_session(sid).await.ok();
            }
        }
        Ok(())
    }

    async fn run_now(&self, _job: &Job, ctx: DispatchContext, tx: DispatchTx) -> Result<()> {
        // Loops are continuous — "run now" means "ensure it's running".
        let _ = tx.send(DispatchEvent::Output {
            dispatch_id: ctx.dispatch_id.clone(),
            chunk: "loop is managed via /loop inside its Claude session\n".into(),
            is_stderr: false,
        });
        let _ = tx.send(DispatchEvent::Finished {
            dispatch_id: ctx.dispatch_id,
            status: DispatchStatus::Succeeded,
            exit_code: None,
            tokens: None,
        });
        Ok(())
    }

    async fn list_external(&self) -> Result<Vec<ExternalJob>> {
        Ok(Vec::new())
    }

    fn capabilities(&self) -> DriverCapabilities {
        DriverCapabilities {
            supports_delete: true,
            supports_raw_env: false,
            supports_local_logs: true, // the Claude session's transcript IS the log
            supports_mcp_connectors: false,
            min_interval_seconds: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    // Proper LoopDriver tests need a fake SessionInjector. Defer to integration
    // test in Task 60 — unit testing a driver that only delegates is low value.
}
