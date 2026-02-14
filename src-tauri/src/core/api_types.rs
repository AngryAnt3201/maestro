//! Shared request/response types for the Maestro REST API.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// POST /api/v1/sessions — create a new Claude Code session.
#[derive(Debug, Deserialize)]
pub struct CreateSessionRequest {
    pub project_path: String,
    pub branch: Option<String>,
    #[serde(default = "default_mode")]
    pub mode: String,
    pub initial_prompt: Option<String>,
    #[serde(default)]
    pub auto_push: bool,
    #[serde(default)]
    pub context: HashMap<String, serde_json::Value>,
    pub env: Option<HashMap<String, String>>,
}

fn default_mode() -> String {
    "claude".to_string()
}

/// Response from session creation.
#[derive(Debug, Serialize)]
pub struct CreateSessionResponse {
    pub session_id: u32,
    pub status: String,
    pub worktree_path: Option<String>,
    pub working_directory: String,
}

/// GET /api/v1/sessions/:id — session detail.
#[derive(Debug, Serialize)]
pub struct SessionDetail {
    pub id: u32,
    pub status: String,
    pub mode: String,
    pub branch: Option<String>,
    pub worktree_path: Option<String>,
    pub project_path: String,
}

/// POST /api/v1/sessions/:id/input — write to session stdin.
#[derive(Debug, Deserialize)]
pub struct SessionInputRequest {
    pub text: String,
}

/// POST /api/v1/apps — create a new app.
#[derive(Debug, Deserialize)]
pub struct CreateAppRequest {
    pub name: String,
    pub description: Option<String>,
    pub template: Option<String>,
}

/// Response from app creation.
#[derive(Debug, Serialize)]
pub struct CreateAppResponse {
    pub app_id: String,
    pub path: String,
}

/// POST /api/v1/apps/:id/generate — start generation session.
#[derive(Debug, Deserialize)]
pub struct GenerateAppRequest {
    pub prompt: String,
    #[serde(default)]
    pub auto_push: bool,
}

/// POST /api/v1/apps/:id/run — start run session.
#[derive(Debug, Deserialize)]
pub struct RunAppRequest {
    pub command: Option<String>,
}

/// GET /api/v1/health — health check response.
#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub instance_id: String,
    pub port: u16,
    pub version: String,
}

/// Generic error response for the API.
#[derive(Debug, Serialize)]
pub struct ApiError {
    pub error: String,
}
