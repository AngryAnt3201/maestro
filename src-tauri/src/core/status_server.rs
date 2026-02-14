//! HTTP-based status server for receiving MCP status reports and REST API.
//!
//! Provides:
//! - `/status` endpoint for MCP status updates (unauthenticated, instance_id validated)
//! - `/api/v1/*` REST API for programmatic session/app management (bearer token auth)

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;

use super::api_types::*;
use super::process_manager::ProcessManager;
use super::session_manager::{AiMode, SessionManager};
use super::worktree_manager::WorktreeManager;

/// Maximum number of pending statuses to buffer (prevents memory leaks).
const MAX_PENDING_STATUSES: usize = 100;

/// Callback for emitting status events. In production this wraps `AppHandle::emit`;
/// in tests it captures events into a `Vec`.
type EmitFn = Arc<dyn Fn(SessionStatusPayload) + Send + Sync>;

/// Status payload received from MCP server.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StatusRequest {
    pub session_id: u32,
    pub instance_id: String,
    pub state: String,
    pub message: String,
    pub needs_input_prompt: Option<String>,
    #[allow(dead_code)]
    pub timestamp: String,
}

/// Payload emitted to the frontend for status changes.
#[derive(Debug, Clone, Serialize)]
pub struct SessionStatusPayload {
    pub session_id: u32,
    pub project_path: String,
    pub status: String,
    pub message: String,
    pub needs_input_prompt: Option<String>,
}

/// State shared with the HTTP handler.
struct ServerState {
    emit_fn: EmitFn,
    instance_id: String,
    api_token: String,
    port: u16,
    /// Maps session_id -> project_path for routing status updates
    session_projects: Arc<RwLock<HashMap<u32, String>>>,
    /// Buffers status requests that arrive before session registration
    pending_statuses: Arc<RwLock<HashMap<u32, StatusRequest>>>,
    /// Tracks auto_push flag per session
    session_auto_push: Arc<RwLock<HashMap<u32, bool>>>,
    /// Manager references for API operations
    process_manager: Arc<ProcessManager>,
    session_manager: Arc<SessionManager>,
    worktree_manager: Arc<WorktreeManager>,
    app_handle: AppHandle,
}

/// HTTP status server that receives status updates from MCP servers.
pub struct StatusServer {
    port: u16,
    instance_id: String,
    api_token: String,
    emit_fn: EmitFn,
    session_projects: Arc<RwLock<HashMap<u32, String>>>,
    pending_statuses: Arc<RwLock<HashMap<u32, StatusRequest>>>,
    session_auto_push: Arc<RwLock<HashMap<u32, bool>>>,
}

/// Build the axum router with the given shared state.
fn build_router(state: Arc<ServerState>) -> Router {
    // Unauthenticated routes (existing MCP status endpoint)
    let public_routes = Router::new()
        .route("/status", post(handle_status));

    // Authenticated API routes
    let api_routes = Router::new()
        .route("/health", get(api_health))
        .route("/sessions", post(api_create_session))
        .route("/sessions", get(api_list_sessions))
        .route("/sessions/{id}", get(api_get_session))
        .route("/sessions/{id}/input", post(api_session_input))
        .route("/sessions/{id}", delete(api_kill_session))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            bearer_auth_middleware,
        ));

    Router::new()
        .merge(public_routes)
        .nest("/api/v1", api_routes)
        .with_state(state)
}

