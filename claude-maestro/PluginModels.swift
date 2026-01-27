//
//  PluginModels.swift
//  claude-maestro
//
//  Data models for marketplace plugins
//

import Foundation
import SwiftUI

// MARK: - Plugin Category

enum PluginCategory: String, Codable, CaseIterable, Identifiable {
    case codeIntelligence = "Code Intelligence"
    case externalIntegrations = "External Integrations"
    case developmentWorkflows = "Development Workflows"
    case outputStyles = "Output Styles"
    case other = "Other"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .codeIntelligence: return "brain"
        case .externalIntegrations: return "link"
        case .developmentWorkflows: return "hammer"
        case .outputStyles: return "textformat"
        case .other: return "ellipsis.circle"
        }
    }

    var color: Color {
        switch self {
        case .codeIntelligence: return .purple
        case .externalIntegrations: return .green
        case .developmentWorkflows: return .blue
        case .outputStyles: return .orange
        case .other: return .gray
        }
    }
}

// MARK: - Plugin Type

enum PluginType: String, Codable, CaseIterable, Identifiable {
    case skill
    case command
    case mcp
    case agent
    case hook

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .skill: return "Skill"
        case .command: return "Command"
        case .mcp: return "MCP Server"
        case .agent: return "Agent"
        case .hook: return "Hook"
        }
    }

    var icon: String {
        switch self {
        case .skill: return "sparkles"
        case .command: return "terminal"
        case .mcp: return "server.rack"
        case .agent: return "person.circle"
        case .hook: return "arrow.uturn.right"
        }
    }

    var color: Color {
        switch self {
        case .skill: return .orange
        case .command: return .blue
        case .mcp: return .purple
        case .agent: return .cyan
        case .hook: return .green
        }
    }
}

// MARK: - Plugin Source

enum PluginSource: Codable, Hashable {
    case official                       // From official Anthropic marketplace
    case marketplace(name: String)      // From third-party marketplace
    case local                          // Manually installed

    var displayName: String {
        switch self {
        case .official:
            return "Official"
        case .marketplace(let name):
            return name
        case .local:
            return "Local"
        }
    }
}

// MARK: - Install Scope

enum InstallScope: String, Codable, CaseIterable, Identifiable {
    case user = "User"
    case project = "Project"
    case local = "Local"

    var id: String { rawValue }

    var description: String {
        switch self {
        case .user:
            return "Available in all your projects"
        case .project:
            return "Shared with all collaborators"
        case .local:
            return "Only for you, only this project"
        }
    }

    var icon: String {
        switch self {
        case .user: return "person.circle"
        case .project: return "folder"
        case .local: return "doc"
        }
    }
}

// MARK: - Marketplace Source

/// A registered marketplace source
struct MarketplaceSource: Codable, Identifiable, Hashable {
    let id: UUID
    var name: String                    // Display name (e.g., "claude-plugins-official")
    var repositoryURL: String           // GitHub URL or registry URL
    var isOfficial: Bool                // True for official Anthropic marketplace
    var isEnabled: Bool
    var lastFetched: Date?
    var lastError: String?

    init(
        id: UUID = UUID(),
        name: String,
        repositoryURL: String,
        isOfficial: Bool = false,
        isEnabled: Bool = true,
        lastFetched: Date? = nil,
        lastError: String? = nil
    ) {
        self.id = id
        self.name = name
        self.repositoryURL = repositoryURL
        self.isOfficial = isOfficial
        self.isEnabled = isEnabled
        self.lastFetched = lastFetched
        self.lastError = lastError
    }

    /// Parse owner/repo from GitHub URL
    var githubOwnerRepo: (owner: String, repo: String)? {
        // Handle formats: owner/repo, https://github.com/owner/repo, git@github.com:owner/repo
        var url = repositoryURL

        // Remove .git suffix
        if url.hasSuffix(".git") {
            url = String(url.dropLast(4))
        }

        // Handle SSH format
        if url.hasPrefix("git@github.com:") {
            url = String(url.dropFirst("git@github.com:".count))
        }

        // Handle HTTPS format
        if url.hasPrefix("https://github.com/") {
            url = String(url.dropFirst("https://github.com/".count))
        }

        let parts = url.split(separator: "/")
        if parts.count >= 2 {
            return (String(parts[0]), String(parts[1]))
        }

        return nil
    }
}

// MARK: - Marketplace Plugin

/// A plugin available in a marketplace (not yet installed)
struct MarketplacePlugin: Codable, Identifiable, Hashable {
    let id: String                      // Unique identifier in marketplace
    var name: String
    var description: String
    var version: String
    var author: String
    var category: PluginCategory
    var types: [PluginType]             // What it contains: skills, mcp, hooks
    var downloadURL: String?
    var homepage: String?
    var tags: [String]
    var marketplace: String             // Which marketplace this is from

