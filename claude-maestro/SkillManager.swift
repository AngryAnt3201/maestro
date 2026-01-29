//
//  SkillManager.swift
//  claude-maestro
//
//  Manages skill discovery, configuration, and per-session settings
//

import Foundation
import Combine

/// Manages skills discovery and per-session configuration
@MainActor
class SkillManager: ObservableObject {
    static let shared = SkillManager()

    // Discovered/installed skills
    @Published var installedSkills: [SkillConfig] = []

    // Per-session skill configurations (sessionId -> config)
    @Published var sessionSkillConfigs: [Int: SessionSkillConfig] = [:]

    // Global visibility preferences for skill sources
    @Published var visibleSkillSources: Set<SkillSource.SourceType> = Set(SkillSource.SourceType.allCases)

    // Per-session worktree paths (sessionId -> worktreePath) for skill syncing
    private var sessionWorktreePaths: [Int: String] = [:]

    // Discovery status
    @Published var isScanning: Bool = false
    @Published var lastScanError: String?

    // Project path for project-specific skills
    @Published var currentProjectPath: String?

    private let installedSkillsKey = "claude-maestro-installed-skills"
    private let sessionSkillConfigsKey = "claude-maestro-session-skill-configs"
    private let visibleSourcesKey = "claude-maestro-visible-skill-sources"

    private init() {
        loadInstalledSkills()
        loadSessionConfigs()
        loadVisibleSources()
        scanForSkills()
    }

    // MARK: - Skill Discovery

    /// Personal skills directory path
    private var personalSkillsPath: String {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/skills").path
    }

    /// Plugins directory path
    private var pluginsPath: String {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/plugins").path
    }

    /// Marketplaces directory path (nested within plugins)
    private var marketplacesPath: String {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/plugins/marketplaces").path
    }

    /// Ensure the skills directory exists
    func ensureSkillsDirectory() {
        let fm = FileManager.default
        if !fm.fileExists(atPath: personalSkillsPath) {
            try? fm.createDirectory(atPath: personalSkillsPath, withIntermediateDirectories: true)
        }
    }

    /// Scan standard skill locations for installed skills
    func scanForSkills() {
        isScanning = true
        lastScanError = nil

        // Ensure skills directory exists
        ensureSkillsDirectory()

        var discoveredSkills: [SkillConfig] = []

        // 1. Personal skills: ~/.claude/skills/*/SKILL.md
        // Note: Only scans non-symlinked skills now. Marketplace skills are discovered via MarketplaceManager.
        if let personalSkills = scanDirectory(personalSkillsPath, source: .personal, followSymlinks: false) {
            discoveredSkills.append(contentsOf: personalSkills)
        }

        // 2. Scan plugins directory for skills: ~/.claude/plugins/*/skills/*/SKILL.md
        // This catches skills from plugins that weren't installed via marketplace
        // Note: We exclude the marketplaces subdirectory since those are handled separately
        if let pluginSkills = scanPluginsDirectory() {
            discoveredSkills.append(contentsOf: pluginSkills)
        }

        // 3. Scan installed marketplace plugins for skills (via MarketplaceManager)
        // This replaces the old symlink-based discovery
        if let marketplaceSkills = scanInstalledMarketplacePlugins() {
            discoveredSkills.append(contentsOf: marketplaceSkills)
        }

        // 4. Project skills (if project path is set)
        // Note: followSymlinks: false prevents worktree symlinks from being re-discovered as project skills
        if let projectPath = currentProjectPath {
            let projectSkillsPath = "\(projectPath)/.claude/skills"
            if let projectSkills = scanDirectory(projectSkillsPath, source: .project(projectPath: projectPath), followSymlinks: false) {
                discoveredSkills.append(contentsOf: projectSkills)
            }
        }

        // Merge with existing (preserve IDs for already-known skills)
        mergeDiscoveredSkills(discoveredSkills)

        isScanning = false
    }

