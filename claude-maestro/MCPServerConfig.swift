//
//  MCPServerConfig.swift
//  claude-maestro
//
//  Data models for custom MCP server configuration
//

import Foundation

/// Configuration for a custom MCP server
struct MCPServerConfig: Codable, Identifiable, Hashable {
    let id: UUID
    var name: String                        // Display name (e.g., "GitHub MCP")
    var command: String                     // Executable command (e.g., "npx", "node", "python")
    var args: [String]                      // Arguments array
    var env: [String: String]               // Environment variables
    var workingDirectory: String?           // Optional working directory
    var isEnabled: Bool                     // Global enable/disable
    var createdAt: Date

    init(
        id: UUID = UUID(),
        name: String,
        command: String,
        args: [String] = [],
        env: [String: String] = [:],
        workingDirectory: String? = nil,
        isEnabled: Bool = true,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.name = name
        self.command = command
        self.args = args
        self.env = env
        self.workingDirectory = workingDirectory
        self.isEnabled = isEnabled
        self.createdAt = createdAt
    }

    /// Generate the JSON structure for .mcp.json
    func toMCPJSON() -> [String: Any] {
        var config: [String: Any] = [
            "type": "stdio",
            "command": command,
            "args": args
        ]
        if !env.isEmpty {
            config["env"] = env
        }
        return config
    }

    /// Generate a sanitized key for use in .mcp.json
    var mcpKey: String {
        name.lowercased()
            .replacingOccurrences(of: " ", with: "-")
            .replacingOccurrences(of: "[^a-z0-9-]", with: "", options: .regularExpression)
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: MCPServerConfig, rhs: MCPServerConfig) -> Bool {
        lhs.id == rhs.id
    }
}

/// Per-session configuration for which MCP servers are enabled
struct SessionMCPConfig: Codable {
    var enabledServerIds: Set<UUID>  // Which custom servers are enabled for this session
    var maestroEnabled: Bool          // Whether Maestro MCP is enabled

    init(enabledServerIds: Set<UUID> = [], maestroEnabled: Bool = true) {
        self.enabledServerIds = enabledServerIds
        self.maestroEnabled = maestroEnabled
    }

    /// Check if a custom server is enabled for this session
    func isServerEnabled(_ serverId: UUID) -> Bool {
        enabledServerIds.contains(serverId)
    }
}
