//! Writes session-specific `.mcp.json` configuration files for Claude CLI.
//!
//! This module handles generating and writing MCP configuration files to the
//! working directory before launching the Claude CLI. It merges Maestro's
//! session-specific server configuration with any existing user-defined servers.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::mcp_manager::{McpServerConfig, McpServerType};
use crate::commands::mcp::McpCustomServer;

/// Finds the MaestroMCPServer binary in common installation locations.
///
/// Searches in order:
/// 1. macOS Application Support (~Library/Application Support/Claude Maestro/)
/// 2. Linux local share (~/.local/share/maestro/)
/// 3. Next to the current executable
fn find_maestro_mcp_path() -> Option<PathBuf> {
    let candidates: Vec<Option<PathBuf>> = vec![
        // macOS Application Support
        directories::BaseDirs::new()
            .map(|d| d.data_dir().join("Claude Maestro/MaestroMCPServer")),
        // Linux local share
        directories::BaseDirs::new()
            .map(|d| d.data_local_dir().join("maestro/MaestroMCPServer")),
        // Next to the executable
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("MaestroMCPServer"))),
        // Inside Resources for macOS app bundle
        std::env::current_exe()
            .ok()
            .and_then(|p| {
                p.parent()
                    .and_then(|d| d.parent())
                    .map(|d| d.join("Resources/MaestroMCPServer"))
            }),
    ];

    candidates.into_iter().flatten().find(|p| p.exists())
}

/// Converts an McpServerConfig to the JSON format expected by `.mcp.json`.
fn server_config_to_json(config: &McpServerConfig) -> Value {
    match &config.server_type {
        McpServerType::Stdio { command, args, env } => {
            let mut obj = json!({
                "type": "stdio",
                "command": command,
                "args": args,
            });
            if !env.is_empty() {
                obj["env"] = json!(env);
            }
            obj
        }
        McpServerType::Http { url } => {
            json!({
                "type": "http",
                "url": url
            })
        }
    }
}

/// Converts a custom MCP server to the JSON format expected by `.mcp.json`.
fn custom_server_to_json(server: &McpCustomServer) -> Value {
    let mut obj = json!({
        "type": "stdio",
        "command": server.command,
        "args": server.args,
    });
    if !server.env.is_empty() {
        obj["env"] = json!(server.env);
    }
    // Note: working_directory is not part of the standard .mcp.json format,
    // but we could add it as a custom field if needed in the future
    obj
}

/// Merges new MCP servers with an existing `.mcp.json` file.
///
/// This function preserves user-defined servers while updating Maestro-managed
/// servers. Maestro-managed servers are identified by:
/// - The server name "maestro" (current format)
/// - Legacy: presence of `MAESTRO_SESSION_ID` in env vars (for backwards compatibility)
fn merge_with_existing(
    mcp_path: &Path,
    new_servers: HashMap<String, Value>,
) -> Result<Value, String> {
    let mut final_servers: HashMap<String, Value> = if mcp_path.exists() {
        // Read existing config
        let content = std::fs::read_to_string(mcp_path)
            .map_err(|e| format!("Failed to read existing .mcp.json: {}", e))?;

        let existing: Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse existing .mcp.json: {}", e))?;

        // Get existing servers, filter out Maestro-managed ones
        existing
            .get("mcpServers")
            .and_then(|s| s.as_object())
            .map(|obj| {
                obj.iter()
                    .filter(|(name, v)| {
                        // Keep if it's NOT a Maestro-managed server
                        // Check by name or by legacy MAESTRO_SESSION_ID env var
                        *name != "maestro"
                            && v.get("env")
                                .and_then(|e| e.get("MAESTRO_SESSION_ID"))
                                .is_none()
                    })
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect::<HashMap<_, _>>()
            })
            .unwrap_or_default()
    } else {
        HashMap::new()
    };

    // Merge in new servers (these take precedence)
    for (name, config) in new_servers {
        final_servers.insert(name, config);
    }

    Ok(json!({ "mcpServers": final_servers }))
}

/// Writes a session-specific `.mcp.json` to the working directory.
///
/// This function:
/// 1. Creates the Maestro MCP server entry with session-specific env vars
/// 2. Adds enabled discovered servers from the project's .mcp.json
/// 3. Adds enabled custom servers (user-defined, global)
/// 4. Merges with any existing `.mcp.json` (preserving user servers)
/// 5. Writes the final config to the working directory
///
/// # Arguments
///
/// * `working_dir` - Directory where `.mcp.json` will be written
/// * `session_id` - Session identifier for the Maestro MCP server
/// * `project_hash` - SHA256 hash of the project path for status file routing
/// * `enabled_servers` - List of discovered MCP server configs enabled for this session
/// * `custom_servers` - List of custom MCP servers that are enabled
pub async fn write_session_mcp_config(
    working_dir: &Path,
    session_id: u32,
    _project_hash: &str, // No longer written to .mcp.json; inherited from shell env
    enabled_servers: &[McpServerConfig],
    custom_servers: &[McpCustomServer],
) -> Result<(), String> {
    let mut mcp_servers: HashMap<String, Value> = HashMap::new();

    // Add Maestro MCP server
    // IMPORTANT: MAESTRO_SESSION_ID and MAESTRO_PROJECT_HASH are NOT included here!
    // They are inherited from the shell environment (set by ProcessManager::spawn_shell).
    // This avoids race conditions when multiple sessions share the same .mcp.json file.
    if let Some(mcp_path) = find_maestro_mcp_path() {
        log::info!(
            "Found MaestroMCPServer at {:?}, adding to session {} config",
            mcp_path,
            session_id
        );

        mcp_servers.insert(
            "maestro".to_string(),
            json!({
                "type": "stdio",
                "command": mcp_path.to_string_lossy(),
                "args": [],
                "env": {
                    "MAESTRO_PORT_RANGE_START": "3000",
                    "MAESTRO_PORT_RANGE_END": "3099"
                }
            }),
        );
    } else {
        log::warn!(
            "MaestroMCPServer binary not found, maestro_status tool will not be available"
        );
    }

    // Add enabled discovered servers from project .mcp.json
    for server in enabled_servers {
        mcp_servers.insert(server.name.clone(), server_config_to_json(server));
    }

    // Add enabled custom servers (user-defined, global)
    for server in custom_servers {
        mcp_servers.insert(server.name.clone(), custom_server_to_json(server));
    }

    // Merge with existing .mcp.json if present (preserve user servers)
    let mcp_path = working_dir.join(".mcp.json");
    let final_config = merge_with_existing(&mcp_path, mcp_servers)?;

    // Write the file
    let content = serde_json::to_string_pretty(&final_config)
        .map_err(|e| format!("Failed to serialize MCP config: {}", e))?;

    tokio::fs::write(&mcp_path, content)
        .await
        .map_err(|e| format!("Failed to write .mcp.json: {}", e))?;

    log::debug!(
        "Wrote session {} MCP config to {:?}",
        session_id,
        mcp_path
    );

    Ok(())
}

