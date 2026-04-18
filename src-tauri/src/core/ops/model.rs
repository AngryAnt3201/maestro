//! Domain types for the Ops panel. Mirrors `src/types/ops.ts`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    Global,
    Project,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobDriver {
    Maestro,
    ClaudeTrigger,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DispatchStatus {
    Running,
    Succeeded,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TriggeredBy {
    Schedule,
    Manual,
    Webhook,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MaestroJobPayload {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_sec: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeTriggerPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trigger_id: Option<String>,
    pub prompt: String,
    #[serde(default)]
    pub mcp_connectors: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastDispatch {
    pub id: String,
    pub started_at: i64,
    pub status: DispatchStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub scope: Scope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_hash: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub driver: JobDriver,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schedule: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maestro: Option<MaestroJobPayload>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude_trigger: Option<ClaudeTriggerPayload>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_id: Option<String>,
    #[serde(default)]
    pub notify_on_failure: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_dispatch: Option<LastDispatch>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dispatch {
    pub id: String,
    pub job_id: String,
    pub scope: Scope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_hash: Option<String>,
    pub started_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<i64>,
    pub status: DispatchStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub triggered_by: TriggeredBy,
    #[serde(default)]
    pub output_head: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefaults {
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub id: String,
    pub name: String,
    pub binary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install_check: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default)]
    pub defaults: ToolDefaults,
    pub created_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_round_trips_through_serde_json() {
        let job = Job {
            id: "j1".into(),
            name: "ghd daily".into(),
            enabled: true,
            scope: Scope::Project,
            project_hash: Some("abc123".into()),
            tags: vec!["digest".into()],
            driver: JobDriver::Maestro,
            schedule: Some("0 9 * * *".into()),
            maestro: Some(MaestroJobPayload {
                command: "ghd".into(),
                args: vec!["list".into()],
                cwd: None,
                env: HashMap::new(),
                timeout_sec: Some(900),
            }),
            claude_trigger: None,
            tool_id: None,
            notify_on_failure: true,
            last_dispatch: None,
            created_at: 1_700_000_000,
            updated_at: 1_700_000_000,
        };

        let json = serde_json::to_string(&job).unwrap();
        let back: Job = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "j1");
        assert_eq!(back.driver, JobDriver::Maestro);
        assert!(back.maestro.is_some());
        assert_eq!(back.maestro.as_ref().unwrap().command, "ghd");
        assert!(back.claude_trigger.is_none());
    }

    #[test]
    fn job_driver_serializes_kebab_case() {
        let json = serde_json::to_string(&JobDriver::ClaudeTrigger).unwrap();
        assert_eq!(json, "\"claude-trigger\"");
    }

    #[test]
    fn scope_serializes_lowercase() {
        assert_eq!(serde_json::to_string(&Scope::Global).unwrap(), "\"global\"");
        assert_eq!(serde_json::to_string(&Scope::Project).unwrap(), "\"project\"");
    }
}