/// Bearer token authentication middleware for API routes.
async fn bearer_auth_middleware(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    request: axum::extract::Request,
    next: Next,
) -> Result<axum::response::Response, StatusCode> {
    let auth_header = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let token = auth_header.strip_prefix("Bearer ").unwrap_or("");

    if token.is_empty() || token != state.api_token {
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(next.run(request).await)
}

/// Create an `EmitFn` from a Tauri `AppHandle`.
fn emit_fn_from_app_handle(app_handle: AppHandle) -> EmitFn {
    Arc::new(move |payload: SessionStatusPayload| {
        if let Err(e) = app_handle.emit("session-status-changed", &payload) {
            eprintln!("[STATUS] EMIT FAILED: {}", e);
        } else {
            eprintln!("[STATUS] EMIT SUCCESS");
        }
    })
}

/// Write token and port to ~/.maestro/ for external tools to discover.
fn write_discovery_files(port: u16, token: &str) {
    if let Ok(home) = std::env::var("HOME") {
        let maestro_dir = PathBuf::from(home).join(".maestro");
        if std::fs::create_dir_all(&maestro_dir).is_ok() {
            let _ = std::fs::write(maestro_dir.join("api-token"), token);
            let _ = std::fs::write(maestro_dir.join("api-port"), port.to_string());
            log::info!("Wrote API discovery files to ~/.maestro/");
        }
    }
}

impl StatusServer {
    /// Find and bind to an available port in the given range.
    /// Returns the bound listener to avoid race conditions.
    async fn find_and_bind_port(range_start: u16, range_end: u16) -> Option<(u16, tokio::net::TcpListener)> {
        for port in range_start..=range_end {
            let addr = format!("127.0.0.1:{}", port);
            if let Ok(listener) = tokio::net::TcpListener::bind(&addr).await {
                return Some((port, listener));
            }
        }
        None
    }

    /// Generate a stable hash for a project path.
    /// Uses first 12 characters of SHA256 hex for uniqueness.
    pub fn generate_project_hash(project_path: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(project_path.as_bytes());
        let result = hasher.finalize();
        hex::encode(&result[..6])
    }

    /// Start the HTTP status server with API support.
    pub async fn start(
        app_handle: AppHandle,
        instance_id: String,
        process_manager: Arc<ProcessManager>,
        session_manager: Arc<SessionManager>,
        worktree_manager: Arc<WorktreeManager>,
    ) -> Option<Self> {
        let (port, listener) = Self::find_and_bind_port(9900, 9999).await?;
        let session_projects = Arc::new(RwLock::new(HashMap::new()));
        let pending_statuses = Arc::new(RwLock::new(HashMap::new()));
        let session_auto_push = Arc::new(RwLock::new(HashMap::new()));
        let emit_fn = emit_fn_from_app_handle(app_handle.clone());
        let api_token = uuid::Uuid::new_v4().to_string();

        // Write discovery files for external tools
        write_discovery_files(port, &api_token);

        let state = Arc::new(ServerState {
            emit_fn: emit_fn.clone(),
            instance_id: instance_id.clone(),
            api_token: api_token.clone(),
            port,
            session_projects: session_projects.clone(),
            pending_statuses: pending_statuses.clone(),
            session_auto_push: session_auto_push.clone(),
            process_manager,
            session_manager,
            worktree_manager,
            app_handle,
        });

        let app = build_router(state);

        let addr = format!("127.0.0.1:{}", port);
        eprintln!("[STATUS SERVER] Started on http://{}", addr);
        eprintln!("[STATUS SERVER] Instance ID: {}", instance_id);

        tokio::spawn(async move {
            if let Err(e) = axum::serve(listener, app).await {
                eprintln!("[STATUS SERVER] Error: {}", e);
            }
        });

        Some(Self {
            port,
            instance_id,
            api_token,
            emit_fn,
            session_projects,
            pending_statuses,
            session_auto_push,
        })
    }

    /// Get the port the server is listening on.
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Get the instance ID for this server.
    pub fn instance_id(&self) -> &str {
        &self.instance_id
    }

    /// Get the API token for authentication.
    pub fn api_token(&self) -> &str {
        &self.api_token
    }

    /// Get the status URL for MCP servers to report to.
    pub fn status_url(&self) -> String {
        format!("http://127.0.0.1:{}/status", self.port)
    }

    /// Register a session with its project path.
    /// This allows routing status updates to the correct project.
    /// Also flushes any buffered status that arrived before registration.
    pub async fn register_session(&self, session_id: u32, project_path: &str) {
        {
            let mut projects = self.session_projects.write().await;
            projects.insert(session_id, project_path.to_string());
        }
        eprintln!(
            "[STATUS SERVER] Registered session {} for project '{}'",
            session_id,
            project_path
        );

        // Check for and flush any buffered status for this session
        let buffered = {
            let mut pending = self.pending_statuses.write().await;
            pending.remove(&session_id)
        };

        if let Some(payload) = buffered {
            eprintln!(
                "[STATUS SERVER] Flushing buffered status for session {}: state={}",
                session_id, payload.state
            );
            emit_status(&self.emit_fn, session_id, project_path, &payload);
        }
    }

    /// Unregister a session when it's killed.
    pub async fn unregister_session(&self, session_id: u32) {
        let mut projects = self.session_projects.write().await;
        if projects.remove(&session_id).is_some() {
            log::debug!("Unregistered session {}", session_id);
        }
        drop(projects);
        let mut pending = self.pending_statuses.write().await;
        pending.remove(&session_id);
        drop(pending);
        let mut auto_push = self.session_auto_push.write().await;
        auto_push.remove(&session_id);
    }

    /// Get list of registered session IDs (for debugging).
    pub async fn registered_sessions(&self) -> Vec<u32> {
        let projects = self.session_projects.read().await;
        projects.keys().copied().collect()
    }

    /// Set auto_push flag for a session.
    pub async fn set_auto_push(&self, session_id: u32, auto_push: bool) {
        let mut map = self.session_auto_push.write().await;
        map.insert(session_id, auto_push);
    }
}

/// Map MCP state string to session status string and call the emit function.
fn emit_status(
    emit_fn: &EmitFn,
    session_id: u32,
    project_path: &str,
    payload: &StatusRequest,
) {
    let status = match payload.state.as_str() {
        "idle" => "Idle",
        "working" => "Working",
        "needs_input" => "NeedsInput",
        "finished" => "Done",
        "error" => "Error",
        other => {
            log::warn!("Unknown status state: {}", other);
            "Unknown"
        }
    };

    eprintln!(
        "[STATUS] EMITTING: session={} status={} project={}",
        session_id, status, project_path
    );

    let event_payload = SessionStatusPayload {
        session_id,
        project_path: project_path.to_string(),
        status: status.to_string(),
        message: payload.message.clone(),
        needs_input_prompt: payload.needs_input_prompt.clone(),
    };

    (emit_fn)(event_payload);
}

// ─── MCP Status Handler (unauthenticated) ────────────────────────────────

/// Handle incoming status POST requests.
async fn handle_status(
    State(state): State<Arc<ServerState>>,
    Json(payload): Json<StatusRequest>,
) -> StatusCode {
    eprintln!(
        "[STATUS] Received: session_id={}, instance_id={}, state={}",
        payload.session_id,
        payload.instance_id,
        payload.state
    );

    // Verify this request is for our instance
    if payload.instance_id != state.instance_id {
        eprintln!(
            "[STATUS] REJECTED - wrong instance: expected {}, got {}",
            state.instance_id,
            payload.instance_id
        );
        return StatusCode::FORBIDDEN;
    }

    // Check for auto-push on finished state
    if payload.state == "finished" {
        let should_push = {
            let auto_push = state.session_auto_push.read().await;
            auto_push.get(&payload.session_id).copied().unwrap_or(false)
        };
        if should_push {
            let session_id = payload.session_id;
            let sm = state.session_manager.clone();
            let app_handle = state.app_handle.clone();
            tokio::spawn(async move {
                if let Some(session) = sm.get_session(session_id) {
                    if let Some(ref branch) = session.branch {
                        // Safety: never force push to main/master
                        let protected = ["main", "master"];
                        if !protected.contains(&branch.as_str()) {
                            let cwd = session
                                .worktree_path
                                .as_deref()
                                .unwrap_or(&session.project_path);
                            let git = crate::git::runner::Git::new(cwd);
                            match git
                                .run(&["push", "origin", branch, "-u"])
                                .await
                            {
                                Ok(_) => {
                                    log::info!(
                                        "Auto-push succeeded for session {} branch {}",
                                        session_id,
                                        branch
                                    );
                                    let _ = app_handle.emit(
                                        "session-auto-push",
                                        serde_json::json!({
                                            "session_id": session_id,
                                            "branch": branch,
                                            "success": true,
                                        }),
                                    );
                                }
                                Err(e) => {
                                    log::error!(
                                        "Auto-push failed for session {}: {}",
                                        session_id,
                                        e
                                    );
                                    let _ = app_handle.emit(
                                        "session-auto-push",
                                        serde_json::json!({
                                            "session_id": session_id,
                                            "branch": branch,
                                            "success": false,
                                            "error": e.to_string(),
                                        }),
                                    );
                                }
                            }
                        } else {
                            log::warn!(
                                "Auto-push skipped for session {}: protected branch {}",
                                session_id,
                                branch
                            );
                        }
                    }
                }
            });
        }
    }

    // Get the project path for this session
    let project_path = {
        let projects = state.session_projects.read().await;
        eprintln!(
            "[STATUS] Registered sessions: {:?}",
            projects.keys().collect::<Vec<_>>()
        );
        projects.get(&payload.session_id).cloned()
    };

    let project_path = match project_path {
        Some(p) => p,
        None => {
            eprintln!(
                "[STATUS] BUFFERED - unknown session {}, will flush on registration",
                payload.session_id
            );
            let mut pending = state.pending_statuses.write().await;
            if pending.len() < MAX_PENDING_STATUSES {
                pending.insert(payload.session_id, payload);
            } else {
                eprintln!(
                    "[STATUS] WARNING - pending buffer full ({}), dropping status for session {}",
                    MAX_PENDING_STATUSES, payload.session_id
                );
            }
            return StatusCode::ACCEPTED;
        }
    };

    emit_status(&state.emit_fn, payload.session_id, &project_path, &payload);

    StatusCode::OK
}

// ─── REST API Handlers (authenticated) ───────────────────────────────────

/// GET /api/v1/health
async fn api_health(
    State(state): State<Arc<ServerState>>,
) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        instance_id: state.instance_id.clone(),
        port: state.port,
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

/// POST /api/v1/sessions — create a new session via API.
async fn api_create_session(
    State(state): State<Arc<ServerState>>,
    Json(req): Json<CreateSessionRequest>,
) -> Result<(StatusCode, Json<CreateSessionResponse>), (StatusCode, Json<ApiError>)> {
    let project_path = req.project_path.clone();

    // Resolve AI mode
    let mode = match req.mode.to_lowercase().as_str() {
        "claude" => AiMode::Claude,
        "gemini" => AiMode::Gemini,
        "codex" => AiMode::Codex,
        "plain" => AiMode::Plain,
        _ => AiMode::Claude,
    };

    // Prepare worktree if branch is specified
    let mut working_directory = project_path.clone();
    let mut worktree_path: Option<String> = None;

    if let Some(ref branch) = req.branch {
        if !branch.is_empty() {
            let repo_path = PathBuf::from(&project_path);
            match state.worktree_manager.create(branch, &repo_path).await {
                Ok(wt_path) => {
                    working_directory = wt_path.to_string_lossy().to_string();
                    worktree_path = Some(working_directory.clone());
                }
                Err(e) => {
                    log::warn!("Failed to create worktree for branch '{}': {}", branch, e);
                    // Fall through — use project_path as working directory
                }
            }
        }
    }

    // Build environment
    let mut env = req.env.unwrap_or_default();
    env.insert(
        "MAESTRO_STATUS_URL".to_string(),
        format!("http://127.0.0.1:{}/status", state.port),
    );
    env.insert(
        "MAESTRO_INSTANCE_ID".to_string(),
        state.instance_id.clone(),
    );

    // Spawn shell
    let session_id = match state.process_manager.spawn_shell(
        state.app_handle.clone(),
        Some(working_directory.clone()),
        Some(env),
    ) {
        Ok(id) => id,
        Err(e) => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError {
                    error: format!("Failed to spawn shell: {}", e),
                }),
            ));
        }
    };

    // Create session in session manager
    let _ = state
        .session_manager
        .create_session(session_id, mode, project_path.clone());

    // Assign branch if provided
    if let Some(ref branch) = req.branch {
        if !branch.is_empty() {
            state
                .session_manager
                .assign_branch(session_id, branch.clone(), worktree_path.clone());
        }
    }

    // Register session for status routing
    {
        let mut projects = state.session_projects.write().await;
        projects.insert(session_id, project_path.clone());
    }

    // Track auto_push
    if req.auto_push {
        let mut auto_push = state.session_auto_push.write().await;
        auto_push.insert(session_id, true);
    }

    // After a delay, launch claude in the terminal
    if let Some(ref initial_prompt) = req.initial_prompt {
        let pm = state.process_manager.clone();
        let prompt = initial_prompt.clone();
        let sid = session_id;
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let command = format!("claude --dangerously-skip-permissions \"{}\"\n", prompt.replace('"', "\\\""));
            if let Err(e) = pm.write_stdin(sid, command) {
                log::error!("Failed to write initial prompt to session {}: {}", sid, e);
            }
        });
    }

    Ok((
        StatusCode::CREATED,
        Json(CreateSessionResponse {
            session_id,
            status: "Starting".to_string(),
            worktree_path,
            working_directory,
        }),
    ))
}