    init(
        id: String,
        name: String,
        description: String,
        version: String,
        author: String,
        category: PluginCategory = .other,
        types: [PluginType] = [],
        downloadURL: String? = nil,
        homepage: String? = nil,
        tags: [String] = [],
        marketplace: String
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.version = version
        self.author = author
        self.category = category
        self.types = types
        self.downloadURL = downloadURL
        self.homepage = homepage
        self.tags = tags
        self.marketplace = marketplace
    }

    /// Primary type for display (defaults to first type, or skill if none specified)
    var primaryType: PluginType {
        types.first ?? .skill  // Safe default for display - actual detection happens at install time
    }
}

// MARK: - Installed Plugin

/// A plugin installed on the local system
struct InstalledPlugin: Codable, Identifiable, Hashable {
    let id: UUID
    var name: String
    var description: String
    var version: String
    var source: PluginSource
    var installScope: InstallScope
    var installedAt: Date
    var path: String                    // Installation path
    var skills: [String]                // Skill names from this plugin
    var commands: [String]              // Command names from this plugin
    var mcpServers: [String]            // MCP server names from this plugin
    var isEnabled: Bool
    var skillSymlinks: [String]         // Symlink paths created in ~/.claude/skills/
    var commandSymlinks: [String]       // Symlink paths created in ~/.claude/commands/

    init(
        id: UUID = UUID(),
        name: String,
        description: String,
        version: String,
        source: PluginSource,
        installScope: InstallScope,
        installedAt: Date = Date(),
        path: String,
        skills: [String] = [],
        commands: [String] = [],
        mcpServers: [String] = [],
        isEnabled: Bool = true,
        skillSymlinks: [String] = [],
        commandSymlinks: [String] = []
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.version = version
        self.source = source
        self.installScope = installScope
        self.installedAt = installedAt
        self.path = path
        self.skills = skills
        self.commands = commands
        self.mcpServers = mcpServers
        self.isEnabled = isEnabled
        self.skillSymlinks = skillSymlinks
        self.commandSymlinks = commandSymlinks
    }

    // Custom decoder for backward compatibility with existing data
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decode(UUID.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        description = try container.decode(String.self, forKey: .description)
        version = try container.decode(String.self, forKey: .version)
        source = try container.decode(PluginSource.self, forKey: .source)
        installScope = try container.decode(InstallScope.self, forKey: .installScope)
        installedAt = try container.decode(Date.self, forKey: .installedAt)
        path = try container.decode(String.self, forKey: .path)
        skills = try container.decodeIfPresent([String].self, forKey: .skills) ?? []
        commands = try container.decodeIfPresent([String].self, forKey: .commands) ?? []
        mcpServers = try container.decodeIfPresent([String].self, forKey: .mcpServers) ?? []
        isEnabled = try container.decodeIfPresent(Bool.self, forKey: .isEnabled) ?? true
        skillSymlinks = try container.decodeIfPresent([String].self, forKey: .skillSymlinks) ?? []
        commandSymlinks = try container.decodeIfPresent([String].self, forKey: .commandSymlinks) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, description, version, source, installScope, installedAt, path
        case skills, commands, mcpServers, isEnabled, skillSymlinks, commandSymlinks
    }
}

// MARK: - Per-Session Plugin Config

/// Per-session configuration for which plugins are enabled
struct SessionPluginConfig: Codable {
    var enabledPluginIds: Set<UUID>

    init(enabledPluginIds: Set<UUID> = []) {
        self.enabledPluginIds = enabledPluginIds
    }

    func isPluginEnabled(_ pluginId: UUID) -> Bool {
        enabledPluginIds.contains(pluginId)
    }
}

// MARK: - Marketplace Manifest

/// Structure of the marketplace.json file
struct MarketplaceManifest: Codable {
    var name: String
    var description: String?
    var plugins: [MarketplacePluginManifest]?
}

/// Author can be a simple string or an object with name/email
/// Handles both formats: "John Doe" or {"name": "John", "email": "john@example.com"}
enum PluginAuthor: Codable {
    case string(String)
    case object(name: String, email: String?)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        // Try decoding as string first
        if let stringValue = try? container.decode(String.self) {
            self = .string(stringValue)
            return
        }

        // Try decoding as object
        struct AuthorObject: Codable {
            let name: String
            let email: String?
        }

        if let objectValue = try? container.decode(AuthorObject.self) {
            self = .object(name: objectValue.name, email: objectValue.email)
            return
        }

        throw DecodingError.typeMismatch(
            PluginAuthor.self,
            DecodingError.Context(
                codingPath: decoder.codingPath,
                debugDescription: "Author must be a string or object with 'name' field"
            )
        )
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .object(let name, let email):
            struct AuthorObject: Codable {
                let name: String
                let email: String?
            }
            try container.encode(AuthorObject(name: name, email: email))
        }
    }

    /// Get the display name regardless of format
    var displayName: String {
        switch self {
        case .string(let value):
            return value
        case .object(let name, _):
            return name
        }
    }
}

