//! MCP (Model Context Protocol) server discovery and session state management.
//!
//! This module discovers MCP servers from multiple sources:
//! - Project `.mcp.json` files
//! - User/local scope servers from `~/.claude.json`
//!
//! It also tracks which servers are enabled per session.

use dashmap::DashMap;
use directories::BaseDirs;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// The source/origin of an MCP server.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum McpServerSource {
    /// From the project's .mcp.json file.
    Project,
    /// From ~/.claude.json top-level mcpServers (user scope).
    User,
    /// From ~/.claude.json projects[path].mcpServers (local scope).
    Local,
    /// Custom server defined in Maestro.
    Custom,
}

/// Configuration for an MCP server as read from `.mcp.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum McpServerType {
    /// Standard I/O based MCP server (command + args + env).
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: HashMap<String, String>,
    },
    /// HTTP-based MCP server.
    Http { url: String },
}

/// A named MCP server configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    /// Server name (the key from mcpServers object).
    pub name: String,
    /// Server type and connection details.
    #[serde(flatten)]
    pub server_type: McpServerType,
    /// Where this server was discovered from.
    #[serde(default = "default_project_source")]
    pub source: McpServerSource,
}

fn default_project_source() -> McpServerSource {
    McpServerSource::Project
}

/// Raw structure of `.mcp.json` file.
#[derive(Debug, Deserialize)]
struct McpJsonFile {
    #[serde(rename = "mcpServers", default)]
    mcp_servers: HashMap<String, McpServerEntry>,
}

/// A single entry in the mcpServers object.
#[derive(Debug, Deserialize)]
struct McpServerEntry {
    #[serde(rename = "type")]
    server_type: String,
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    args: Option<Vec<String>>,
    #[serde(default)]
    env: Option<HashMap<String, String>>,
    #[serde(default)]
    url: Option<String>,
}

/// Session-specific key for enabled servers lookup.
type SessionKey = (String, u32); // (project_path, session_id)

/// Manages MCP server discovery and per-session enabled state.
///
/// Thread-safe via `DashMap` — can be accessed from multiple async tasks.
pub struct McpManager {
    /// Cached MCP servers per project path (canonicalized).
    project_servers: DashMap<String, Vec<McpServerConfig>>,
    /// Enabled server names per (project_path, session_id).
    session_enabled: DashMap<SessionKey, Vec<String>>,
}

/// Parses MCP server entries from a HashMap into McpServerConfig structs.
fn parse_mcp_entries(
    entries: HashMap<String, McpServerEntry>,
    source: McpServerSource,
) -> Vec<McpServerConfig> {
    entries
        .into_iter()
        .filter_map(|(name, entry)| {
            let server_type = match entry.server_type.as_str() {
                "stdio" => {
                    let command = entry.command?;
                    McpServerType::Stdio {
                        command,
                        args: entry.args.unwrap_or_default(),
                        env: entry.env.unwrap_or_default(),
                    }
                }
                "http" => {
                    let url = entry.url?;
                    McpServerType::Http { url }
                }
                other => {
                    log::warn!("Unknown MCP server type '{}' for server '{}'", other, name);
                    return None;
                }
            };

            Some(McpServerConfig {
                name,
                server_type,
                source: source.clone(),
            })
        })
        .collect()
}

impl McpManager {
    /// Creates a new MCP manager with empty caches.
    pub fn new() -> Self {
        Self {
            project_servers: DashMap::new(),
            session_enabled: DashMap::new(),
        }
    }

    /// Parses the `.mcp.json` file at the given project path.
    ///
    /// Returns an empty vec if the file doesn't exist or can't be parsed.
    fn parse_project_mcp_config(project_path: &str) -> Vec<McpServerConfig> {
        let mcp_path = Path::new(project_path).join(".mcp.json");

        let content = match std::fs::read_to_string(&mcp_path) {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };

        let parsed: McpJsonFile = match serde_json::from_str(&content) {
            Ok(p) => p,
            Err(e) => {
                log::warn!("Failed to parse .mcp.json at {:?}: {}", mcp_path, e);
                return Vec::new();
            }
        };

        parse_mcp_entries(parsed.mcp_servers, McpServerSource::Project)
    }

    /// Parses MCP servers from ~/.claude.json for a given project.
    ///
    /// Discovers:
    /// - User-scope servers: top-level `mcpServers` object
    /// - Local-scope servers: `projects[project_path].mcpServers`
    fn parse_claude_json_servers(project_path: &str) -> Vec<McpServerConfig> {
        let Some(base_dirs) = BaseDirs::new() else {
            return Vec::new();
        };

        let claude_json_path = base_dirs.home_dir().join(".claude.json");
        let content = match std::fs::read_to_string(&claude_json_path) {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };

        let parsed: serde_json::Value = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(e) => {
                log::warn!("Failed to parse ~/.claude.json: {}", e);
                return Vec::new();
            }
        };

        let mut servers = Vec::new();

        // 1. User-scope servers: top-level "mcpServers" object
        if let Some(mcp_servers) = parsed.get("mcpServers").and_then(|v| v.as_object()) {
            for (name, config) in mcp_servers {
                if let Some(server) = parse_mcp_value_entry(name, config, McpServerSource::User) {
                    servers.push(server);
                }
            }
        }

