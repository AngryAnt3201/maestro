//! HTTP-based status server for receiving MCP status reports.
//!
//! Replaces the file-polling approach with an HTTP endpoint that receives
//! status updates from the Rust MCP server. Provides real-time updates
//! and eliminates race conditions.

use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    extract::State,
    http::StatusCode,
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;

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
    /// Maps session_id -> project_path for routing status updates
    session_projects: Arc<RwLock<HashMap<u32, String>>>,
    /// Buffers status requests that arrive before session registration
    pending_statuses: Arc<RwLock<HashMap<u32, StatusRequest>>>,
}

/// HTTP status server that receives status updates from MCP servers.
pub struct StatusServer {
    port: u16,
    instance_id: String,
    emit_fn: EmitFn,
    session_projects: Arc<RwLock<HashMap<u32, String>>>,
    pending_statuses: Arc<RwLock<HashMap<u32, StatusRequest>>>,
}

/// Build the axum router with the given shared state.
fn build_router(state: Arc<ServerState>) -> Router {
    Router::new()
        .route("/status", post(handle_status))
        .with_state(state)
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

    /// Start the HTTP status server.
    ///
    /// Returns the server instance with the port it's listening on.
    pub async fn start(app_handle: AppHandle, instance_id: String) -> Option<Self> {
        // Find and bind in one step to avoid race conditions where another
        // process grabs the port between checking and binding
        let (port, listener) = Self::find_and_bind_port(9900, 9999).await?;
        let session_projects = Arc::new(RwLock::new(HashMap::new()));
        let pending_statuses = Arc::new(RwLock::new(HashMap::new()));
        let emit_fn = emit_fn_from_app_handle(app_handle);

        let state = Arc::new(ServerState {
            emit_fn: emit_fn.clone(),
            instance_id: instance_id.clone(),
            session_projects: session_projects.clone(),
            pending_statuses: pending_statuses.clone(),
        });

        let app = build_router(state);

        let addr = format!("127.0.0.1:{}", port);
        eprintln!("[STATUS SERVER] Started on http://{}", addr);
        eprintln!("[STATUS SERVER] Instance ID: {}", instance_id);

        // Spawn the server in the background
        tokio::spawn(async move {
            if let Err(e) = axum::serve(listener, app).await {
                eprintln!("[STATUS SERVER] Error: {}", e);
            }
        });

        Some(Self {
            port,
            instance_id,
            emit_fn,
            session_projects,
            pending_statuses,
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
        // Also clean up any buffered status
        drop(projects);
        let mut pending = self.pending_statuses.write().await;
        pending.remove(&session_id);
    }

    /// Get list of registered session IDs (for debugging).
    pub async fn registered_sessions(&self) -> Vec<u32> {
        let projects = self.session_projects.read().await;
        projects.keys().copied().collect()
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
            // Session not registered yet — buffer the status for later
            eprintln!(
                "[STATUS] BUFFERED - unknown session {}, will flush on registration",
                payload.session_id
            );
            let mut pending = state.pending_statuses.write().await;
            // Enforce bounded buffer size
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
            emit_fn,
            session_projects: Arc::new(RwLock::new(HashMap::new())),
            pending_statuses: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Spin up a real HTTP server backed by our handler, returning its address.
    async fn start_test_http_server(
        instance_id: &str,
        emit_fn: EmitFn,
    ) -> (
        std::net::SocketAddr,
        Arc<RwLock<HashMap<u32, String>>>,
        Arc<RwLock<HashMap<u32, StatusRequest>>>,
    ) {
        let session_projects = Arc::new(RwLock::new(HashMap::new()));
        let pending_statuses = Arc::new(RwLock::new(HashMap::new()));

        let state = Arc::new(ServerState {
            emit_fn,
            instance_id: instance_id.to_string(),
            session_projects: session_projects.clone(),
            pending_statuses: pending_statuses.clone(),
        });

        let app = build_router(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        (addr, session_projects, pending_statuses)
    }

    /// Helper: POST a status request to the test server.
    async fn post_status(addr: std::net::SocketAddr, payload: &StatusRequest) -> u16 {
        reqwest::Client::new()
            .post(format!("http://{}/status", addr))
            .json(payload)
            .send()
            .await
            .unwrap()
            .status()
            .as_u16()
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

    // ── HTTP handler tests (multi-session routing) ──────────────────

    #[tokio::test]
    async fn test_multi_session_different_projects() {
        let (emit_fn, events) = test_emit_fn();
        let (addr, projects, _) = start_test_http_server("inst-1", emit_fn).await;

        // Register two sessions for different projects
        projects.write().await.insert(1, "/path/project-a".to_string());
        projects.write().await.insert(2, "/path/project-b".to_string());

        // Send status for each
        assert_eq!(post_status(addr, &make_status(1, "inst-1", "working", "Building")).await, 200);
        assert_eq!(post_status(addr, &make_status(2, "inst-1", "idle", "Ready")).await, 200);

        let emitted = events.lock().unwrap();
        assert_eq!(emitted.len(), 2);

        assert_eq!(emitted[0].session_id, 1);
        assert_eq!(emitted[0].project_path, "/path/project-a");
        assert_eq!(emitted[0].status, "Working");

        assert_eq!(emitted[1].session_id, 2);
        assert_eq!(emitted[1].project_path, "/path/project-b");
        assert_eq!(emitted[1].status, "Idle");
    }

    #[tokio::test]
    async fn test_multi_session_same_project() {
        let (emit_fn, events) = test_emit_fn();
        let (addr, projects, _) = start_test_http_server("inst-1", emit_fn).await;

        // Two sessions sharing the same project (e.g. worktrees of same repo)
        projects.write().await.insert(1, "/path/shared-project".to_string());
        projects.write().await.insert(2, "/path/shared-project".to_string());

        assert_eq!(post_status(addr, &make_status(1, "inst-1", "working", "Task A")).await, 200);
        assert_eq!(post_status(addr, &make_status(2, "inst-1", "idle", "Waiting")).await, 200);

        let emitted = events.lock().unwrap();
        assert_eq!(emitted.len(), 2);

        // Both routed to the same project but tagged with different session IDs
        assert_eq!(emitted[0].session_id, 1);
        assert_eq!(emitted[0].project_path, "/path/shared-project");
        assert_eq!(emitted[0].status, "Working");

        assert_eq!(emitted[1].session_id, 2);
        assert_eq!(emitted[1].project_path, "/path/shared-project");
        assert_eq!(emitted[1].status, "Idle");
    }

    #[tokio::test]
    async fn test_wrong_instance_returns_403() {
        let (emit_fn, events) = test_emit_fn();
        let (addr, projects, _) = start_test_http_server("inst-current", emit_fn).await;

        projects.write().await.insert(1, "/path/project".to_string());

        // Send with stale instance ID
        let code = post_status(addr, &make_status(1, "inst-old", "working", "Stale")).await;
        assert_eq!(code, 403);

        // No event should have been emitted
        assert!(events.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_unregistered_session_returns_202_and_buffers() {
        let (emit_fn, events) = test_emit_fn();
        let (addr, _, pending) = start_test_http_server("inst-1", emit_fn).await;

        // Send status before registering session
        let code = post_status(addr, &make_status(5, "inst-1", "idle", "Early bird")).await;
        assert_eq!(code, 202);

        // No event emitted (not yet registered)
        assert!(events.lock().unwrap().is_empty());

        // Status should be buffered
        let buf = pending.read().await;
        assert!(buf.contains_key(&5));
        assert_eq!(buf[&5].state, "idle");
        assert_eq!(buf[&5].message, "Early bird");
    }

    #[tokio::test]
    async fn test_unregister_does_not_affect_other_sessions() {
        let (emit_fn, events) = test_emit_fn();
        let (addr, projects, _) = start_test_http_server("inst-1", emit_fn).await;

        projects.write().await.insert(1, "/path/a".to_string());
        projects.write().await.insert(2, "/path/b".to_string());

        // Unregister session 1
        projects.write().await.remove(&1);

        // Session 2 should still work
        assert_eq!(post_status(addr, &make_status(2, "inst-1", "working", "Still here")).await, 200);

        // Session 1 should be buffered (no longer registered)
        assert_eq!(post_status(addr, &make_status(1, "inst-1", "idle", "Gone")).await, 202);

        let emitted = events.lock().unwrap();
        assert_eq!(emitted.len(), 1);
        assert_eq!(emitted[0].session_id, 2);
    }

    // ── StatusServer method tests (buffering / flushing) ────────────

    #[tokio::test]
    async fn test_register_flushes_buffered_status() {
        let (emit_fn, events) = test_emit_fn();
        let server = test_server("inst-1", emit_fn);

        // Simulate a buffered status (arrived before registration)
        server.pending_statuses.write().await.insert(
            7,
            make_status(7, "inst-1", "idle", "Buffered hello"),
        );

        // Register the session — should flush
        server.register_session(7, "/path/project-x").await;

        let emitted = events.lock().unwrap();
        assert_eq!(emitted.len(), 1);
        assert_eq!(emitted[0].session_id, 7);
        assert_eq!(emitted[0].project_path, "/path/project-x");
        assert_eq!(emitted[0].status, "Idle");
        assert_eq!(emitted[0].message, "Buffered hello");

        // Buffer should be cleared
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

        // Buffer a status, then register, then unregister
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

        // Register 3 sessions across 2 projects
        server.register_session(1, "/project/alpha").await;
        server.register_session(2, "/project/beta").await;
        server.register_session(3, "/project/alpha").await;

        // Buffer a status for session 4 (not yet registered)
        server.pending_statuses.write().await.insert(
            4,
            make_status(4, "inst-1", "idle", "Waiting"),
        );

        // Unregister session 1 (project alpha)
        server.unregister_session(1).await;

        // Session 3 (also project alpha) should still be registered
        let registered = server.registered_sessions().await;
        assert!(registered.contains(&2));
        assert!(registered.contains(&3));
        assert!(!registered.contains(&1));

        // Register session 4 — should flush its buffer
        server.register_session(4, "/project/gamma").await;

        let emitted = events.lock().unwrap();
        assert_eq!(emitted.len(), 1);
        assert_eq!(emitted[0].session_id, 4);
        assert_eq!(emitted[0].project_path, "/project/gamma");
    }

    #[tokio::test]
    async fn test_all_state_mappings() {
        let (emit_fn, events) = test_emit_fn();
        let (addr, projects, _) = start_test_http_server("inst-1", emit_fn).await;

        projects.write().await.insert(1, "/path/p".to_string());

        for (mcp_state, expected_status) in [
            ("idle", "Idle"),
            ("working", "Working"),
            ("needs_input", "NeedsInput"),
            ("finished", "Done"),
            ("error", "Error"),
        ] {
            post_status(addr, &make_status(1, "inst-1", mcp_state, "msg")).await;
            let emitted = events.lock().unwrap();
            let last = emitted.last().unwrap();
            assert_eq!(last.status, expected_status, "state '{}' should map to '{}'", mcp_state, expected_status);
        }

        assert_eq!(events.lock().unwrap().len(), 5);
    }
}
