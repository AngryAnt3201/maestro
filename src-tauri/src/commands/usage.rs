//! IPC commands for Claude Code usage tracking.
//!
//! Fetches real rate limit data from Anthropic's OAuth API.
//! Reads OAuth tokens from platform credential store (primary) or credentials file (fallback).

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};

/// Flag to skip credential store after first failure (prevents repeated prompts).
static CREDENTIAL_STORE_FAILED: AtomicBool = AtomicBool::new(false);

/// Usage data from Anthropic's OAuth API.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageData {
    /// Session (5-hour window) usage percentage (0-100).
    pub session_percent: f64,
    /// When the session window resets (ISO 8601).
    pub session_resets_at: Option<String>,
    /// Weekly (7-day window) usage percentage for all models (0-100).
    pub weekly_percent: f64,
    /// When the weekly window resets (ISO 8601).
    pub weekly_resets_at: Option<String>,
    /// Weekly Opus-specific usage percentage (0-100).
    pub weekly_opus_percent: f64,
    /// When the weekly Opus window resets (ISO 8601).
    pub weekly_opus_resets_at: Option<String>,
    /// Error message if token is expired or unavailable.
    pub error_message: Option<String>,
    /// Whether authentication is needed (token expired or missing).
    pub needs_auth: bool,
}

impl Default for UsageData {
    fn default() -> Self {
        Self {
            session_percent: 0.0,
            session_resets_at: None,
            weekly_percent: 0.0,
            weekly_resets_at: None,
            weekly_opus_percent: 0.0,
            weekly_opus_resets_at: None,
            error_message: None,
            needs_auth: false,
        }
    }
}

/// Response from Anthropic's /api/oauth/usage endpoint.
#[derive(Debug, Deserialize)]
struct ApiUsageResponse {
    five_hour: Option<UsageWindow>,
    seven_day: Option<UsageWindow>,
    seven_day_opus: Option<UsageWindow>,
}

#[derive(Debug, Deserialize)]
struct UsageWindow {
    utilization: f64,
    resets_at: Option<String>,
}

/// Credentials structure (same format in file and keychain).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CredentialsData {
    claude_ai_oauth: Option<OAuthCredentials>,
}

/// OAuth credentials structure.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OAuthCredentials {
    access_token: String,
    expires_at: u64,
}

/// Check if token is expired (with 60 second buffer).
fn is_token_expired(expires_at: u64) -> bool {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    expires_at < now_ms + 60_000
}

/// Get the current username for credential store access.
fn get_username() -> Option<String> {
    // USER (Unix) or USERNAME (Windows)
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .ok()
}

