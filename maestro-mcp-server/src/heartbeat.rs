//! Heartbeat sender for MCP server health monitoring.
//!
//! Periodically sends HTTP heartbeat pings to the Maestro status server
//! so it can detect when an MCP server process has died or become
//! unresponsive. If the status server stops receiving heartbeats for a
//! session, it emits a "Disconnected" status event.

use std::time::Duration;

/// Default interval between heartbeat pings.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);

/// HTTP request timeout for heartbeat pings.
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(5);

/// Payload sent with each heartbeat.
#[derive(serde::Serialize)]
struct HeartbeatPayload {
    session_id: u32,
    instance_id: String,
}

/// Spawn a background task that sends periodic heartbeats to the status server.
///
/// The task runs until the tokio runtime shuts down (i.e., when the MCP
/// server process exits). Heartbeat failures are logged but never fatal.
///
/// Returns `None` if required configuration is missing (graceful degradation).
pub fn spawn_heartbeat(
    status_url: Option<String>,
    session_id: Option<u32>,
    instance_id: Option<String>,
) -> Option<tokio::task::JoinHandle<()>> {
    let status_url = status_url?;
    let session_id = session_id?;
    let instance_id = instance_id?;

    // Derive heartbeat URL from status URL: /status -> /heartbeat
    let heartbeat_url = status_url
        .trim_end_matches("/status")
        .to_string()
        + "/heartbeat";

    let client = reqwest::Client::new();
    let payload = HeartbeatPayload {
        session_id,
        instance_id,
    };

    let handle = tokio::spawn(async move {
        log::info!("Heartbeat started: url={}, interval={}s", heartbeat_url, HEARTBEAT_INTERVAL.as_secs());

        // Small initial delay to let the server finish registration
        tokio::time::sleep(Duration::from_secs(2)).await;

        let mut interval = tokio::time::interval(HEARTBEAT_INTERVAL);
        // Don't try to catch up on missed ticks
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            interval.tick().await;

            match client
                .post(&heartbeat_url)
                .json(&payload)
                .timeout(HEARTBEAT_TIMEOUT)
                .send()
                .await
            {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        log::debug!("Heartbeat OK ({})", status);
                    } else if status.as_u16() == 403 {
                        // Wrong instance — Maestro restarted. Stop sending heartbeats.
                        log::warn!("Heartbeat rejected (403 wrong instance) — stopping heartbeat");
                        break;
                    } else {
                        log::warn!("Heartbeat response: {}", status);
                    }
                }
                Err(e) => {
                    log::warn!("Heartbeat failed: {}", e);
                }
            }
        }
    });

    Some(handle)
}
