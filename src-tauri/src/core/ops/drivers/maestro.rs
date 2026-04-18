//! Maestro driver: spawns a Command, streams stdout/stderr via a channel,
//! sends Finished with exit code. Enforces per-job timeout (default 900s).

use super::{DispatchContext, DispatchEvent, DispatchTx, Driver, DriverCapabilities, DriverMeta, ExternalJob};
use crate::core::ops::model::{DispatchStatus, Job};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

pub const DEFAULT_TIMEOUT_SEC: u64 = 900;

pub struct MaestroDriver;

impl MaestroDriver {
    pub fn new() -> Self { Self }
}

#[async_trait]
impl Driver for MaestroDriver {
    async fn create(&self, _job: &Job) -> Result<DriverMeta> { Ok(DriverMeta::default()) }
    async fn update(&self, _job: &Job) -> Result<()> { Ok(()) }
    async fn delete(&self, _job: &Job) -> Result<()> { Ok(()) }

    async fn run_now(&self, job: &Job, ctx: DispatchContext, tx: DispatchTx) -> Result<()> {
        let payload = job.maestro.as_ref()
            .ok_or_else(|| anyhow!("maestro driver used but job.maestro is None"))?;

        let mut cmd = Command::new(&payload.command);
        cmd.args(&payload.args);
        if let Some(cwd) = &payload.cwd {
            cmd.current_dir(cwd);
        }
        for (k, v) in &payload.env {
            cmd.env(k, v);
        }
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());

        let mut child = cmd.spawn().map_err(|e| anyhow!("spawn failed: {e}"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout handle"))?;
        let stderr = child.stderr.take().ok_or_else(|| anyhow!("no stderr handle"))?;

        let timeout = Duration::from_secs(payload.timeout_sec.unwrap_or(DEFAULT_TIMEOUT_SEC));
        let dispatch_id = ctx.dispatch_id.clone();

        let tx_out = tx.clone();
        let id_out = dispatch_id.clone();
        let out_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = tx_out.send(DispatchEvent::Output {
                    dispatch_id: id_out.clone(),
                    chunk: format!("{line}\n"),
                    is_stderr: false,
                });
            }
        });

        let tx_err = tx.clone();
        let id_err = dispatch_id.clone();
        let err_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = tx_err.send(DispatchEvent::Output {
                    dispatch_id: id_err.clone(),
                    chunk: format!("{line}\n"),
                    is_stderr: true,
                });
            }
        });

        let wait_res = tokio::time::timeout(timeout, child.wait()).await;
        let (status_enum, exit_code) = match wait_res {
            Ok(Ok(exit)) => {
                if exit.success() {
                    (DispatchStatus::Succeeded, exit.code())
                } else {
                    (DispatchStatus::Failed, exit.code())
                }
            }
            Ok(Err(e)) => {
                let _ = tx.send(DispatchEvent::Output {
                    dispatch_id: dispatch_id.clone(),
                    chunk: format!("[scheduler] wait error: {e}\n"),
                    is_stderr: true,
                });
                (DispatchStatus::Failed, None)
            }
            Err(_) => {
                let _ = tx.send(DispatchEvent::Output {
                    dispatch_id: dispatch_id.clone(),
                    chunk: format!("[scheduler] timeout after {}s, sending SIGTERM\n", timeout.as_secs()),
                    is_stderr: true,
                });
                let _ = child.start_kill();
                let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
                (DispatchStatus::Cancelled, None)
            }
        };

        let _ = tokio::join!(out_task, err_task);

        let _ = tx.send(DispatchEvent::Finished {
            dispatch_id,
            status: status_enum,
            exit_code,
            tokens: None,
        });
        Ok(())
    }

    async fn list_external(&self) -> Result<Vec<ExternalJob>> { Ok(Vec::new()) }

    fn capabilities(&self) -> DriverCapabilities {
        DriverCapabilities {
            supports_delete: true,
            supports_raw_env: true,
            supports_local_logs: true,
            supports_mcp_connectors: false,
            min_interval_seconds: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ops::model::*;
    use std::collections::HashMap;
    use tokio::sync::mpsc;

    fn echo_job() -> Job {
        Job {
            id: "j".into(),
            name: "echo".into(),
            enabled: true,
            scope: Scope::Global,
            project_hash: None,
            tags: vec![],
            driver: JobDriver::Maestro,
            schedule: None,
            maestro: Some(MaestroJobPayload {
                command: "echo".into(),
                args: vec!["hello".into()],
                cwd: None,
                env: HashMap::new(),
                timeout_sec: Some(5),
            }),
            claude_trigger: None,
            tool_id: None,
            notify_on_failure: false,
            last_dispatch: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[tokio::test]
    async fn echo_produces_stdout_and_success() {
        let d = MaestroDriver::new();
        let (tx, mut rx) = mpsc::unbounded_channel();
        d.run_now(&echo_job(), DispatchContext { dispatch_id: "d1".into(), triggered_by: TriggeredBy::Manual }, tx)
            .await
            .unwrap();

        let mut saw_output = false;
        let mut final_status = None;
        while let Some(evt) = rx.recv().await {
            match evt {
                DispatchEvent::Output { chunk, is_stderr, .. } => {
                    if !is_stderr && chunk.contains("hello") {
                        saw_output = true;
                    }
                }
                DispatchEvent::Finished { status, .. } => {
                    final_status = Some(status);
                    break;
                }
            }
        }
        assert!(saw_output);
        assert_eq!(final_status, Some(DispatchStatus::Succeeded));
    }

    #[tokio::test]
    async fn missing_binary_returns_error() {
        let d = MaestroDriver::new();
        let mut j = echo_job();
        j.maestro.as_mut().unwrap().command = "definitely-not-a-real-binary-xyz".into();
        let (tx, _rx) = mpsc::unbounded_channel();
        let err = d.run_now(&j, DispatchContext { dispatch_id: "d2".into(), triggered_by: TriggeredBy::Manual }, tx).await;
        assert!(err.is_err());
    }
}
