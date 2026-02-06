//! MCP protocol implementation over stdio.
//!
//! Implements the Model Context Protocol (MCP) JSON-RPC over stdio,
//! providing the `maestro_status` tool for reporting agent state.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use thiserror::Error;

use crate::status_reporter::StatusReporter;

#[derive(Debug, Error)]
pub enum McpError {
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Status reporting error: {0}")]
    Status(#[from] crate::status_reporter::StatusError),
}

/// JSON-RPC request structure.
#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

/// JSON-RPC response structure.
#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
}

/// MCP server implementation.
pub struct McpServer {
    status_reporter: StatusReporter,
}

impl McpServer {
    pub fn new(
        status_url: Option<String>,
        session_id: Option<u32>,
        instance_id: Option<String>,
    ) -> Self {
        Self {
            status_reporter: StatusReporter::new(status_url, session_id, instance_id),
        }
    }

    /// Run the MCP server, reading from stdin and writing to stdout.
    pub async fn run(&self) -> Result<(), McpError> {
        let stdin = io::stdin();
        let mut stdout = io::stdout();

        for line in stdin.lock().lines() {
            let line = line?;
            if line.is_empty() {
                continue;
            }

            let request: JsonRpcRequest = match serde_json::from_str(&line) {
                Ok(req) => req,
                Err(e) => {
                    eprintln!("Failed to parse request: {}", e);
                    continue;
                }
            };

            let response = self.handle_request(&request).await;

            if let Some(resp) = response {
                let output = serde_json::to_string(&resp)?;
                writeln!(stdout, "{}", output)?;
                stdout.flush()?;
            }
        }

        Ok(())
    }

    /// Handle a single JSON-RPC request or notification.
    async fn handle_request(&self, request: &JsonRpcRequest) -> Option<JsonRpcResponse> {
        // Notifications have no id — handle them first, then return None (no response)
        if request.id.is_none() {
            self.handle_notification(request).await;
            return None;
        }

        // Safe: we just checked that id is Some
        let id = request.id.clone().unwrap();

        let (result, error) = match request.method.as_str() {
            "initialize" => (Some(self.handle_initialize()), None),
            "tools/list" => (Some(self.handle_tools_list()), None),
            "tools/call" => match self.handle_tools_call(&request.params).await {
                Ok(result) => (Some(result), None),
                Err(e) => (
                    None,
                    Some(JsonRpcError {
                        code: -32000,
                        message: e.to_string(),
                    }),
                ),
            },
            "ping" => (Some(json!({})), None),
            _ => (
                None,
                Some(JsonRpcError {
                    code: -32601,
                    message: format!("Method not found: {}", request.method),
                }),
            ),
        };

        Some(JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id,
            result,
            error,
        })
    }

    /// Handle a JSON-RPC notification (no id, no response).
    async fn handle_notification(&self, request: &JsonRpcRequest) {
        match request.method.as_str() {
            "notifications/initialized" => {
                // Auto-report "idle" status when Claude connects
                eprintln!("[maestro-mcp-server] Initialized - reporting idle status");
                let _ = self.status_reporter.report_status("idle", "Ready", None).await;
            }
            _ => {
                eprintln!("[maestro-mcp-server] Unknown notification: {}", request.method);
            }
        }
    }

    /// Handle the initialize request.
    fn handle_initialize(&self) -> Value {
        json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {}
            },
            "serverInfo": {
                "name": "maestro-mcp-server",
                "version": env!("CARGO_PKG_VERSION")
            }
        })
    }

    /// Handle the tools/list request.
    fn handle_tools_list(&self) -> Value {
        json!({
            "tools": [
                {
                    "name": "maestro_status",
                    "description": "Report your current status to the Maestro UI. Use this to keep the user informed about what you're doing.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "state": {
                                "type": "string",
                                "enum": ["idle", "working", "needs_input", "finished", "error"],
                                "description": "Your current state: idle (waiting), working (actively processing), needs_input (blocked on user input), finished (task complete), error (something went wrong)"
                            },
                            "message": {
                                "type": "string",
                                "description": "Brief description of what you're doing or need (max 100 chars recommended)"
                            },
                            "needsInputPrompt": {
                                "type": "string",
                                "description": "When state is 'needs_input', the specific question or prompt for the user"
                            }
                        },
                        "required": ["state", "message"]
                    }
                }
            ]
        })
    }

    /// Handle the tools/call request.
    async fn handle_tools_call(&self, params: &Value) -> Result<Value, McpError> {
        let name = params
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        match name {
            "maestro_status" => {
                let arguments = params.get("arguments").cloned().unwrap_or(json!({}));

                let state = arguments
                    .get("state")
                    .and_then(|v| v.as_str())
                    .unwrap_or("working");

                let message = arguments
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                let needs_input_prompt = arguments
                    .get("needsInputPrompt")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                // Report status via HTTP
                self.status_reporter
                    .report_status(state, message, needs_input_prompt)
                    .await?;

                Ok(json!({
                    "content": [
                        {
                            "type": "text",
                            "text": format!("Status reported: {} - {}", state, message)
                        }
                    ]
                }))
            }
            _ => Ok(json!({
                "content": [
                    {
                        "type": "text",
                        "text": format!("Unknown tool: {}", name)
                    }
                ],
                "isError": true
            })),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: create an McpServer with no status URL (won't make HTTP calls).
    fn test_server() -> McpServer {
        McpServer::new(None, Some(1), Some("test-instance".to_string()))
    }

    /// Helper: deserialize a JsonRpcRequest from JSON.
    fn make_request(json: Value) -> JsonRpcRequest {
        serde_json::from_value(json).expect("invalid test request JSON")
    }

    #[tokio::test]
    async fn test_notification_without_id_returns_none() {
        let server = test_server();
        let request = make_request(json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }));
        let response = server.handle_request(&request).await;
        assert!(response.is_none(), "notifications should not produce a response");
    }

    #[tokio::test]
    async fn test_initialize_returns_capabilities() {
        let server = test_server();
        let request = make_request(json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {}
        }));
        let response = server.handle_request(&request).await.expect("should return response");
        let result = response.result.expect("should have result");
        assert_eq!(result["protocolVersion"], "2024-11-05");
        assert!(result["capabilities"]["tools"].is_object());
        assert_eq!(result["serverInfo"]["name"], "maestro-mcp-server");
    }

    #[tokio::test]
    async fn test_tools_list_returns_maestro_status() {
        let server = test_server();
        let request = make_request(json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list"
        }));
        let response = server.handle_request(&request).await.expect("should return response");
        let result = response.result.expect("should have result");
        let tools = result["tools"].as_array().expect("tools should be array");
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], "maestro_status");
    }

    #[tokio::test]
    async fn test_unknown_method_returns_error() {
        let server = test_server();
        let request = make_request(json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "nonexistent/method"
        }));
        let response = server.handle_request(&request).await.expect("should return response");
        assert!(response.result.is_none());
        let error = response.error.expect("should have error");
        assert_eq!(error.code, -32601);
        assert!(error.message.contains("nonexistent/method"));
    }

    #[tokio::test]
    async fn test_ping_returns_empty_object() {
        let server = test_server();
        let request = make_request(json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "ping"
        }));
        let response = server.handle_request(&request).await.expect("should return response");
        let result = response.result.expect("should have result");
        assert_eq!(result, json!({}));
    }
}
