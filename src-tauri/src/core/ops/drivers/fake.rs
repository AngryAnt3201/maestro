//! Deterministic in-memory driver used by tests.

use super::{DispatchContext, DispatchEvent, DispatchTx, Driver, DriverCapabilities, DriverMeta, ExternalJob};
use crate::core::ops::model::{DispatchStatus, Job};
use async_trait::async_trait;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

#[derive(Default)]
pub struct FakeDriver {
    pub runs: Arc<AtomicUsize>,
}

impl FakeDriver {
    pub fn new() -> Self {
        Self { runs: Arc::new(AtomicUsize::new(0)) }
    }
}

#[async_trait]
impl Driver for FakeDriver {
    async fn create(&self, _job: &Job) -> anyhow::Result<DriverMeta> {
        Ok(DriverMeta::default())
    }
    async fn update(&self, _job: &Job) -> anyhow::Result<()> { Ok(()) }
    async fn delete(&self, _job: &Job) -> anyhow::Result<()> { Ok(()) }

    async fn run_now(&self, _job: &Job, ctx: DispatchContext, tx: DispatchTx) -> anyhow::Result<()> {
        self.runs.fetch_add(1, Ordering::SeqCst);
        let id = ctx.dispatch_id.clone();
        let _ = tx.send(DispatchEvent::Output { dispatch_id: id.clone(), chunk: "hello\n".into(), is_stderr: false });
        let _ = tx.send(DispatchEvent::Finished {
            dispatch_id: id,
            status: DispatchStatus::Succeeded,
            exit_code: Some(0),
            tokens: None,
        });
        Ok(())
    }

    async fn list_external(&self) -> anyhow::Result<Vec<ExternalJob>> { Ok(Vec::new()) }

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
    use tokio::sync::mpsc;

    fn make_job() -> Job {
        Job {
            id: "j1".into(),
            name: "fake".into(),
            enabled: true,
            scope: Scope::Global,
            project_hash: None,
            tags: vec![],
            driver: JobDriver::Maestro,
            schedule: None,
            maestro: None,
            claude_trigger: None,
            loop_: None,
            tool_id: None,
            notify_on_failure: false,
            last_dispatch: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[tokio::test]
    async fn fake_driver_emits_output_then_finished() {
        let d = FakeDriver::new();
        let (tx, mut rx) = mpsc::unbounded_channel();
        d.run_now(&make_job(), DispatchContext { dispatch_id: "dispatch-1".into(), triggered_by: TriggeredBy::Manual }, tx)
            .await
            .unwrap();

        let first = rx.recv().await.unwrap();
        match first {
            DispatchEvent::Output { chunk, .. } => assert_eq!(chunk, "hello\n"),
            other => panic!("expected Output, got {other:?}"),
        }
        let second = rx.recv().await.unwrap();
        match second {
            DispatchEvent::Finished { status, .. } => assert_eq!(status, DispatchStatus::Succeeded),
            other => panic!("expected Finished, got {other:?}"),
        }
        assert_eq!(d.runs.load(Ordering::SeqCst), 1);
    }
}
