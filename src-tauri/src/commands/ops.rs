//! Tauri command handlers for Ops.

use crate::core::ops::drivers::{claude_trigger::ClaudeTriggerDriver, Driver, DispatchEvent, ExternalJob};
use crate::core::ops::drivers::maestro::MaestroDriver;
use crate::core::ops::model::{Dispatch, DispatchStatus, Job, JobDriver, LastDispatch, Scope, Tool, TriggeredBy};
use crate::core::ops::scheduler::{Scheduler, DEFAULT_CONCURRENCY_CAP};
use crate::core::ops::store;
use crate::core::ops::dispatch_log;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, Mutex};

#[derive(Debug, Clone)]
pub struct DispatchTarget {
    pub scope: Scope,
    pub project_hash: Option<String>,
    pub job_id: String,
}

/// App-wide Ops state held in Tauri's managed state.
pub struct OpsState {
    pub maestro_scheduler: Arc<Scheduler>,
    pub claude_driver: Arc<ClaudeTriggerDriver>,
    pub jobs_by_scope: Mutex<HashMap<String, Vec<Job>>>,
    pub dispatches: Mutex<HashMap<String, DispatchTarget>>,
    pub app: AppHandle,
}

fn scope_key(scope: Scope, project_hash: Option<&str>) -> String {
    match scope {
        Scope::Global => "global".to_string(),
        Scope::Project => format!("project:{}", project_hash.unwrap_or("")),
    }
}

impl OpsState {
    pub fn new(app: AppHandle) -> Arc<Self> {
        let maestro: Arc<dyn Driver> = Arc::new(MaestroDriver::new());
        let (events_tx, events_rx) = mpsc::unbounded_channel::<DispatchEvent>();
        let scheduler = Arc::new(Scheduler::new(maestro, events_tx, DEFAULT_CONCURRENCY_CAP));
        scheduler.clone().spawn();

        let claude_driver = Arc::new(ClaudeTriggerDriver::new());
        let state = Arc::new(Self {
            maestro_scheduler: scheduler,
            claude_driver,
            jobs_by_scope: Mutex::new(HashMap::new()),
            dispatches: Mutex::new(HashMap::new()),
            app: app.clone(),
        });

        let state_fwd = state.clone();
        tokio::spawn(async move {
            let mut rx = events_rx;
            while let Some(evt) = rx.recv().await {
                state_fwd.handle_dispatch_event(evt).await;
            }
        });
        state
    }

    async fn handle_dispatch_event(self: &Arc<Self>, evt: DispatchEvent) {
        match &evt {
            DispatchEvent::Output { dispatch_id, chunk, is_stderr } => {
                if let Some((scope, project_hash, _job_id)) = self.lookup_dispatch_scope(dispatch_id).await {
                    let _ = dispatch_log::append_log(scope, project_hash.as_deref(), dispatch_id, chunk.as_bytes());
                }
                let _ = self.app.emit("ops://dispatch-output", serde_json::json!({
                    "dispatchId": dispatch_id,
                    "chunk": chunk,
                    "isStderr": is_stderr,
                }));
            }
            DispatchEvent::Finished { dispatch_id, status, exit_code, tokens } => {
                let _ = self.app.emit("ops://dispatch-finished", serde_json::json!({
                    "dispatchId": dispatch_id,
                    "status": status,
                    "exitCode": exit_code,
                    "tokens": tokens,
                }));
                if let Some((scope, project_hash, job_id)) = self.lookup_dispatch_scope(dispatch_id).await {
                    let rec = Dispatch {
                        id: dispatch_id.clone(),
                        job_id: job_id.clone(),
                        scope,
                        project_hash: project_hash.clone(),
                        started_at: chrono::Utc::now().timestamp(),
                        ended_at: Some(chrono::Utc::now().timestamp()),
                        status: *status,
                        exit_code: *exit_code,
                        triggered_by: TriggeredBy::Manual,
                        output_head: dispatch_log::read_log_tail(scope, project_hash.as_deref(), dispatch_id, 2048).unwrap_or_default(),
                        log_path: dispatch_log::log_path(scope, project_hash.as_deref(), dispatch_id).ok().and_then(|p| p.to_str().map(|s| s.to_string())),
                        tokens: *tokens,
                        duration_ms: None,
                    };
                    let _ = store::append_dispatch(scope, project_hash.as_deref(), &rec);
                    self.update_last_dispatch(scope, project_hash.as_deref(), &job_id, &rec).await;
                    let _ = dispatch_log::rotate(scope, project_hash.as_deref(), chrono::Utc::now().timestamp());
                    self.forget_dispatch(dispatch_id).await;
                }
            }
        }
    }

    async fn lookup_dispatch_scope(&self, dispatch_id: &str) -> Option<(Scope, Option<String>, String)> {
        let map = self.dispatches.lock().await;
        map.get(dispatch_id).map(|t| (t.scope, t.project_hash.clone(), t.job_id.clone()))
    }