    /// Scan installed marketplace plugins for skills
    private func scanInstalledMarketplacePlugins() -> [SkillConfig]? {
        // Access MarketplaceManager to get installed plugins
        let installedPlugins = MarketplaceManager.shared.installedPlugins
        guard !installedPlugins.isEmpty else { return nil }

        var skills: [SkillConfig] = []

        for plugin in installedPlugins {
            let pluginPath = plugin.path
            let fm = FileManager.default
            var isDir: ObjCBool = false

            guard fm.fileExists(atPath: pluginPath, isDirectory: &isDir), isDir.boolValue else {
                continue
            }

            let marketplaceName: String
            switch plugin.source {
            case .official:
                marketplaceName = "claude-plugins-official"
            case .marketplace(let name):
                marketplaceName = name
            case .local:
                marketplaceName = "local"
            }

            let source: SkillSource = .marketplace(name: marketplaceName, pluginName: plugin.name)

            // Check if plugin root contains SKILL.md
            let rootSkillPath = "\(pluginPath)/SKILL.md"
            if fm.fileExists(atPath: rootSkillPath) {
                if let skill = parseSkill(at: pluginPath, source: source) {
                    if !skills.contains(where: { $0.path == skill.path }) {
                        skills.append(skill)
                    }
                }
            }

            // Check for skills subdirectory
            let skillsDir = "\(pluginPath)/skills"
            if let skillDirContents = try? fm.contentsOfDirectory(atPath: skillsDir) {
                for skillName in skillDirContents {
                    let skillPath = "\(skillsDir)/\(skillName)"
                    let skillMDPath = "\(skillPath)/SKILL.md"

                    var skillIsDir: ObjCBool = false
                    if fm.fileExists(atPath: skillPath, isDirectory: &skillIsDir),
                       skillIsDir.boolValue,
                       fm.fileExists(atPath: skillMDPath) {
                        if let skill = parseSkill(at: skillPath, source: source) {
                            if !skills.contains(where: { $0.path == skill.path }) {
                                skills.append(skill)
                            }
                        }
                    }
                }
            }
        }

        return skills.isEmpty ? nil : skills
    }

    /// Scan the plugins directory for skills
    private func scanPluginsDirectory() -> [SkillConfig]? {
        let fm = FileManager.default
        guard fm.fileExists(atPath: pluginsPath) else { return nil }

        guard let pluginDirs = try? fm.contentsOfDirectory(atPath: pluginsPath) else {
            return nil
        }

        var skills: [SkillConfig] = []

        for pluginName in pluginDirs {
            // Skip marketplaces directory - those skills should only appear after explicit installation
            if pluginName == "marketplaces" {
                continue
            }

            let pluginPath = "\(pluginsPath)/\(pluginName)"
            var isDir: ObjCBool = false

            guard fm.fileExists(atPath: pluginPath, isDirectory: &isDir), isDir.boolValue else {
                continue
            }

            // Check if plugin root contains SKILL.md
            let rootSkillPath = "\(pluginPath)/SKILL.md"
            if fm.fileExists(atPath: rootSkillPath) {
                if let skill = parseSkill(at: pluginPath, source: .plugin(pluginName: pluginName)) {
                    // Check if already discovered via symlink (avoid duplicates)
                    if !skills.contains(where: { $0.name == skill.name }) {
                        skills.append(skill)
                    }
                }
            }

            // Check for skills subdirectory
            let skillsDir = "\(pluginPath)/skills"
            if let skillDirContents = try? fm.contentsOfDirectory(atPath: skillsDir) {
                for skillName in skillDirContents {
                    let skillPath = "\(skillsDir)/\(skillName)"
                    let skillMDPath = "\(skillPath)/SKILL.md"

                    var skillIsDir: ObjCBool = false
                    if fm.fileExists(atPath: skillPath, isDirectory: &skillIsDir),
                       skillIsDir.boolValue,
                       fm.fileExists(atPath: skillMDPath) {
                        if let skill = parseSkill(at: skillPath, source: .plugin(pluginName: pluginName)) {
                            // Check if already discovered via symlink (avoid duplicates)
                            if !skills.contains(where: { $0.name == skill.name }) {
                                skills.append(skill)
                            }
                        }
                    }
                }
            }
        }

        return skills.isEmpty ? nil : skills
    }

