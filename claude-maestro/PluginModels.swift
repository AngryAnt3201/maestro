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
    case mcp
    case agent
    case hook

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .skill: return "Skill"
        case .mcp: return "MCP Server"
        case .agent: return "Agent"
        case .hook: return "Hook"
        }
    }

    var icon: String {
        switch self {
        case .skill: return "sparkles"
        case .mcp: return "server.rack"
        case .agent: return "person.circle"
        case .hook: return "arrow.uturn.right"
        }
    }

    var color: Color {
        switch self {
        case .skill: return .orange
        case .mcp: return .purple
        case .agent: return .blue
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

    /// Primary type for display
    var primaryType: PluginType {
        types.first ?? .skill
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
    var mcpServers: [String]            // MCP server names from this plugin
    var isEnabled: Bool

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
        mcpServers: [String] = [],
        isEnabled: Bool = true
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
        self.mcpServers = mcpServers
        self.isEnabled = isEnabled
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
    var plugins: [MarketplacePluginManifest]
}

/// Plugin entry in marketplace.json
struct MarketplacePluginManifest: Codable {
    var id: String
    var name: String
    var description: String
    var version: String
    var author: String?
    var category: String?
    var types: [String]?
    var path: String?                   // Relative path in repo
    var homepage: String?
    var tags: [String]?

    /// Convert to MarketplacePlugin
    func toMarketplacePlugin(marketplace: String, baseURL: String?) -> MarketplacePlugin {
        let pluginTypes: [PluginType] = (types ?? []).compactMap { typeStr in
            PluginType(rawValue: typeStr.lowercased())
        }

        let pluginCategory: PluginCategory = {
            guard let cat = category else { return .other }
            switch cat.lowercased() {
            case "code intelligence", "codeintelligence":
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
        if let path = path, let base = baseURL {
            downloadURL = "\(base)/\(path)"
        }

        return MarketplacePlugin(
            id: id,
            name: name,
            description: description,
            version: version,
            author: author ?? "Unknown",
            category: pluginCategory,
            types: pluginTypes.isEmpty ? [.skill] : pluginTypes,
            downloadURL: downloadURL,
            homepage: homepage,
            tags: tags ?? [],
            marketplace: marketplace
        )
    }
}