/// GET /api/v1/sessions — list all sessions.
async fn api_list_sessions(
    State(state): State<Arc<ServerState>>,
) -> Json<Vec<SessionDetail>> {
    let sessions = state.session_manager.all_sessions();
    let details: Vec<SessionDetail> = sessions
        .into_iter()
        .map(|s| SessionDetail {
            id: s.id,
            status: format!("{:?}", s.status),
            mode: format!("{:?}", s.mode),
            branch: s.branch,
            worktree_path: s.worktree_path,
            project_path: s.project_path,
        })
        .collect();
    Json(details)
}

/// GET /api/v1/sessions/:id — get session detail.
async fn api_get_session(
    State(state): State<Arc<ServerState>>,
    Path(id): Path<u32>,
) -> Result<Json<SessionDetail>, StatusCode> {
    match state.session_manager.get_session(id) {
        Some(s) => Ok(Json(SessionDetail {
            id: s.id,
            status: format!("{:?}", s.status),
            mode: format!("{:?}", s.mode),
            branch: s.branch,
            worktree_path: s.worktree_path,
            project_path: s.project_path,
        })),
        None => Err(StatusCode::NOT_FOUND),
    }
}

/// POST /api/v1/sessions/:id/input — write to session stdin.
async fn api_session_input(
    State(state): State<Arc<ServerState>>,
    Path(id): Path<u32>,
    Json(req): Json<SessionInputRequest>,
) -> Result<StatusCode, (StatusCode, Json<ApiError>)> {
    match state.process_manager.write_stdin(id, req.text) {
        Ok(_) => Ok(StatusCode::OK),
        Err(e) => Err((
            StatusCode::NOT_FOUND,
            Json(ApiError {
                error: format!("Session not found or write failed: {}", e),
            }),
        )),
    }
}