/// Read credentials from macOS Keychain using the `security` CLI.
/// This avoids permission prompts since `security` is Apple-signed.
#[cfg(target_os = "macos")]
async fn read_keychain_credentials() -> Result<CredentialsData, String> {
    let username = get_username().ok_or("Could not get username")?;

    let output = tokio::process::Command::new("security")
        .args([
            "find-generic-password",
            "-s", "Claude Code-credentials",
            "-a", &username,
            "-w",
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run security: {}", e))?;

    if !output.status.success() {
        return Err("No keychain entry found".to_string());
    }

    let data = String::from_utf8(output.stdout)
        .map_err(|_| "Invalid keychain data")?;

    serde_json::from_str(data.trim())
        .map_err(|e| format!("Failed to parse keychain data: {}", e))
}

/// Read credentials from platform credential store (Windows/Linux).
/// - Windows: Credential Manager
/// - Linux: Secret Service (D-Bus)
#[cfg(not(target_os = "macos"))]
async fn read_keychain_credentials() -> Result<CredentialsData, String> {
    let username = get_username().ok_or("Could not get username")?;

    let result = tokio::task::spawn_blocking(move || {
        let entry = keyring::Entry::new("Claude Code-credentials", &username)
            .map_err(|e| format!("Failed to create keyring entry: {}", e))?;

        entry.get_password().map_err(|e| match e {
            keyring::Error::NoEntry => "No credential entry found".to_string(),
            _ => format!("Credential store error: {}", e),
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    serde_json::from_str(&result)
        .map_err(|e| format!("Failed to parse credential data: {}", e))
}

/// Read credentials from file (fallback for non-macOS or if keychain fails).
async fn read_file_credentials() -> Result<CredentialsData, String> {
    let home = directories::UserDirs::new()
        .and_then(|dirs| Some(dirs.home_dir().to_path_buf()))
        .ok_or("Could not get home directory")?;

    let creds_path = home.join(".claude").join(".credentials.json");

    if !creds_path.exists() {
        return Err("Credentials file not found".to_string());
    }

    let content = tokio::fs::read_to_string(&creds_path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse file: {}", e))
}

/// Get a valid access token, trying platform credential store first then file.
async fn get_access_token() -> Result<String, String> {
    // Try platform credential store first (skip if previously failed to avoid repeated prompts)
    if !CREDENTIAL_STORE_FAILED.load(Ordering::Relaxed) {
        match read_keychain_credentials().await {
            Ok(creds) => {
                if let Some(oauth) = creds.claude_ai_oauth {
                    if !is_token_expired(oauth.expires_at) {
                        log::debug!("Using token from platform credential store");
                        return Ok(oauth.access_token);
                    }
                    log::debug!("Credential store token expired");
                }
            }
            Err(e) => {
                log::debug!("Credential store failed, will use file fallback: {}", e);
                CREDENTIAL_STORE_FAILED.store(true, Ordering::Relaxed);
            }
        }
    }

    // Fall back to credentials file
    let creds = read_file_credentials().await?;
    let oauth = creds.claude_ai_oauth.ok_or("Not logged in")?;

    if is_token_expired(oauth.expires_at) {
        return Err("Session expired".to_string());
    }

    log::debug!("Using token from file");
    Ok(oauth.access_token)
}

/// Fetch usage data from Anthropic's OAuth API.
#[tauri::command]
pub async fn get_claude_usage() -> Result<UsageData, String> {
    let token = match get_access_token().await {
        Ok(t) => t,
        Err(e) => {
            log::debug!("No valid token: {}", e);
            return Ok(UsageData {
                error_message: Some(e),
                needs_auth: true,
                ..Default::default()
            });
        }
    };

    let client = reqwest::Client::new();
    let response = client
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("Authorization", format!("Bearer {}", token))
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("User-Agent", "claude-code/2.0.32")
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    // Handle auth errors
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        log::debug!("Usage API returned 401");
        return Ok(UsageData {
            error_message: Some("Session expired".to_string()),
            needs_auth: true,
            ..Default::default()
        });
    }

    if !response.status().is_success() {
        let status = response.status();
        log::warn!("Usage API returned {}", status);
        return Ok(UsageData {
            error_message: Some(format!("API error: {}", status)),
            ..Default::default()
        });
    }

    let api_response: ApiUsageResponse = response
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    // Helper to convert utilization to percentage
    // API returns 0-1 (multiply by 100) or already 0-100 (use as-is)
    let to_percent = |val: f64| {
        if val > 1.0 { val } else { val * 100.0 }
    };

    let usage = UsageData {
        session_percent: api_response
            .five_hour
            .as_ref()
            .map(|w| to_percent(w.utilization))
            .unwrap_or(0.0),
        session_resets_at: api_response.five_hour.and_then(|w| w.resets_at),
        weekly_percent: api_response
            .seven_day
            .as_ref()
            .map(|w| to_percent(w.utilization))
            .unwrap_or(0.0),
        weekly_resets_at: api_response.seven_day.and_then(|w| w.resets_at),
        weekly_opus_percent: api_response
            .seven_day_opus
            .as_ref()
            .map(|w| to_percent(w.utilization))
            .unwrap_or(0.0),
        weekly_opus_resets_at: api_response.seven_day_opus.and_then(|w| w.resets_at),
        error_message: None,
        needs_auth: false,
    };

    log::info!(
        "Usage: session={:.1}%, weekly={:.1}%",
        usage.session_percent,
        usage.weekly_percent
    );

    Ok(usage)
}