    /// Scan the marketplaces directory for skills
    /// Structure: ~/.claude/plugins/marketplaces/<marketplace>/plugins/<plugin>/skills/<skill>/SKILL.md
    /// Also checks: ~/.claude/plugins/marketplaces/<marketplace>/external_plugins/<plugin>/skills/<skill>/SKILL.md
    private func scanMarketplacesDirectory() -> [SkillConfig]? {
        let fm = FileManager.default
        guard fm.fileExists(atPath: marketplacesPath) else { return nil }

        guard let marketplaceDirs = try? fm.contentsOfDirectory(atPath: marketplacesPath) else {
            return nil
        }

        var skills: [SkillConfig] = []

        for marketplaceName in marketplaceDirs {
            let marketplacePath = "\(marketplacesPath)/\(marketplaceName)"
            var isDir: ObjCBool = false

            guard fm.fileExists(atPath: marketplacePath, isDirectory: &isDir), isDir.boolValue else {
                continue
            }

            // Scan both "plugins" and "external_plugins" subdirectories
            let subdirectories = ["plugins", "external_plugins"]
            for subdir in subdirectories {
                let pluginsDir = "\(marketplacePath)/\(subdir)"
                if let pluginDirs = try? fm.contentsOfDirectory(atPath: pluginsDir) {
                    for pluginName in pluginDirs {
                        let pluginPath = "\(pluginsDir)/\(pluginName)"
                        if let pluginSkills = scanPluginDirectory(
                            at: pluginPath,
                            pluginName: pluginName,
                            marketplace: marketplaceName
                        ) {
                            // Avoid duplicates by name
                            for skill in pluginSkills {
                                if !skills.contains(where: { $0.name == skill.name }) {
                                    skills.append(skill)
                                }
                            }
                        }
                    }
                }
            }
        }

        return skills.isEmpty ? nil : skills
    }

    /// Scan a plugin directory for skills
    /// Handles both root-level SKILL.md and skills subdirectory
    private func scanPluginDirectory(at pluginPath: String, pluginName: String, marketplace: String?) -> [SkillConfig]? {
        let fm = FileManager.default
        var isDir: ObjCBool = false

        guard fm.fileExists(atPath: pluginPath, isDirectory: &isDir), isDir.boolValue else {
            return nil
        }

        var skills: [SkillConfig] = []
        let source: SkillSource = marketplace != nil
            ? .marketplace(name: marketplace!, pluginName: pluginName)
            : .plugin(pluginName: pluginName)

        // Check if plugin root contains SKILL.md
        let rootSkillPath = "\(pluginPath)/SKILL.md"
        if fm.fileExists(atPath: rootSkillPath) {
            if let skill = parseSkill(at: pluginPath, source: source) {
                skills.append(skill)
            }
        }

        // Check for skills subdirectory
        let skillsDir = "\(pluginPath)/skills"
        if let skillDirContents = try? fm.contentsOfDirectory(atPath: skillsDir) {
            for skillName in skillDirContents {
                let skillPath = "\(skillsDir)/\(skillName)"
                let skillMDPath = "\(skillPath)/SKILL.md"

                var skillIsDir: ObjCBool = false
                if fm.fileExists(atPath: skillPath, isDirectory: &skillIsDir),
                   skillIsDir.boolValue,
                   fm.fileExists(atPath: skillMDPath) {
                    if let skill = parseSkill(at: skillPath, source: source) {
                        if !skills.contains(where: { $0.name == skill.name }) {
                            skills.append(skill)
                        }
                    }
                }
            }
        }

        return skills.isEmpty ? nil : skills
    }

    /// Scan a project directory for project-specific skills
    func scanProjectSkills(projectPath: String) {
        currentProjectPath = projectPath
        scanForSkills()
    }