/// DELETE /api/v1/sessions/:id — kill a session.
async fn api_kill_session(
    State(state): State<Arc<ServerState>>,
    Path(id): Path<u32>,
) -> StatusCode {
    state.process_manager.kill_session(id);
    state.session_manager.remove_session(id);
    let mut projects = state.session_projects.write().await;
    projects.remove(&id);
    drop(projects);
    let mut auto_push = state.session_auto_push.write().await;
    auto_push.remove(&id);
    StatusCode::NO_CONTENT
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Collected events from the test emit function.
    type EventLog = Arc<std::sync::Mutex<Vec<SessionStatusPayload>>>;

    /// Create a test EmitFn that captures events into a shared Vec.
    fn test_emit_fn() -> (EmitFn, EventLog) {
        let events: EventLog = Arc::new(std::sync::Mutex::new(Vec::new()));
        let events_clone = events.clone();
        let emit_fn: EmitFn = Arc::new(move |payload| {
            events_clone.lock().unwrap().push(payload);
        });
        (emit_fn, events)
    }

    /// Create a test StatusServer (no real port, no AppHandle).
    fn test_server(instance_id: &str, emit_fn: EmitFn) -> StatusServer {
        StatusServer {
            port: 0,
            instance_id: instance_id.to_string(),
            api_token: "test-token".to_string(),
            emit_fn,
            session_projects: Arc::new(RwLock::new(HashMap::new())),
            pending_statuses: Arc::new(RwLock::new(HashMap::new())),
            session_auto_push: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Helper: build a StatusRequest for testing.
    fn make_status(session_id: u32, instance_id: &str, state: &str, message: &str) -> StatusRequest {
        StatusRequest {
            session_id,
            instance_id: instance_id.to_string(),
            state: state.to_string(),
            message: message.to_string(),
            needs_input_prompt: None,
            timestamp: "2024-01-01T00:00:00Z".to_string(),
        }
    }

    // ── Hash tests ──────────────────────────────────────────────────

    #[test]
    fn test_generate_project_hash() {
        let hash = StatusServer::generate_project_hash("/Users/test/project");
        assert_eq!(hash.len(), 12);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_hash_consistency() {
        let hash1 = StatusServer::generate_project_hash("/Users/test/project");
        let hash2 = StatusServer::generate_project_hash("/Users/test/project");
        assert_eq!(hash1, hash2);
    }

    // ── StatusServer method tests (buffering / flushing) ────────────

    #[tokio::test]
    async fn test_register_flushes_buffered_status() {
        let (emit_fn, events) = test_emit_fn();
        let server = test_server("inst-1", emit_fn);

        server.pending_statuses.write().await.insert(
            7,
            make_status(7, "inst-1", "idle", "Buffered hello"),
        );

        server.register_session(7, "/path/project-x").await;

        let emitted = events.lock().unwrap();
        assert_eq!(emitted.len(), 1);
        assert_eq!(emitted[0].session_id, 7);
        assert_eq!(emitted[0].project_path, "/path/project-x");
        assert_eq!(emitted[0].status, "Idle");
        assert_eq!(emitted[0].message, "Buffered hello");

        assert!(server.pending_statuses.read().await.is_empty());
    }

    #[tokio::test]
    async fn test_register_without_buffer_emits_nothing() {
        let (emit_fn, events) = test_emit_fn();
        let server = test_server("inst-1", emit_fn);

        server.register_session(1, "/path/project").await;

        assert!(events.lock().unwrap().is_empty());
        assert_eq!(server.registered_sessions().await, vec![1]);
    }

    #[tokio::test]
    async fn test_unregister_cleans_up_buffer() {
        let (emit_fn, _events) = test_emit_fn();
        let server = test_server("inst-1", emit_fn);

        server.pending_statuses.write().await.insert(
            3,
            make_status(3, "inst-1", "working", "Will be cleaned"),
        );
        server.register_session(3, "/path/project").await;
        server.unregister_session(3).await;

        assert!(server.session_projects.read().await.is_empty());
        assert!(server.pending_statuses.read().await.is_empty());
    }

    #[tokio::test]
    async fn test_multiple_projects_register_unregister_isolation() {
        let (emit_fn, events) = test_emit_fn();
        let server = test_server("inst-1", emit_fn);

        server.register_session(1, "/project/alpha").await;
        server.register_session(2, "/project/beta").await;
        server.register_session(3, "/project/alpha").await;

        server.pending_statuses.write().await.insert(
            4,
            make_status(4, "inst-1", "idle", "Waiting"),
        );

        server.unregister_session(1).await;

        let registered = server.registered_sessions().await;
        assert!(registered.contains(&2));
        assert!(registered.contains(&3));
        assert!(!registered.contains(&1));

        server.register_session(4, "/project/gamma").await;

        let emitted = events.lock().unwrap();
        assert_eq!(emitted.len(), 1);
        assert_eq!(emitted[0].session_id, 4);
        assert_eq!(emitted[0].project_path, "/project/gamma");
    }

    #[tokio::test]
    async fn test_all_state_mappings() {
        let (emit_fn, events) = test_emit_fn();
        let server = test_server("inst-1", emit_fn);

        // Test emit_status directly instead of through HTTP
        for (mcp_state, expected_status) in [
            ("idle", "Idle"),
            ("working", "Working"),
            ("needs_input", "NeedsInput"),
            ("finished", "Done"),
            ("error", "Error"),
        ] {
            let payload = make_status(1, "inst-1", mcp_state, "msg");
            emit_status(&server.emit_fn, 1, "/path/p", &payload);
        }

        let emitted = events.lock().unwrap();
        assert_eq!(emitted.len(), 5);
        assert_eq!(emitted[0].status, "Idle");
        assert_eq!(emitted[1].status, "Working");
        assert_eq!(emitted[2].status, "NeedsInput");
        assert_eq!(emitted[3].status, "Done");
        assert_eq!(emitted[4].status, "Error");
    }
}
