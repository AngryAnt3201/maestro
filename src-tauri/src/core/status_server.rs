//! HTTP-based status server for receiving MCP status reports.
//!
//! Replaces the file-polling approach with an HTTP endpoint that receives
//! status updates from the Rust MCP server. Provides real-time updates
//! and eliminates race conditions.

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

/// Status payload received from MCP server.
#[derive(Debug, Deserialize)]
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
    app_handle: AppHandle,
    instance_id: String,
    /// Maps session_id -> project_path for routing status updates
    session_projects: Arc<RwLock<std::collections::HashMap<u32, String>>>,
}

/// HTTP status server that receives status updates from MCP servers.
pub struct StatusServer {
    port: u16,
    instance_id: String,
    session_projects: Arc<RwLock<std::collections::HashMap<u32, String>>>,
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
        let session_projects = Arc::new(RwLock::new(std::collections::HashMap::new()));

        let state = Arc::new(ServerState {
            app_handle,
            instance_id: instance_id.clone(),
            session_projects: session_projects.clone(),
        });

        let app = Router::new()
            .route("/status", post(handle_status))
            .with_state(state);

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
            session_projects,
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
    pub async fn register_session(&self, session_id: u32, project_path: &str) {
        let mut projects = self.session_projects.write().await;
        projects.insert(session_id, project_path.to_string());
        eprintln!(
            "[STATUS SERVER] Registered session {} for project '{}'",
            session_id,
            project_path
        );
    }

    /// Unregister a session when it's killed.
    pub async fn unregister_session(&self, session_id: u32) {
        let mut projects = self.session_projects.write().await;
        if projects.remove(&session_id).is_some() {
            log::debug!("Unregistered session {}", session_id);
        }
    }

    /// Get list of registered session IDs (for debugging).
    pub async fn registered_sessions(&self) -> Vec<u32> {
        let projects = self.session_projects.read().await;
        projects.keys().copied().collect()
    }
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
        return StatusCode::OK;
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
                "[STATUS] REJECTED - unknown session {}",
                payload.session_id
            );
            return StatusCode::OK;
        }
    };

    // Map MCP state to session status string
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
        payload.session_id,
        status,
        &project_path
    );

    let event_payload = SessionStatusPayload {
        session_id: payload.session_id,
        project_path,
        status: status.to_string(),
        message: payload.message,
        needs_input_prompt: payload.needs_input_prompt,
    };

    // Emit Tauri event immediately - no polling delay!
    if let Err(e) = state.app_handle.emit("session-status-changed", &event_payload) {
        eprintln!("[STATUS] EMIT FAILED: {}", e);
    } else {
        eprintln!("[STATUS] EMIT SUCCESS");
    }

    StatusCode::OK
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