/// Source can be a string path or an object with url
private struct SourceObject: Codable {
    let source: String?
    let url: String
}

/// Plugin entry in marketplace.json
struct MarketplacePluginManifest: Codable {
    var id: String                      // Derived from name if not present in JSON
    var name: String
    var description: String
    var version: String
    var author: PluginAuthor?           // Flexible: string or object
    var category: String?
    var types: [String]?
    var path: String?                   // Relative path in repo (supports both "path" and "source")
    var homepage: String?
    var tags: [String]?

    // CodingKeys to handle field mapping
    private enum CodingKeys: String, CodingKey {
        case id
        case name
        case description
        case version
        case author
        case category
        case types
        case path
        case source      // Alternative name for path
        case homepage
        case tags
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // Required fields
        name = try container.decode(String.self, forKey: .name)
        description = try container.decode(String.self, forKey: .description)

        // version: Optional with default
        version = try container.decodeIfPresent(String.self, forKey: .version) ?? "1.0.0"

        // id: Use explicit id if present, otherwise derive from name
        if let explicitId = try container.decodeIfPresent(String.self, forKey: .id) {
            id = explicitId
        } else {
            // Generate id from name: lowercase, replace spaces/slashes with hyphens
            id = name.lowercased()
                .replacingOccurrences(of: " ", with: "-")
                .replacingOccurrences(of: "/", with: "-")
        }

        // author: Flexible decoding (string or object)
        author = try container.decodeIfPresent(PluginAuthor.self, forKey: .author)

        // path: Try "path" first, then "source" as fallback (source can be string or object)
        if let pathValue = try container.decodeIfPresent(String.self, forKey: .path) {
            path = pathValue
        } else if let sourceString = try? container.decodeIfPresent(String.self, forKey: .source) {
            path = sourceString
        } else if let sourceObject = try? container.decodeIfPresent(SourceObject.self, forKey: .source) {
            path = sourceObject.url
        } else {
            path = nil
        }

        // Optional fields
        category = try container.decodeIfPresent(String.self, forKey: .category)
        types = try container.decodeIfPresent([String].self, forKey: .types)
        homepage = try container.decodeIfPresent(String.self, forKey: .homepage)
        tags = try container.decodeIfPresent([String].self, forKey: .tags)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(name, forKey: .name)
        try container.encode(description, forKey: .description)
        try container.encode(version, forKey: .version)
        try container.encodeIfPresent(author, forKey: .author)
        try container.encodeIfPresent(category, forKey: .category)
        try container.encodeIfPresent(types, forKey: .types)
        try container.encodeIfPresent(path, forKey: .path)
        try container.encodeIfPresent(homepage, forKey: .homepage)
        try container.encodeIfPresent(tags, forKey: .tags)
    }

    // Standard memberwise init for programmatic creation
    init(
        id: String,
        name: String,
        description: String,
        version: String,
        author: PluginAuthor? = nil,
        category: String? = nil,
        types: [String]? = nil,
        path: String? = nil,
        homepage: String? = nil,
        tags: [String]? = nil
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.version = version
        self.author = author
        self.category = category
        self.types = types
        self.path = path
        self.homepage = homepage
        self.tags = tags
    }

    /// Convert to MarketplacePlugin
    func toMarketplacePlugin(marketplace: String, baseURL: String?) -> MarketplacePlugin {
        let pluginTypes: [PluginType] = (types ?? []).compactMap { typeStr in
            PluginType(rawValue: typeStr.lowercased())
        }

        let pluginCategory: PluginCategory = {
            guard let cat = category else { return .other }
            switch cat.lowercased() {
            case "code intelligence", "codeintelligence", "development":
                return .codeIntelligence
            case "external integrations", "externalintegrations":
                return .externalIntegrations
            case "development workflows", "developmentworkflows":
                return .developmentWorkflows
            case "output styles", "outputstyles":
                return .outputStyles
            default:
                return .other
            }
        }()

        var downloadURL: String? = nil
        if let path = path {
            // Check if path is already an absolute URL (external repository)
            if path.hasPrefix("https://") || path.hasPrefix("git@") {
                // External URL source - use path directly as the download URL
                downloadURL = path
            } else if let base = baseURL {
                // Relative path - combine with base URL
                downloadURL = "\(base)/\(path)"
            }
        }

        return MarketplacePlugin(
            id: id,
            name: name,
            description: description,
            version: version,
            author: author?.displayName ?? "Unknown",
            category: pluginCategory,
            types: pluginTypes,  // Don't default to [.skill] - let installation detect actual content
            downloadURL: downloadURL,
            homepage: homepage,
            tags: tags ?? [],
            marketplace: marketplace
        )
    }
}
