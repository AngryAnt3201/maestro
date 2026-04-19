//! Claude-trigger driver. Proxies to `/schedule` via `claude -p`.
//!
//! `/schedule` output is conversational; we use `--output-format=json` to get
//! a structured envelope and parse the final message content. When the CLI
//! is missing or returns a non-zero code we surface the raw stderr so the UI
//! can show an actionable banner.

use super::{DispatchContext, DispatchEvent, DispatchTx, Driver, DriverCapabilities, DriverMeta, ExternalJob};
use crate::core::ops::model::{DispatchStatus, Job};
use crate::core::ops::session_injector::SessionInjector;
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use serde_json::Value;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

/// Minimum supported cron interval for Claude triggers (skill-enforced: ≥1h).
pub const MIN_INTERVAL_SEC: u64 = 3600;

pub struct ClaudeTriggerDriver {
    claude_bin: String,
    injector: Option<Arc<SessionInjector>>,
}

impl ClaudeTriggerDriver {
    pub fn new() -> Self { Self { claude_bin: "claude".to_string(), injector: None } }
    pub fn with_injector(injector: Arc<SessionInjector>) -> Self {
        Self { claude_bin: "claude".to_string(), injector: Some(injector) }
    }
    #[allow(dead_code)]
    pub fn with_binary(claude_bin: impl Into<String>) -> Self { Self { claude_bin: claude_bin.into(), injector: None } }

    async fn invoke_schedule(&self, subprompt: &str) -> Result<String> {
        let mut cmd = Command::new(&self.claude_bin);
        cmd.arg("-p")
            .arg("--output-format=json")
            .arg(subprompt)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null());

        let mut child = cmd.spawn()
            .map_err(|e| anyhow!("failed to spawn `{}`: {e}", self.claude_bin))?;

        let mut stdout = String::new();
        let mut stderr = String::new();
        if let Some(mut o) = child.stdout.take() {
            o.read_to_string(&mut stdout).await.ok();
        }
        if let Some(mut e) = child.stderr.take() {
            e.read_to_string(&mut stderr).await.ok();
        }
        let status = child.wait().await?;
        if !status.success() {
            return Err(anyhow!("claude -p exited {:?}: {}", status.code(), stderr.trim()));
        }
        Ok(stdout)
    }

    async fn create_headless(&self, job: &Job, p: &crate::core::ops::model::ClaudeTriggerPayload) -> Result<DriverMeta> {
        let schedule = job.schedule.as_deref().unwrap_or("");
        let connectors = if p.mcp_connectors.is_empty() {
            String::new()
        } else {
            format!(" Attach connectors: {}.", p.mcp_connectors.join(", "))
        };
        let sub = format!(
            "/schedule create a trigger named \"{}\" on cron \"{}\" with prompt: {}.{}",
            job.name.replace('"', "'"),
            schedule,
            p.prompt,
            connectors
        );
        let result = self.invoke_schedule(&sub).await?;
        let text = Self::extract_result(&result)?;
        let trigger_id = text
            .split_whitespace()
            .find(|w| w.len() >= 24 && w.chars().all(|c| c.is_ascii_hexdigit() || c == '-'))
            .map(|s| s.to_string());
        Ok(DriverMeta { trigger_id })
    }

    async fn create_interactive(&self, job: &Job, p: &crate::core::ops::model::ClaudeTriggerPayload) -> Result<DriverMeta> {
        let injector = self.injector.as_ref()
            .ok_or_else(|| anyhow!("interactive /schedule requires SessionInjector; not configured"))?;
        let cwd = injector.resolve_worktree(
            &format!("schedule-{}", &job.id[..8.min(job.id.len())]),
            &crate::core::ops::model::WorktreeSpec::Dedicated,
        ).await?;
        let session_id = injector.spawn_and_wait_ready(&cwd, std::time::Duration::from_secs(10)).await?;

        let connectors = if p.mcp_connectors.is_empty() {
            String::new()
        } else {
            format!(" Attach connectors: {}.", p.mcp_connectors.join(", "))
        };
        let schedule = job.schedule.as_deref().unwrap_or("");
        let command = format!(
            "/schedule create a trigger named \"{}\" on cron \"{}\" with prompt: {}.{}",
            job.name.replace('"', "'"),
            schedule,
            p.prompt,
            connectors
        );
        injector.inject_line(session_id, &command).await?;

        Ok(DriverMeta { trigger_id: None })
    }

    /// Extracts the "result" field from the JSON output format.
    fn extract_result(raw: &str) -> Result<String> {
        let v: Value = serde_json::from_str(raw)
            .with_context(|| format!("invalid JSON from claude -p: {}", raw.chars().take(200).collect::<String>()))?;
        v.get("result")
            .and_then(|r| r.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow!("missing `result` field in claude -p output"))
    }
}