/// Removes a session-specific Maestro server from `.mcp.json`.
///
/// This should be called when a session is killed to clean up the config file.
/// The function is idempotent - it does nothing if the session entry doesn't exist.
///
/// # Arguments
///
/// * `working_dir` - Directory containing the `.mcp.json` file
/// * `session_id` - Session identifier to remove
pub async fn remove_session_mcp_config(
    working_dir: &Path,
    _session_id: u32,
) -> Result<(), String> {
    let mcp_path = working_dir.join(".mcp.json");
    if !mcp_path.exists() {
        return Ok(());
    }

    let content = tokio::fs::read_to_string(&mcp_path)
        .await
        .map_err(|e| format!("Failed to read .mcp.json: {}", e))?;

    let mut config: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse .mcp.json: {}", e))?;

    let server_key = "maestro";
    if let Some(servers) = config.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
        if servers.remove(server_key).is_some() {
            log::debug!(
                "Removed maestro MCP config from {:?}",
                mcp_path
            );
        }
    }

    let output = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    tokio::fs::write(&mcp_path, output)
        .await
        .map_err(|e| format!("Failed to write .mcp.json: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use tempfile::tempdir;

    #[test]
    fn test_server_config_to_json_stdio() {
        let config = McpServerConfig {
            name: "test".to_string(),
            server_type: McpServerType::Stdio {
                command: "/usr/bin/test".to_string(),
                args: vec!["--flag".to_string()],
                env: {
                    let mut env = HashMap::new();
                    env.insert("KEY".to_string(), "value".to_string());
                    env
                },
            },
        };

        let json = server_config_to_json(&config);
        assert_eq!(json["type"], "stdio");
        assert_eq!(json["command"], "/usr/bin/test");
        assert_eq!(json["args"][0], "--flag");
        assert_eq!(json["env"]["KEY"], "value");
    }

    #[test]
    fn test_server_config_to_json_http() {
        let config = McpServerConfig {
            name: "test".to_string(),
            server_type: McpServerType::Http {
                url: "http://localhost:3000".to_string(),
            },
        };

        let json = server_config_to_json(&config);
        assert_eq!(json["type"], "http");
        assert_eq!(json["url"], "http://localhost:3000");
    }

    #[tokio::test]
    async fn test_write_session_mcp_config_creates_file() {
        let dir = tempdir().unwrap();
        let result = write_session_mcp_config(
            dir.path(),
            1,
            "abc123",
            &[],
            &[],
        )
        .await;

        assert!(result.is_ok());
        assert!(dir.path().join(".mcp.json").exists());
    }

    #[test]
    fn test_merge_preserves_user_servers() {
        let dir = tempdir().unwrap();
        let mcp_path = dir.path().join(".mcp.json");

        // Write an existing config with a user server and old Maestro configs
        let existing = json!({
            "mcpServers": {
                "user-server": {
                    "type": "stdio",
                    "command": "/usr/bin/user-server",
                    "args": []
                },
                "maestro": {
                    "type": "stdio",
                    "command": "/usr/bin/old-maestro",
                    "args": []
                },
                "legacy-maestro": {
                    "type": "stdio",
                    "command": "/usr/bin/legacy",
                    "args": [],
                    "env": {
                        "MAESTRO_SESSION_ID": "old-session"
                    }
                }
            }
        });
        std::fs::write(&mcp_path, serde_json::to_string(&existing).unwrap()).unwrap();

        // Merge with new servers
        let mut new_servers = HashMap::new();
        new_servers.insert(
            "maestro".to_string(),
            json!({
                "type": "stdio",
                "command": "/usr/bin/new-maestro",
                "args": []
            }),
        );

        let result = merge_with_existing(&mcp_path, new_servers).unwrap();
        let servers = result["mcpServers"].as_object().unwrap();

        // User server should be preserved
        assert!(servers.contains_key("user-server"));
        // Old "maestro" server should be replaced by the new one
        assert!(servers.contains_key("maestro"));
        assert_eq!(servers["maestro"]["command"], "/usr/bin/new-maestro");
        // Legacy server with MAESTRO_SESSION_ID should be removed
        assert!(!servers.contains_key("legacy-maestro"));
    }
}
