//
//  CommandConfig.swift
//  claude-maestro
//
//  Data models for command configuration
//

import Foundation

/// Configuration for a discovered command
struct CommandConfig: Codable, Identifiable, Hashable {
    let id: UUID
    var name: String
    var description: String
    var path: String                    // Absolute path to command .md file
    var source: CommandSource
    var isEnabled: Bool
    var discoveredAt: Date

    // Frontmatter fields from command .md file
    var argumentHint: String?
    var allowedTools: [String]?
    var model: String?

    /// Generate the slash command name (sanitized)
    var commandName: String {
        // Remove .md extension and sanitize
        let baseName = URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent
        return baseName.lowercased()
            .replacingOccurrences(of: " ", with: "-")
            .filter { $0.isLetter || $0.isNumber || $0 == "-" }
    }

    init(
        id: UUID = UUID(),
        name: String,
        description: String,
        path: String,
        source: CommandSource,
        isEnabled: Bool = true,
        discoveredAt: Date = Date(),
        argumentHint: String? = nil,
        allowedTools: [String]? = nil,
        model: String? = nil
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.path = path
        self.source = source
        self.isEnabled = isEnabled
        self.discoveredAt = discoveredAt
        self.argumentHint = argumentHint
        self.allowedTools = allowedTools
        self.model = model
    }
}

/// Source of a command
enum CommandSource: Codable, Hashable {
    case personal                                        // ~/.claude/commands/<name>.md
    case project(projectPath: String)                    // .claude/commands/<name>.md
    case plugin(pluginName: String)                      // From installed plugin
    case marketplace(marketplaceName: String, pluginName: String)   // From marketplace plugin

    var displayName: String {
        switch self {
        case .personal:
            return "Personal"
        case .project:
            return "Project"
        case .plugin(let name):
            return name
        case .marketplace(let marketplace, let plugin):
            return "\(marketplace)/\(plugin)"
        }
    }

    var icon: String {
        switch self {
        case .personal:
            return "person.circle"
        case .project:
            return "folder"
        case .plugin:
            return "puzzlepiece.extension"
        case .marketplace:
            return "storefront"
        }
    }

    /// Plugin name for bundling purposes (nil for personal/project commands)
    var pluginName: String? {
        switch self {
        case .personal, .project:
            return nil
        case .plugin(let name):
            return name
        case .marketplace(_, let plugin):
            return plugin
        }
    }
}

/// Per-session configuration for which commands are enabled
struct SessionCommandConfig: Codable {
    var enabledCommandIds: Set<UUID>

    init(enabledCommandIds: Set<UUID> = []) {
        self.enabledCommandIds = enabledCommandIds
    }

    func isCommandEnabled(_ commandId: UUID) -> Bool {
        enabledCommandIds.contains(commandId)
    }
}