    pub async fn register_dispatch(&self, dispatch_id: &str, target: DispatchTarget) {
        self.dispatches.lock().await.insert(dispatch_id.to_string(), target);
    }

    pub async fn forget_dispatch(&self, dispatch_id: &str) {
        self.dispatches.lock().await.remove(dispatch_id);
    }

    async fn update_last_dispatch(
        &self,
        scope: Scope,
        project_hash: Option<&str>,
        job_id: &str,
        rec: &Dispatch,
    ) {
        let key = scope_key(scope, project_hash);
        let mut map = self.jobs_by_scope.lock().await;
        if let Some(list) = map.get_mut(&key) {
            if let Some(j) = list.iter_mut().find(|j| j.id == job_id) {
                j.last_dispatch = Some(LastDispatch {
                    id: rec.id.clone(),
                    started_at: rec.started_at,
                    status: rec.status,
                });
                let _ = store::save_jobs(scope, project_hash, list);
            }
        }
    }
}

#[tauri::command]
pub async fn ops_load_jobs(
    state: State<'_, Arc<OpsState>>,
    scope: Scope,
    project_hash: Option<String>,
) -> Result<Vec<Job>, String> {
    let jobs = store::load_jobs(scope, project_hash.as_deref()).map_err(|e| e.to_string())?;
    let key = scope_key(scope, project_hash.as_deref());
    state.jobs_by_scope.lock().await.insert(key, jobs.clone());
    state.maestro_scheduler.set_jobs(jobs.clone()).await;
    Ok(jobs)
}

#[tauri::command]
pub async fn ops_save_job(
    state: State<'_, Arc<OpsState>>,
    scope: Scope,
    project_hash: Option<String>,
    mut job: Job,
) -> Result<Job, String> {
    if scope == Scope::Project && project_hash.is_none() {
        return Err("project scope requires projectHash".into());
    }
    if job.id.is_empty() {
        job.id = uuid::Uuid::new_v4().to_string();
        job.created_at = chrono::Utc::now().timestamp();
    }
    job.updated_at = chrono::Utc::now().timestamp();
    job.scope = scope;
    job.project_hash = project_hash.clone();

    match job.driver {
        JobDriver::ClaudeTrigger => {
            match state.claude_driver.create(&job).await {
                Ok(meta) => {
                    if let Some(ct) = job.claude_trigger.as_mut() {
                        ct.trigger_id = meta.trigger_id;
                    }
                }
                Err(e) => return Err(e.to_string()),
            }
        }
        JobDriver::Maestro => {}
    }

    let mut existing = store::load_jobs(scope, project_hash.as_deref()).map_err(|e| e.to_string())?;
    existing.retain(|j| j.id != job.id);
    existing.push(job.clone());
    store::save_jobs(scope, project_hash.as_deref(), &existing).map_err(|e| e.to_string())?;

    state.jobs_by_scope.lock().await.insert(scope_key(scope, project_hash.as_deref()), existing.clone());
    state.maestro_scheduler.set_jobs(existing).await;

    let _ = state.app.emit("ops://jobs-updated", serde_json::json!({
        "scope": scope, "projectHash": project_hash,
    }));
    Ok(job)
}

#[tauri::command]
pub async fn ops_delete_job(
    state: State<'_, Arc<OpsState>>,
    scope: Scope,
    project_hash: Option<String>,
    job_id: String,
) -> Result<(), String> {
    let mut jobs = store::load_jobs(scope, project_hash.as_deref()).map_err(|e| e.to_string())?;
    if let Some(job) = jobs.iter().find(|j| j.id == job_id).cloned() {
        if job.driver == JobDriver::ClaudeTrigger {
            return Err("claude-trigger delete is not supported; open https://claude.ai/code/scheduled".into());
        }
    }
    jobs.retain(|j| j.id != job_id);
    store::save_jobs(scope, project_hash.as_deref(), &jobs).map_err(|e| e.to_string())?;
    state.jobs_by_scope.lock().await.insert(scope_key(scope, project_hash.as_deref()), jobs.clone());
    state.maestro_scheduler.set_jobs(jobs).await;
    let _ = state.app.emit("ops://jobs-updated", serde_json::json!({ "scope": scope, "projectHash": project_hash }));
    Ok(())
}