    /// Scan a directory for skill directories containing SKILL.md
    /// - Parameters:
    ///   - path: Directory path to scan
    ///   - source: Source attribution for discovered skills
    ///   - followSymlinks: If false, skips symlinked directories (default: true)
    private func scanDirectory(_ path: String, source: SkillSource, followSymlinks: Bool = true) -> [SkillConfig]? {
        let fm = FileManager.default
        guard fm.fileExists(atPath: path) else { return nil }

        guard let contents = try? fm.contentsOfDirectory(atPath: path) else {
            return nil
        }

        var skills: [SkillConfig] = []

        for item in contents {
            let skillPath = "\(path)/\(item)"
            let skillMDPath = "\(skillPath)/SKILL.md"

            // Skip symlinks if followSymlinks is false
            if !followSymlinks {
                if let attrs = try? fm.attributesOfItem(atPath: skillPath),
                   let fileType = attrs[.type] as? FileAttributeType,
                   fileType == .typeSymbolicLink {
                    continue
                }
            }

            // Check if it's a directory with SKILL.md
            var isDir: ObjCBool = false
            if fm.fileExists(atPath: skillPath, isDirectory: &isDir),
               isDir.boolValue,
               fm.fileExists(atPath: skillMDPath) {
                if let skill = parseSkill(at: skillPath, source: source) {
                    skills.append(skill)
                }
            }
        }

        return skills.isEmpty ? nil : skills
    }

    /// Parse a skill from its directory
    private func parseSkill(at path: String, source: SkillSource) -> SkillConfig? {
        let skillMDPath = "\(path)/SKILL.md"

        guard let content = try? String(contentsOfFile: skillMDPath, encoding: .utf8) else {
            return nil
        }

        // Parse YAML frontmatter
        let frontmatter = parseFrontmatter(content)
        let markdownContent = extractMarkdownContent(content)

        // Get name from frontmatter or directory name
        let dirName = URL(fileURLWithPath: path).lastPathComponent
        let name = frontmatter["name"] as? String ?? dirName

        // Get description from frontmatter or first paragraph
        var description = frontmatter["description"] as? String ?? ""
        if description.isEmpty {
            description = extractFirstParagraph(markdownContent)
        }

        return SkillConfig(
            name: name,
            description: description,
            path: path,
            source: source,
            isEnabled: true,
            argumentHint: frontmatter["argument-hint"] as? String,
            disableModelInvocation: frontmatter["disable-model-invocation"] as? Bool,
            userInvocable: frontmatter["user-invocable"] as? Bool,
            allowedTools: parseStringArray(frontmatter["allowed-tools"]),
            model: frontmatter["model"] as? String,
            context: frontmatter["context"] as? String,
            agent: frontmatter["agent"] as? String
        )
    }

    /// Parse YAML frontmatter from SKILL.md content
    private func parseFrontmatter(_ content: String) -> [String: Any] {
        guard content.hasPrefix("---") else { return [:] }

        let lines = content.components(separatedBy: "\n")
        var inFrontmatter = false
        var frontmatterLines: [String] = []

        for line in lines {
            if line.trimmingCharacters(in: .whitespaces) == "---" {
                if inFrontmatter {
                    break // End of frontmatter
                } else {
                    inFrontmatter = true
                    continue
                }
            }
            if inFrontmatter {
                frontmatterLines.append(line)
            }
        }

        // Simple YAML parsing for key: value pairs
        var result: [String: Any] = [:]
        for line in frontmatterLines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty || trimmed.hasPrefix("#") { continue }

            if let colonIndex = trimmed.firstIndex(of: ":") {
                let key = String(trimmed[..<colonIndex]).trimmingCharacters(in: .whitespaces)
                var value = String(trimmed[trimmed.index(after: colonIndex)...]).trimmingCharacters(in: .whitespaces)

                // Handle boolean values
                if value.lowercased() == "true" {
                    result[key] = true
                } else if value.lowercased() == "false" {
                    result[key] = false
                } else {
                    // Remove quotes if present
                    if (value.hasPrefix("\"") && value.hasSuffix("\"")) ||
                       (value.hasPrefix("'") && value.hasSuffix("'")) {
                        value = String(value.dropFirst().dropLast())
                    }
                    result[key] = value
                }
            }
        }