#[async_trait]
impl Driver for ClaudeTriggerDriver {
    async fn create(&self, job: &Job) -> Result<DriverMeta> {
        let p = job.claude_trigger.as_ref()
            .ok_or_else(|| anyhow!("claude_trigger payload missing"))?;

        match p.mode {
            crate::core::ops::model::ScheduleMode::Headless => {
                self.create_headless(job, p).await
            }
            crate::core::ops::model::ScheduleMode::Interactive => {
                self.create_interactive(job, p).await
            }
        }
    }

    async fn update(&self, job: &Job) -> Result<()> {
        let schedule = job.schedule.as_deref().unwrap_or("");
        let sub = format!("/schedule change the trigger named \"{}\" to cron \"{}\"",
            job.name.replace('"', "'"), schedule);
        self.invoke_schedule(&sub).await?;
        Ok(())
    }

    async fn delete(&self, _job: &Job) -> Result<()> {
        Err(anyhow!("claude-trigger driver does not support delete; open https://claude.ai/code/scheduled"))
    }

    async fn run_now(&self, job: &Job, ctx: DispatchContext, tx: DispatchTx) -> Result<()> {
        let sub = format!("/schedule run the trigger named \"{}\"", job.name.replace('"', "'"));
        match self.invoke_schedule(&sub).await {
            Ok(raw) => {
                let text = Self::extract_result(&raw).unwrap_or(raw);
                let _ = tx.send(DispatchEvent::Output {
                    dispatch_id: ctx.dispatch_id.clone(),
                    chunk: text,
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
            Err(e) => {
                let _ = tx.send(DispatchEvent::Output {
                    dispatch_id: ctx.dispatch_id.clone(),
                    chunk: format!("{e}"),
                    is_stderr: true,
                });
                let _ = tx.send(DispatchEvent::Finished {
                    dispatch_id: ctx.dispatch_id,
                    status: DispatchStatus::Failed,
                    exit_code: None,
                    tokens: None,
                });
                Err(e)
            }
        }
    }

    async fn list_external(&self) -> Result<Vec<ExternalJob>> {
        let raw = self.invoke_schedule("/schedule list my triggers as JSON").await?;
        let text = Self::extract_result(&raw)?;
        let trimmed = text.trim().trim_start_matches("```json").trim_end_matches("```").trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        match serde_json::from_str::<Vec<ExternalJob>>(trimmed) {
            Ok(v) => Ok(v),
            Err(_) => Ok(Vec::new()),
        }
    }

    fn capabilities(&self) -> DriverCapabilities {
        DriverCapabilities {
            supports_delete: false,
            supports_raw_env: false,
            supports_local_logs: false,
            supports_mcp_connectors: true,
            min_interval_seconds: MIN_INTERVAL_SEC,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_result_handles_json_envelope() {
        let raw = r#"{"type":"result","result":"Created trigger 1a2b3c4d5e6f7a8b9c0d1e2f"}"#;
        assert_eq!(
            ClaudeTriggerDriver::extract_result(raw).unwrap(),
            "Created trigger 1a2b3c4d5e6f7a8b9c0d1e2f"
        );
    }

    #[test]
    fn extract_result_errors_on_missing_field() {
        let raw = r#"{"type":"other"}"#;
        assert!(ClaudeTriggerDriver::extract_result(raw).is_err());
    }

    #[test]
    fn capabilities_enforce_min_interval() {
        let d = ClaudeTriggerDriver::new();
        assert_eq!(d.capabilities().min_interval_seconds, 3600);
        assert!(!d.capabilities().supports_delete);
    }
}