        // 2. Local-scope servers: projects[project_path].mcpServers
        if let Some(projects) = parsed.get("projects").and_then(|v| v.as_object()) {
            if let Some(project) = projects.get(project_path).and_then(|v| v.as_object()) {
                if let Some(mcp_servers) = project.get("mcpServers").and_then(|v| v.as_object()) {
                    for (name, config) in mcp_servers {
                        if let Some(server) =
                            parse_mcp_value_entry(name, config, McpServerSource::Local)
                        {
                            servers.push(server);
                        }
                    }
                }
            }
        }

        servers
    }

    /// Discovers all MCP servers from all sources, deduplicated.
    ///
    /// Priority: local scope > project scope > user scope (earlier sources win).
    fn discover_all_servers(project_path: &str) -> Vec<McpServerConfig> {
        let mut all_servers = Vec::new();
        let mut seen_names = HashSet::new();

        // 1. Local scope from ~/.claude.json (highest priority)
        let claude_json_servers = Self::parse_claude_json_servers(project_path);
        for server in &claude_json_servers {
            if server.source == McpServerSource::Local && seen_names.insert(server.name.clone()) {
                all_servers.push(server.clone());
            }
        }

        // 2. Project scope from .mcp.json
        for server in Self::parse_project_mcp_config(project_path) {
            if seen_names.insert(server.name.clone()) {
                all_servers.push(server);
            }
        }

        // 3. User scope from ~/.claude.json (lowest priority)
        for server in claude_json_servers {
            if server.source == McpServerSource::User && seen_names.insert(server.name.clone()) {
                all_servers.push(server);
            }
        }

        all_servers
    }

    /// Gets the MCP servers for a project, discovering from all sources if not cached.
    ///
    /// The project_path should be canonicalized for consistent caching.
    pub fn get_project_servers(&self, project_path: &str) -> Vec<McpServerConfig> {
        // Return cached if available
        if let Some(servers) = self.project_servers.get(project_path) {
            return servers.clone();
        }

        // Discover from all sources and cache
        let servers = Self::discover_all_servers(project_path);
        self.project_servers
            .insert(project_path.to_string(), servers.clone());
        servers
    }

    /// Refreshes the cached servers for a project by re-discovering from all sources.
    pub fn refresh_project_servers(&self, project_path: &str) -> Vec<McpServerConfig> {
        let servers = Self::discover_all_servers(project_path);
        self.project_servers
            .insert(project_path.to_string(), servers.clone());
        servers
    }

    /// Gets the enabled server names for a session.
    ///
    /// If not explicitly set, returns all available servers as enabled by default.
    pub fn get_session_enabled(&self, project_path: &str, session_id: u32) -> Vec<String> {
        let key = (project_path.to_string(), session_id);

        if let Some(enabled) = self.session_enabled.get(&key) {
            return enabled.clone();
        }

        // Default: all servers enabled
        self.get_project_servers(project_path)
            .into_iter()
            .map(|s| s.name)
            .collect()
    }

    /// Sets the enabled server names for a session.
    pub fn set_session_enabled(&self, project_path: &str, session_id: u32, enabled: Vec<String>) {
        let key = (project_path.to_string(), session_id);
        self.session_enabled.insert(key, enabled);
    }

    /// Removes session-enabled state when a session is closed.
    pub fn remove_session(&self, project_path: &str, session_id: u32) {
        let key = (project_path.to_string(), session_id);
        self.session_enabled.remove(&key);
    }

    /// Counts enabled MCP servers for a session without cloning.
    pub fn get_enabled_count(&self, project_path: &str, session_id: u32) -> usize {
        let key = (project_path.to_string(), session_id);
        if let Some(enabled) = self.session_enabled.get(&key) {
            return enabled.len();
        }
        // Default: count of all project servers
        self.get_project_servers(project_path).len()
    }
}

/// Parses a single MCP server entry from a serde_json::Value.
fn parse_mcp_value_entry(
    name: &str,
    config: &serde_json::Value,
    source: McpServerSource,
) -> Option<McpServerConfig> {
    let server_type_str = config.get("type")?.as_str()?;

    let server_type = match server_type_str {
        "stdio" => {
            let command = config.get("command")?.as_str()?.to_string();
            let args = config
                .get("args")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            let env = config
                .get("env")
                .and_then(|v| v.as_object())
                .map(|obj| {
                    obj.iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect()
                })
                .unwrap_or_default();

            McpServerType::Stdio { command, args, env }
        }
        "http" => {
            let url = config.get("url")?.as_str()?.to_string();
            McpServerType::Http { url }
        }
        other => {
            log::warn!(
                "Unknown MCP server type '{}' for server '{}' in ~/.claude.json",
                other,
                name
            );
            return None;
        }
    };

    Some(McpServerConfig {
        name: name.to_string(),
        server_type,
        source,
    })
}

impl Default for McpManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_empty_project() {
        let manager = McpManager::new();
        let servers = manager.get_project_servers("/nonexistent/path");
        assert!(servers.is_empty());
    }

    #[test]
    fn test_parse_mcp_entries() {
        let mut entries = HashMap::new();
        entries.insert(
            "test-server".to_string(),
            McpServerEntry {
                server_type: "stdio".to_string(),
                command: Some("/usr/bin/test".to_string()),
                args: Some(vec!["--arg1".to_string()]),
                env: None,
                url: None,
            },
        );

        let servers = parse_mcp_entries(entries, McpServerSource::Project);
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "test-server");
        assert_eq!(servers[0].source, McpServerSource::Project);
    }
}
