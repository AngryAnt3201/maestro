//
//  SkillConfig.swift
//  claude-maestro
//
//  Data models for skills configuration
//

import Foundation

/// Configuration for an installed/discovered skill
struct SkillConfig: Codable, Identifiable, Hashable {
    let id: UUID
    var name: String
    var description: String
    var path: String                    // Absolute path to skill directory
    var source: SkillSource
    var isEnabled: Bool
    var installedAt: Date

    // Frontmatter fields from SKILL.md
    var argumentHint: String?
    var disableModelInvocation: Bool?
    var userInvocable: Bool?
    var allowedTools: [String]?
    var model: String?
    var context: String?
    var agent: String?

    /// Generate the slash command name (sanitized)
    var commandName: String {
        name.lowercased()
            .replacingOccurrences(of: " ", with: "-")
            .filter { $0.isLetter || $0.isNumber || $0 == "-" }
    }

    init(
        id: UUID = UUID(),
        name: String,
        description: String,
        path: String,
        source: SkillSource,
        isEnabled: Bool = true,
        installedAt: Date = Date(),
        argumentHint: String? = nil,
        disableModelInvocation: Bool? = nil,
        userInvocable: Bool? = nil,
        allowedTools: [String]? = nil,
        model: String? = nil,
        context: String? = nil,
        agent: String? = nil
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.path = path
        self.source = source
        self.isEnabled = isEnabled
        self.installedAt = installedAt
        self.argumentHint = argumentHint
        self.disableModelInvocation = disableModelInvocation
        self.userInvocable = userInvocable
        self.allowedTools = allowedTools
        self.model = model
        self.context = context
        self.agent = agent
    }
}

/// Source of a skill installation
enum SkillSource: Codable, Hashable {
    case personal                       // ~/.claude/skills/<name>/
    case project(projectPath: String)   // .claude/skills/<name>/
    case plugin(pluginName: String)     // From installed plugin
    case local(path: String)            // Manually added local path

    var displayName: String {
        switch self {
        case .personal:
            return "Personal"
        case .project:
            return "Project"
        case .plugin(let name):
            return name
        case .local:
            return "Local"
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
        case .local:
            return "doc"
        }
    }
}

/// Per-session configuration for which skills are enabled
struct SessionSkillConfig: Codable {
    var enabledSkillIds: Set<UUID>

    init(enabledSkillIds: Set<UUID> = []) {
        self.enabledSkillIds = enabledSkillIds
    }

    func isSkillEnabled(_ skillId: UUID) -> Bool {
        enabledSkillIds.contains(skillId)
    }
}