#[tauri::command]
pub async fn ops_run_now(
    state: State<'_, Arc<OpsState>>,
    scope: Scope,
    project_hash: Option<String>,
    job_id: String,
) -> Result<String, String> {
    let jobs = store::load_jobs(scope, project_hash.as_deref()).map_err(|e| e.to_string())?;
    let job = jobs.into_iter().find(|j| j.id == job_id)
        .ok_or_else(|| "job not found".to_string())?;

    let dispatch_id = match job.driver {
        JobDriver::Maestro => state.maestro_scheduler.dispatch_now(&job, TriggeredBy::Manual).await,
        JobDriver::ClaudeTrigger => {
            let id = uuid::Uuid::new_v4().to_string();
            let ctx = crate::core::ops::drivers::DispatchContext {
                dispatch_id: id.clone(),
                triggered_by: TriggeredBy::Manual,
            };
            let (tx, mut rx) = mpsc::unbounded_channel::<DispatchEvent>();
            let driver = state.claude_driver.clone();
            let job_clone = job.clone();
            tokio::spawn(async move {
                let _ = driver.run_now(&job_clone, ctx, tx).await;
            });
            let app = state.app.clone();
            tokio::spawn(async move {
                while let Some(evt) = rx.recv().await {
                    let _ = app.emit("ops://dispatch-output-claude", serde_json::json!(evt));
                }
            });
            id
        }
    };

    state.register_dispatch(&dispatch_id, DispatchTarget {
        scope,
        project_hash: project_hash.clone(),
        job_id: job_id.clone(),
    }).await;

    let _ = state.app.emit("ops://dispatch-started", serde_json::json!({
        "dispatchId": dispatch_id,
        "jobId": job_id,
    }));
    Ok(dispatch_id)
}

#[tauri::command]
pub async fn ops_recent_dispatches(
    scope: Scope,
    project_hash: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<Dispatch>, String> {
    store::recent_dispatches(scope, project_hash.as_deref(), limit.unwrap_or(100))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ops_load_tools() -> Result<Vec<Tool>, String> {
    store::load_tools().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ops_save_tool(mut tool: Tool) -> Result<Tool, String> {
    if tool.id.is_empty() {
        tool.id = uuid::Uuid::new_v4().to_string();
        tool.created_at = chrono::Utc::now().timestamp();
    }
    let mut tools = store::load_tools().map_err(|e| e.to_string())?;
    tools.retain(|t| t.id != tool.id);
    tools.push(tool.clone());
    store::save_tools(&tools).map_err(|e| e.to_string())?;
    Ok(tool)
}

#[tauri::command]
pub async fn ops_delete_tool(tool_id: String) -> Result<(), String> {
    let mut tools = store::load_tools().map_err(|e| e.to_string())?;
    tools.retain(|t| t.id != tool_id);
    store::save_tools(&tools).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ops_list_external_triggers(
    state: State<'_, Arc<OpsState>>,
) -> Result<Vec<ExternalJob>, String> {
    state.claude_driver.list_external().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ops_read_log_tail(
    scope: Scope,
    project_hash: Option<String>,
    dispatch_id: String,
    max_bytes: Option<usize>,
) -> Result<String, String> {
    dispatch_log::read_log_tail(scope, project_hash.as_deref(), &dispatch_id, max_bytes.unwrap_or(64 * 1024))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ops_project_hash(project_path: String) -> Result<String, String> {
    Ok(store::hash_project_path(std::path::Path::new(&project_path)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverCapsResponse {
    pub maestro: crate::core::ops::drivers::DriverCapabilities,
    pub claude_trigger: crate::core::ops::drivers::DriverCapabilities,
}

#[tauri::command]
pub async fn ops_driver_capabilities() -> DriverCapsResponse {
    use crate::core::ops::drivers::Driver as _;
    let m = MaestroDriver::new();
    let c = ClaudeTriggerDriver::new();
    DriverCapsResponse {
        maestro: m.capabilities(),
        claude_trigger: c.capabilities(),
    }
}

#[tauri::command]
pub async fn ops_read_hooks(project_path: Option<String>) -> Result<crate::core::ops::hooks_reader::HooksSnapshot, String> {
    let path = project_path.map(std::path::PathBuf::from);
    crate::core::ops::hooks_reader::snapshot(path.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ops_toggle_hook(project_path: Option<String>, id: String, enable: bool) -> Result<(), String> {
    let path = project_path.map(std::path::PathBuf::from);
    crate::core::ops::hooks_reader::toggle(path.as_deref(), &id, enable)
        .map_err(|e| e.to_string())
}

use crate::core::ops::secrets::{self, SecretEntry};

#[tauri::command]
pub async fn ops_list_secrets() -> Result<Vec<SecretEntry>, String> {
    secrets::list().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ops_put_secret(entry: SecretEntry, value: String) -> Result<SecretEntry, String> {
    let mut e = entry;
    if e.id.is_empty() { e.id = uuid::Uuid::new_v4().to_string(); }
    if e.created_at == 0 { e.created_at = chrono::Utc::now().timestamp(); }
    secrets::put(e, &value)
}

#[tauri::command]
pub async fn ops_delete_secret(id: String) -> Result<(), String> {
    secrets::delete(&id)
}