        return result
    }

    /// Extract markdown content after frontmatter
    private func extractMarkdownContent(_ content: String) -> String {
        guard content.hasPrefix("---") else { return content }

        var dashCount = 0
        var endIndex = content.startIndex

        for (index, char) in content.enumerated() {
            if content[content.index(content.startIndex, offsetBy: index)...].hasPrefix("---") {
                dashCount += 1
                if dashCount == 2 {
                    endIndex = content.index(content.startIndex, offsetBy: index + 3)
                    break
                }
            }
        }

        if dashCount == 2 {
            return String(content[endIndex...]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return content
    }

    /// Extract first paragraph from markdown content
    private func extractFirstParagraph(_ content: String) -> String {
        let lines = content.components(separatedBy: "\n")
        var paragraph = ""

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                if !paragraph.isEmpty { break }
                continue
            }
            // Skip headers
            if trimmed.hasPrefix("#") { continue }

            if !paragraph.isEmpty { paragraph += " " }
            paragraph += trimmed
        }

        // Limit length
        if paragraph.count > 200 {
            paragraph = String(paragraph.prefix(197)) + "..."
        }

        return paragraph
    }

    /// Parse string array from frontmatter value
    private func parseStringArray(_ value: Any?) -> [String]? {
        if let str = value as? String {
            // Handle comma-separated format: "Read, Grep, Glob"
            return str.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        }
        return nil
    }

    /// Merge discovered skills with existing, preserving IDs
    private func mergeDiscoveredSkills(_ discovered: [SkillConfig]) {
        var merged: [SkillConfig] = []

        for skill in discovered {
            // Check if we already have this skill by path
            if let existing = installedSkills.first(where: { $0.path == skill.path }) {
                // Update with new info but keep the ID and enabled state
                var updated = skill
                updated = SkillConfig(
                    id: existing.id,
                    name: skill.name,
                    description: skill.description,
                    path: skill.path,
                    source: skill.source,
                    isEnabled: existing.isEnabled,
                    installedAt: existing.installedAt,
                    argumentHint: skill.argumentHint,
                    disableModelInvocation: skill.disableModelInvocation,
                    userInvocable: skill.userInvocable,
                    allowedTools: skill.allowedTools,
                    model: skill.model,
                    context: skill.context,
                    agent: skill.agent
                )
                merged.append(updated)
            } else {
                merged.append(skill)
            }
        }

        installedSkills = merged
        persistInstalledSkills()
    }

    // MARK: - Skill Management

    /// Add a skill manually
    func addSkill(_ skill: SkillConfig) {
        installedSkills.append(skill)
        persistInstalledSkills()
    }

    /// Update an existing skill
    func updateSkill(_ skill: SkillConfig) {
        if let index = installedSkills.firstIndex(where: { $0.id == skill.id }) {
            installedSkills[index] = skill
            persistInstalledSkills()
        }
    }

    /// Delete a skill
    func deleteSkill(id: UUID) {
        installedSkills.removeAll { $0.id == id }
        // Remove from all session configs
        for key in sessionSkillConfigs.keys {
            sessionSkillConfigs[key]?.enabledSkillIds.remove(id)
        }
        persistInstalledSkills()
        persistSessionConfigs()
    }

    /// Toggle skill enabled state
    func toggleSkillEnabled(id: UUID) {
        if let index = installedSkills.firstIndex(where: { $0.id == id }) {
            installedSkills[index].isEnabled.toggle()
            persistInstalledSkills()
        }
    }

    // MARK: - Per-Session Configuration

    /// Get skill configuration for a specific session
    func getSkillConfig(for sessionId: Int) -> SessionSkillConfig {
        return sessionSkillConfigs[sessionId] ?? SessionSkillConfig()
    }

    /// Set whether a skill is enabled for a session
    func setSkillEnabled(_ skillId: UUID, enabled: Bool, for sessionId: Int) {
        var config = getSkillConfig(for: sessionId)
        if enabled {
            config.enabledSkillIds.insert(skillId)
        } else {
            config.enabledSkillIds.remove(skillId)
        }
        sessionSkillConfigs[sessionId] = config
        persistSessionConfigs()

        // Re-sync worktree skills if we know the worktree path
        if let worktreePath = sessionWorktreePaths[sessionId] {
            syncWorktreeSkills(worktreePath: worktreePath, for: sessionId)
        }
    }

    /// Get all skills that are enabled for a specific session
    /// De-duplicates by command name, preferring local plugin sources over marketplace sources
    func enabledSkills(for sessionId: Int) -> [SkillConfig] {
        let config = getSkillConfig(for: sessionId)
        let enabledList = installedSkills.filter { skill in
            skill.isEnabled && config.enabledSkillIds.contains(skill.id)
        }

        // De-duplicate by command name, preferring local plugin over marketplace
        var skillsByName: [String: SkillConfig] = [:]
        for skill in enabledList {
            let name = skill.commandName
            if let existing = skillsByName[name] {
                // Prefer plugin source over marketplace
                if case .plugin = skill.source, case .marketplace = existing.source {
                    skillsByName[name] = skill
                }
                // Otherwise keep existing (first one wins if same source type)
            } else {
                skillsByName[name] = skill
            }
        }

        return Array(skillsByName.values)
    }

    /// Initialize session config with no skills enabled (user must opt-in)
    func initializeSessionConfig(for sessionId: Int) {
        if sessionSkillConfigs[sessionId] == nil {
            // Start with empty set - user must enable skills explicitly per session
            sessionSkillConfigs[sessionId] = SessionSkillConfig(enabledSkillIds: [])
            persistSessionConfigs()
        }
    }

    // MARK: - Global Source Visibility

    /// Set whether a skill source type is visible in the selector
    func setSourceVisible(_ sourceType: SkillSource.SourceType, visible: Bool) {
        if visible {
            visibleSkillSources.insert(sourceType)
        } else {
            visibleSkillSources.remove(sourceType)
        }
        persistVisibleSources()
    }

    /// Check if a skill source type is visible
    func isSourceVisible(_ sourceType: SkillSource.SourceType) -> Bool {
        visibleSkillSources.contains(sourceType)
    }

    // MARK: - Per-Session Worktree Skills

    /// Sync skills to a worktree's .claude/skills/ directory based on session config
    /// This creates symlinks to only the skills enabled for this session
    func syncWorktreeSkills(worktreePath: String, for sessionId: Int) {
        // Store the worktree path for future syncs (when skills are toggled)
        sessionWorktreePaths[sessionId] = worktreePath

        let fm = FileManager.default
        let worktreeSkillsPath = "\(worktreePath)/.claude/skills"

        // Get enabled skills for this session
        let enabledSkillsList = enabledSkills(for: sessionId)
        let enabledSkillPaths = Set(enabledSkillsList.map { $0.path })

        // Ensure .claude directory exists
        let claudeDir = "\(worktreePath)/.claude"
        if !fm.fileExists(atPath: claudeDir) {
            try? fm.createDirectory(atPath: claudeDir, withIntermediateDirectories: true)
        }

        // Get current symlinks in worktree skills directory
        var existingSymlinks: [String: String] = [:] // name -> target
        if fm.fileExists(atPath: worktreeSkillsPath) {
            if let contents = try? fm.contentsOfDirectory(atPath: worktreeSkillsPath) {
                for item in contents {
                    let itemPath = "\(worktreeSkillsPath)/\(item)"
                    if let target = try? fm.destinationOfSymbolicLink(atPath: itemPath) {
                        // Resolve relative symlinks to absolute paths
                        let resolvedTarget = URL(fileURLWithPath: target, relativeTo: URL(fileURLWithPath: itemPath).deletingLastPathComponent()).standardized.path
                        existingSymlinks[item] = resolvedTarget
                    }
                }
            }
        } else {
            // Create skills directory
            try? fm.createDirectory(atPath: worktreeSkillsPath, withIntermediateDirectories: true)
        }

        // Determine what symlinks need to be added/removed
        let desiredSymlinks: [String: String] = enabledSkillsList.reduce(into: [:]) { result, skill in
            let skillName = URL(fileURLWithPath: skill.path).lastPathComponent
            result[skillName] = skill.path
        }

        // Remove symlinks that shouldn't exist anymore
        for (name, _) in existingSymlinks {
            if desiredSymlinks[name] == nil {
                let symlinkPath = "\(worktreeSkillsPath)/\(name)"
                try? fm.removeItem(atPath: symlinkPath)
            }
        }

        // Add symlinks that don't exist yet or point to wrong target
        for (name, targetPath) in desiredSymlinks {
            let symlinkPath = "\(worktreeSkillsPath)/\(name)"

            if let existingTarget = existingSymlinks[name] {
                if existingTarget == targetPath {
                    continue // Symlink already correct
                }
                // Wrong target, remove and recreate
                try? fm.removeItem(atPath: symlinkPath)
            }

            // Create symlink
            do {
                try fm.createSymbolicLink(atPath: symlinkPath, withDestinationPath: targetPath)
            } catch {
                print("Warning: Failed to create skill symlink '\(name)' in worktree: \(error)")
            }
        }
    }

    /// Clean up worktree skills directory (remove all symlinks)
    func cleanupWorktreeSkills(worktreePath: String) {
        let fm = FileManager.default
        let worktreeSkillsPath = "\(worktreePath)/.claude/skills"

        guard fm.fileExists(atPath: worktreeSkillsPath) else { return }

        if let contents = try? fm.contentsOfDirectory(atPath: worktreeSkillsPath) {
            for item in contents {
                let itemPath = "\(worktreeSkillsPath)/\(item)"
                // Only remove symlinks, not actual directories
                if let attrs = try? fm.attributesOfItem(atPath: itemPath),
                   let fileType = attrs[.type] as? FileAttributeType,
                   fileType == .typeSymbolicLink {
                    try? fm.removeItem(atPath: itemPath)
                }
            }
        }
    }

    // MARK: - Persistence

    private func persistInstalledSkills() {
        if let encoded = try? JSONEncoder().encode(installedSkills) {
            UserDefaults.standard.set(encoded, forKey: installedSkillsKey)
        }
    }

    private func loadInstalledSkills() {
        if let data = UserDefaults.standard.data(forKey: installedSkillsKey),
           let decoded = try? JSONDecoder().decode([SkillConfig].self, from: data) {
            installedSkills = decoded
        }
    }

    private func persistSessionConfigs() {
        if let encoded = try? JSONEncoder().encode(sessionSkillConfigs) {
            UserDefaults.standard.set(encoded, forKey: sessionSkillConfigsKey)
        }
    }

    private func loadSessionConfigs() {
        if let data = UserDefaults.standard.data(forKey: sessionSkillConfigsKey),
           let decoded = try? JSONDecoder().decode([Int: SessionSkillConfig].self, from: data) {
            sessionSkillConfigs = decoded
        }
    }

    private func persistVisibleSources() {
        let rawValues = visibleSkillSources.map { $0.rawValue }
        if let encoded = try? JSONEncoder().encode(rawValues) {
            UserDefaults.standard.set(encoded, forKey: visibleSourcesKey)
        }
    }

    private func loadVisibleSources() {
        if let data = UserDefaults.standard.data(forKey: visibleSourcesKey),
           let rawValues = try? JSONDecoder().decode([String].self, from: data) {
            visibleSkillSources = Set(rawValues.compactMap { SkillSource.SourceType(rawValue: $0) })
        }
        // If empty (first launch or all disabled), default to all visible
        if visibleSkillSources.isEmpty && UserDefaults.standard.object(forKey: visibleSourcesKey) == nil {
            visibleSkillSources = Set(SkillSource.SourceType.allCases)
        }
    }

}
