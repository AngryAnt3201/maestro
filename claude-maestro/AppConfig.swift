//
//  AppConfig.swift
//  claude-maestro
//
//  Data model for app configurations - bundles of MCP servers, skills, commands, and plugins
//

import Foundation

/// Configuration for a saved app that bundles multiple configurations together
struct AppConfig: Codable, Identifiable, Hashable {
    let id: UUID
    var name: String
    var icon: String                      // SF Symbol name
    var description: String
    var enabledMCPServerIds: Set<UUID>    // Custom MCP servers
    var enabledSkillIds: Set<UUID>
    var enabledCommandIds: Set<UUID>
    var enabledPluginIds: Set<UUID>
    var defaultMode: TerminalMode
    var defaultProjectPath: String?       // Optional preset project
    var maestroMCPEnabled: Bool
    var customInstructions: String?       // Custom instructions for Claude
    var createdAt: Date
    var lastUsed: Date?

    init(
        id: UUID = UUID(),
        name: String,
        icon: String = "app.fill",
        description: String = "",
        enabledMCPServerIds: Set<UUID> = [],
        enabledSkillIds: Set<UUID> = [],
        enabledCommandIds: Set<UUID> = [],
        enabledPluginIds: Set<UUID> = [],
        defaultMode: TerminalMode = .claudeCode,
        defaultProjectPath: String? = nil,
        maestroMCPEnabled: Bool = true,
        customInstructions: String? = nil,
        createdAt: Date = Date(),
        lastUsed: Date? = nil
    ) {
        self.id = id
        self.name = name
        self.icon = icon
        self.description = description
        self.enabledMCPServerIds = enabledMCPServerIds
        self.enabledSkillIds = enabledSkillIds
        self.enabledCommandIds = enabledCommandIds
        self.enabledPluginIds = enabledPluginIds
        self.defaultMode = defaultMode
        self.defaultProjectPath = defaultProjectPath
        self.maestroMCPEnabled = maestroMCPEnabled
        self.customInstructions = customInstructions
        self.createdAt = createdAt
        self.lastUsed = lastUsed
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: AppConfig, rhs: AppConfig) -> Bool {
        lhs.id == rhs.id
    }
}

/// Common SF Symbols for app icons
struct AppIconOptions {
    static let icons: [String] = [
        "app.fill",
        "hammer.fill",
        "wrench.and.screwdriver.fill",
        "gearshape.fill",
        "terminal.fill",
        "chevron.left.forwardslash.chevron.right",
        "cloud.fill",
        "bolt.fill",
        "wand.and.stars",
        "sparkles",
        "cpu.fill",
        "memorychip.fill",
        "server.rack",
        "externaldrive.fill",
        "doc.text.fill",
        "folder.fill",
        "book.fill",
        "graduationcap.fill",
        "lightbulb.fill",
        "puzzlepiece.fill",
        "cube.fill",
        "shippingbox.fill",
        "testtube.2",
        "flask.fill",
        "atom",
        "leaf.fill",
        "flame.fill",
        "drop.fill",
        "star.fill",
        "heart.fill",
        "flag.fill",
        "bookmark.fill"
    ]
}
