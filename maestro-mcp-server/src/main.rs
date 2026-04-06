//! MCP Server for Claude Maestro status reporting.
//!
//! This server implements the Model Context Protocol (MCP) over stdio,
//! providing the `maestro_status` tool that reports agent status to
//! the Maestro application via HTTP POST.

mod file_logger;
mod heartbeat;
mod mcp_protocol;
mod status_reporter;

use mcp_protocol::McpServer;
use std::env;

#[tokio::main]
async fn main() {
    // Read configuration from environment variables
    let status_url = env::var("MAESTRO_STATUS_URL").ok();
    let session_id: Option<u32> = env::var("MAESTRO_SESSION_ID")
        .ok()
        .and_then(|s| s.parse().ok());
    let instance_id = env::var("MAESTRO_INSTANCE_ID").ok();
    let project_path = env::var("MAESTRO_PROJECT_PATH").ok();

    // Initialize file-based logging (writes to both stderr and log file)
    match file_logger::DualLogger::init(session_id) {
        Ok(log_path) => {
            log::info!(
                "Starting with config: status_url={:?}, session_id={:?}, instance_id={:?}, project_path={:?}",
                status_url, session_id, instance_id, project_path
            );
            log::info!("Log file: {}", log_path.display());
        }
        Err(e) => {
            // Fall back to eprintln if file logging fails
            eprintln!(
                "[maestro-mcp-server] Warning: file logging unavailable: {}",
                e
            );
            eprintln!(
                "[maestro-mcp-server] Starting with config: status_url={:?}, session_id={:?}, instance_id={:?}, project_path={:?}",
                status_url, session_id, instance_id, project_path
            );
        }
    }

    // Start heartbeat sender (runs in background until process exits)
    let _heartbeat_handle = heartbeat::spawn_heartbeat(
        status_url.clone(),
        session_id,
        instance_id.clone(),
    );

    // Create and run the MCP server
    let server = McpServer::new(status_url, session_id, instance_id, project_path);

    if let Err(e) = server.run().await {
        log::error!("MCP server error: {}", e);
        std::process::exit(1);
    }
}
