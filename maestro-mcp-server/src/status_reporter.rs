//! HTTP-based status reporting to Maestro.
//!
//! Reports agent status via HTTP POST to the Maestro application's
//! status endpoint. This replaces the previous file-based approach
//! to eliminate race conditions and provide real-time updates.

use serde::Serialize;
use thiserror::Error;

/// Maximum number of retry attempts for HTTP POST.
const MAX_RETRIES: u32 = 3;
/// Initial backoff delay between retries.
const INITIAL_BACKOFF_MS: u64 = 200;

#[derive(Debug, Error)]
pub enum StatusError {
    #[error("HTTP request failed: {0}")]
    HttpError(#[from] reqwest::Error),
    #[error("HTTP status {0}")]
    HttpStatus(u16),
}

/// Payload sent to Maestro's status endpoint.
#[derive(Debug, Serialize)]
pub struct StatusPayload {
    pub session_id: u32,
    pub instance_id: String,
    pub state: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub needs_input_prompt: Option<String>,
    pub timestamp: String,
}

/// Reports status to Maestro via HTTP POST.
pub struct StatusReporter {
    client: reqwest::Client,
    status_url: Option<String>,
    session_id: Option<u32>,
    instance_id: Option<String>,
}

impl StatusReporter {
    pub fn new(
        status_url: Option<String>,
        session_id: Option<u32>,
        instance_id: Option<String>,
    ) -> Self {
        Self {
            client: reqwest::Client::new(),
            status_url,
            session_id,
            instance_id,
        }
    }

    /// Report status to Maestro.
    ///
    /// Returns Ok(()) if the status was successfully reported, or if
    /// no status URL is configured (graceful degradation).
    /// Retries up to 3 times with exponential backoff on failure.
    pub async fn report_status(
        &self,
        state: &str,
        message: &str,
        needs_input_prompt: Option<String>,
    ) -> Result<(), StatusError> {
        let status_url = match &self.status_url {
            Some(url) => url,
            None => return Ok(()), // Graceful degradation if not configured
        };

        let session_id = self.session_id.unwrap_or(0);
        let instance_id = self
            .instance_id
            .clone()
            .unwrap_or_else(|| "unknown".to_string());

        let payload = StatusPayload {
            session_id,
            instance_id,
            state: state.to_string(),
            message: message.to_string(),
            needs_input_prompt,
            timestamp: chrono::Utc::now().to_rfc3339(),
        };

        // Send HTTP POST to Maestro's status endpoint
        eprintln!(
            "[maestro-mcp-server] Sending status to {}: session_id={}, state={}, message={}",
            status_url, payload.session_id, payload.state, payload.message
        );

        let mut last_error: Option<StatusError> = None;

        for attempt in 0..MAX_RETRIES {
            if attempt > 0 {
                let backoff = INITIAL_BACKOFF_MS * (1 << (attempt - 1));
                eprintln!(
                    "[maestro-mcp-server] Retry attempt {}/{} after {}ms",
                    attempt + 1,
                    MAX_RETRIES,
                    backoff
                );
                tokio::time::sleep(std::time::Duration::from_millis(backoff)).await;
            }

            match self
                .client
                .post(status_url)
                .json(&payload)
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await
            {
                Ok(response) => {
                    let status = response.status();
                    eprintln!(
                        "[maestro-mcp-server] Status response: {}",
                        status
                    );
                    if status.is_success() || status.as_u16() == 202 {
                        return Ok(());
                    }
                    // 4xx = client error (e.g. 403 wrong instance) — don't retry
                    if status.is_client_error() {
                        eprintln!(
                            "[maestro-mcp-server] Client error {} — not retrying",
                            status
                        );
                        return Ok(());
                    }
                    // 5xx = server error — retry
                    last_error = Some(StatusError::HttpStatus(status.as_u16()));
                }
                Err(e) => {
                    eprintln!(
                        "[maestro-mcp-server] HTTP error on attempt {}: {}",
                        attempt + 1,
                        e
                    );
                    last_error = Some(StatusError::HttpError(e));
                }
            }
        }

        // All retries exhausted — log error but don't crash
        if let Some(ref err) = last_error {
            eprintln!(
                "[maestro-mcp-server] Status report failed after {} attempts: {}",
                MAX_RETRIES, err
            );
        }

        // Graceful degradation: don't crash MCP server for status failures
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_no_url_returns_ok() {
        let reporter = StatusReporter::new(None, Some(1), Some("test".to_string()));
        let result = reporter.report_status("idle", "Ready", None).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_connection_refused_returns_ok_gracefully() {
        // Point at a port that's definitely not listening
        let reporter = StatusReporter::new(
            Some("http://127.0.0.1:19999/status".to_string()),
            Some(1),
            Some("test".to_string()),
        );
        let result = reporter.report_status("idle", "Ready", None).await;
        // Should return Ok due to graceful degradation (not crash)
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_no_retry_on_client_error() {
        use std::sync::atomic::{AtomicU32, Ordering};
        use std::sync::Arc;

        let attempt_count = Arc::new(AtomicU32::new(0));
        let count_clone = attempt_count.clone();

        // Server always returns 403 Forbidden (wrong instance_id)
        let app = axum::Router::new().route(
            "/status",
            axum::routing::post(move |_body: axum::body::Bytes| {
                let count = count_clone.clone();
                async move {
                    count.fetch_add(1, Ordering::SeqCst);
                    axum::http::StatusCode::FORBIDDEN
                }
            }),
        );

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let reporter = StatusReporter::new(
            Some(format!("http://{}/status", addr)),
            Some(1),
            Some("test".to_string()),
        );

        let result = reporter.report_status("idle", "Ready", None).await;
        assert!(result.is_ok());
        // Should only make 1 attempt — 403 is not retryable
        assert_eq!(attempt_count.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn test_retry_on_server_error() {
        use std::sync::atomic::{AtomicU32, Ordering};
        use std::sync::Arc;

        let attempt_count = Arc::new(AtomicU32::new(0));
        let count_clone = attempt_count.clone();

        // Start a local server that fails twice then succeeds
        let app = axum::Router::new().route(
            "/status",
            axum::routing::post(move |_body: axum::body::Bytes| {
                let count = count_clone.clone();
                async move {
                    let n = count.fetch_add(1, Ordering::SeqCst);
                    if n < 2 {
                        axum::http::StatusCode::INTERNAL_SERVER_ERROR
                    } else {
                        axum::http::StatusCode::OK
                    }
                }
            }),
        );

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let reporter = StatusReporter::new(
            Some(format!("http://{}/status", addr)),
            Some(1),
            Some("test".to_string()),
        );

        let result = reporter.report_status("working", "Testing", None).await;
        assert!(result.is_ok());
        // Should have made 3 attempts (2 failures + 1 success)
        assert_eq!(attempt_count.load(Ordering::SeqCst), 3);
    }
}
