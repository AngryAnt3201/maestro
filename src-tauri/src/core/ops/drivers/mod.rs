//! Driver abstraction. A Driver knows how to create/update/delete a job in
//! its external world (or no-op for local-only) and how to run it now.

pub mod fake;
pub mod maestro;
pub mod claude_trigger;

use crate::core::ops::model::Job;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

/// Events emitted during a dispatch — consumed by the scheduler which
/// forwards them to the Tauri event bus.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum DispatchEvent {
    /// stdout/stderr chunk from the running process.
    Output { dispatch_id: String, chunk: String, is_stderr: bool },
    /// Final status once the run is complete.
    Finished {
        dispatch_id: String,
        status: crate::core::ops::model::DispatchStatus,
        exit_code: Option<i32>,
        tokens: Option<u64>,
    },
}

/// Channel half the driver writes events to.
pub type DispatchTx = mpsc::UnboundedSender<DispatchEvent>;

/// Info handed to the driver when starting a run.
#[derive(Debug, Clone)]
pub struct DispatchContext {
    pub dispatch_id: String,
    pub triggered_by: crate::core::ops::model::TriggeredBy,
}

/// Capability flags — the frontend reads these to gate UI affordances.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverCapabilities {
    pub supports_delete: bool,
    pub supports_raw_env: bool,
    pub supports_local_logs: bool,
    pub supports_mcp_connectors: bool,
    pub min_interval_seconds: u64,
}

/// Metadata returned by `create` — may include an external trigger ID.
#[derive(Debug, Clone, Default)]
pub struct DriverMeta {
    pub trigger_id: Option<String>,
}

/// A job discovered on the external system (claude-trigger driver only).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalJob {
    pub external_id: String,
    pub name: String,
    pub schedule: Option<String>,
    pub prompt: Option<String>,
    pub last_run_at: Option<i64>,
    pub next_run_at: Option<i64>,
}

#[async_trait]
pub trait Driver: Send + Sync {
    async fn create(&self, job: &Job) -> anyhow::Result<DriverMeta>;
    async fn update(&self, job: &Job) -> anyhow::Result<()>;
    async fn delete(&self, job: &Job) -> anyhow::Result<()>;
    async fn run_now(&self, job: &Job, ctx: DispatchContext, tx: DispatchTx) -> anyhow::Result<()>;
    async fn list_external(&self) -> anyhow::Result<Vec<ExternalJob>>;
    fn capabilities(&self) -> DriverCapabilities;
}
