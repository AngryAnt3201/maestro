//
//  CommandManager.swift
//  claude-maestro
//
//  Manages command discovery, configuration, and per-session settings
//

import Foundation
import Combine

/// Manages command discovery and per-session configuration
@MainActor
class CommandManager: ObservableObject {
    static let shared = CommandManager()

    // Discovered commands
    @Published var installedCommands: [CommandConfig] = []

    // Per-session command configurations (sessionId -> config)
    @Published var sessionCommandConfigs: [Int: SessionCommandConfig] = [:]

    // Discovery status
    @Published var isScanning: Bool = false
    @Published var lastScanError: String?

    // Project path for project-specific commands
    @Published var currentProjectPath: String?

    private let installedCommandsKey = "claude-maestro-installed-commands"
    private let sessionCommandConfigsKey = "claude-maestro-session-command-configs"

    private init() {
        loadInstalledCommands()
        loadSessionConfigs()
        scanForCommands()
    }

    // MARK: - Paths

    /// Personal commands directory path
    private var personalCommandsPath: String {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/commands").path
    }

    /// Plugins directory path
    private var pluginsPath: String {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/plugins").path
    }

    /// Ensure the commands directory exists
    func ensureCommandsDirectory() {
        let fm = FileManager.default
        if !fm.fileExists(atPath: personalCommandsPath) {
            try? fm.createDirectory(atPath: personalCommandsPath, withIntermediateDirectories: true)
        }
    }

    // MARK: - Command Discovery

    /// Scan standard command locations for installed commands
    func scanForCommands() {
        isScanning = true
        lastScanError = nil

        // Ensure commands directory exists
        ensureCommandsDirectory()

        var discoveredCommands: [CommandConfig] = []

        // 1. Personal commands: ~/.claude/commands/*.md
        if let personalCommands = scanCommandsDirectory(personalCommandsPath, source: .personal) {
            discoveredCommands.append(contentsOf: personalCommands)
        }

        // 2. Scan plugins directory for commands: ~/.claude/plugins/*/commands/*.md
        // Excludes marketplaces subdirectory
        if let pluginCommands = scanPluginsForCommands() {
            discoveredCommands.append(contentsOf: pluginCommands)
        }

        // 3. Project commands (if project path is set): .claude/commands/*.md
        // Note: followSymlinks: false prevents worktree symlinks from being re-discovered as project commands
        if let projectPath = currentProjectPath {
            let projectCommandsPath = "\(projectPath)/.claude/commands"
            if let projectCommands = scanCommandsDirectory(projectCommandsPath, source: .project(projectPath: projectPath), followSymlinks: false) {
                discoveredCommands.append(contentsOf: projectCommands)
            }
        }

        // Merge with existing (preserve IDs for already-known commands)
        mergeDiscoveredCommands(discoveredCommands)

        isScanning = false
    }

    /// Scan a directory for .md command files
    /// - Parameters:
    ///   - path: Directory path to scan
    ///   - source: Source attribution for discovered commands
    ///   - followSymlinks: If false, skips symlinked files (default: true)
    private func scanCommandsDirectory(_ path: String, source: CommandSource, followSymlinks: Bool = true) -> [CommandConfig]? {
        let fm = FileManager.default
        guard fm.fileExists(atPath: path) else { return nil }

        guard let contents = try? fm.contentsOfDirectory(atPath: path) else {
            return nil
        }

        var commands: [CommandConfig] = []

        for item in contents {
            // Only process .md files
            guard item.hasSuffix(".md") else { continue }

            let commandPath = "\(path)/\(item)"

            // Skip symlinks if followSymlinks is false
            if !followSymlinks {
                if let attrs = try? fm.attributesOfItem(atPath: commandPath),
                   let fileType = attrs[.type] as? FileAttributeType,
                   fileType == .typeSymbolicLink {
                    continue
                }
            }

            var isDir: ObjCBool = false

            // Skip directories
            if fm.fileExists(atPath: commandPath, isDirectory: &isDir), !isDir.boolValue {
                if let command = parseCommand(at: commandPath, source: source) {
                    commands.append(command)
                }
            }
        }

        return commands.isEmpty ? nil : commands
    }

    /// Scan plugins directory for commands
    private func scanPluginsForCommands() -> [CommandConfig]? {
        let fm = FileManager.default
        guard fm.fileExists(atPath: pluginsPath) else { return nil }

        guard let pluginDirs = try? fm.contentsOfDirectory(atPath: pluginsPath) else {
            return nil
        }

        var commands: [CommandConfig] = []

        for pluginName in pluginDirs {
            // Skip marketplaces directory
            if pluginName == "marketplaces" {
                continue
            }

            let pluginPath = "\(pluginsPath)/\(pluginName)"

            // Resolve symlink to get actual target path
            var resolvedPath = pluginPath
            if let linkTarget = try? fm.destinationOfSymbolicLink(atPath: pluginPath) {
                // Handle both absolute and relative symlink targets
                if linkTarget.hasPrefix("/") {
                    resolvedPath = linkTarget
                } else {
                    resolvedPath = URL(fileURLWithPath: linkTarget,
                                      relativeTo: URL(fileURLWithPath: pluginsPath))
                                 .standardized.path
                }
            }

            // Check if the resolved path actually exists
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: resolvedPath, isDirectory: &isDir), isDir.boolValue else {
                continue
            }

            // Check for commands subdirectory in the resolved path
            let commandsDir = "\(resolvedPath)/commands"
            if let pluginCommands = scanCommandsDirectory(commandsDir, source: .plugin(pluginName: pluginName)) {
                // Check for duplicates by name
                for command in pluginCommands {
                    if !commands.contains(where: { $0.commandName == command.commandName }) {
                        commands.append(command)
                    }
                }
            }
        }

        return commands.isEmpty ? nil : commands
    }

    /// Scan project for commands
    func scanProjectCommands(projectPath: String) {
        currentProjectPath = projectPath
        scanForCommands()
    }

    /// Parse a command from its .md file
    private func parseCommand(at path: String, source: CommandSource) -> CommandConfig? {
        guard let content = try? String(contentsOfFile: path, encoding: .utf8) else {
            return nil
        }

        // Parse YAML frontmatter
        let frontmatter = parseFrontmatter(content)
        let markdownContent = extractMarkdownContent(content)

        // Get name from filename without .md extension
        let fileName = URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent
        let name = frontmatter["name"] as? String ?? fileName

        // Get description from frontmatter or first paragraph
        var description = frontmatter["description"] as? String ?? ""
        if description.isEmpty {
            description = extractFirstParagraph(markdownContent)
        }

        return CommandConfig(
            name: name,
            description: description,
            path: path,
            source: source,
            isEnabled: true,
            argumentHint: frontmatter["argument-hint"] as? String,
            allowedTools: parseStringArray(frontmatter["allowed-tools"]),
            model: frontmatter["model"] as? String
        )
    }

    /// Parse YAML frontmatter from command .md content
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

        for (index, _) in content.enumerated() {
            let idx = content.index(content.startIndex, offsetBy: index)
            if content[idx...].hasPrefix("---") {
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

    // MARK: - Plugin Variable Substitution

    /// Resolve the plugin root directory from a command's source
    private func resolvePluginRoot(from commandPath: String, source: CommandSource) -> String? {
        switch source {
        case .personal, .project:
            return nil
        case .plugin(let pluginName):
            let symlinkPath = "\(pluginsPath)/\(pluginName)"
            if let target = try? FileManager.default.destinationOfSymbolicLink(atPath: symlinkPath) {
                // Handle both absolute and relative symlink targets
                if target.hasPrefix("/") {
                    return target
                }
                return URL(fileURLWithPath: target, relativeTo: URL(fileURLWithPath: pluginsPath)).standardized.path
            }
            return derivePluginRootFromPath(commandPath)
        case .marketplace(let marketplaceName, let pluginName):
            // Marketplace plugins are stored at ~/.claude/plugins/marketplaces/<marketplace>/<plugin>
            let marketplacesPath = "\(pluginsPath)/marketplaces"
            let pluginPath = "\(marketplacesPath)/\(marketplaceName)/\(pluginName)"
            let fm = FileManager.default
            if fm.fileExists(atPath: pluginPath) {
                return pluginPath
            }
            return derivePluginRootFromPath(commandPath)
        }
    }

    /// Derive plugin root by walking up the directory tree looking for "commands" directory
    private func derivePluginRootFromPath(_ commandPath: String) -> String? {
        var url = URL(fileURLWithPath: commandPath)
        while url.path != "/" {
            url = url.deletingLastPathComponent()
            if url.lastPathComponent == "commands" {
                return url.deletingLastPathComponent().path
            }
        }
        return nil
    }

    /// Substitute ${CLAUDE_PLUGIN_ROOT} variable in command content
    private func substitutePluginVariables(content: String, pluginRoot: String) -> String {
        content.replacingOccurrences(of: "${CLAUDE_PLUGIN_ROOT}", with: pluginRoot)
    }

    /// Merge discovered commands with existing, preserving IDs
    private func mergeDiscoveredCommands(_ discovered: [CommandConfig]) {
        var merged: [CommandConfig] = []

        for command in discovered {
            // Check if we already have this command by path
            if let existing = installedCommands.first(where: { $0.path == command.path }) {
                // Update with new info but keep the ID and enabled state
                let updated = CommandConfig(
                    id: existing.id,
                    name: command.name,
                    description: command.description,
                    path: command.path,
                    source: command.source,
                    isEnabled: existing.isEnabled,
                    discoveredAt: existing.discoveredAt,
                    argumentHint: command.argumentHint,
                    allowedTools: command.allowedTools,
                    model: command.model
                )
                merged.append(updated)
            } else {
                merged.append(command)
            }
        }

        installedCommands = merged
        persistInstalledCommands()
    }

    // MARK: - Command Management

    /// Toggle command enabled state
    func toggleCommandEnabled(id: UUID) {
        if let index = installedCommands.firstIndex(where: { $0.id == id }) {
            installedCommands[index].isEnabled.toggle()
            persistInstalledCommands()
        }
    }

    // MARK: - Per-Session Configuration

    /// Get command configuration for a specific session
    func getCommandConfig(for sessionId: Int) -> SessionCommandConfig {
        return sessionCommandConfigs[sessionId] ?? SessionCommandConfig()
    }

    /// Set whether a command is enabled for a session
    func setCommandEnabled(_ commandId: UUID, enabled: Bool, for sessionId: Int) {
        var config = getCommandConfig(for: sessionId)
        if enabled {
            config.enabledCommandIds.insert(commandId)
        } else {
            config.enabledCommandIds.remove(commandId)
        }
        sessionCommandConfigs[sessionId] = config
        persistSessionConfigs()
    }

    /// Get all commands that are enabled for a specific session
    func enabledCommands(for sessionId: Int) -> [CommandConfig] {
        let config = getCommandConfig(for: sessionId)
        return installedCommands.filter { command in
            command.isEnabled && config.enabledCommandIds.contains(command.id)
        }
    }

    /// Initialize session config with no commands enabled (user must opt-in)
    func initializeSessionConfig(for sessionId: Int) {
        if sessionCommandConfigs[sessionId] == nil {
            // Start with empty set - user must enable commands explicitly per session
            sessionCommandConfigs[sessionId] = SessionCommandConfig(enabledCommandIds: [])
            persistSessionConfigs()
        }
    }

    // MARK: - Per-Session Worktree Commands

    /// Storage for worktree paths per session (for re-syncing when commands are toggled)
    private var sessionWorktreePaths: [Int: String] = [:]

    /// Sync commands to a worktree's .claude/commands/ directory based on session config
    /// This creates symlinks or processed copies (for commands with ${CLAUDE_PLUGIN_ROOT}) to only the commands enabled for this session
    func syncWorktreeCommands(worktreePath: String, for sessionId: Int) {
        // Store the worktree path for future syncs (when commands are toggled)
        sessionWorktreePaths[sessionId] = worktreePath

        let fm = FileManager.default
        let worktreeCommandsPath = "\(worktreePath)/.claude/commands"

        // Get enabled commands for this session
        let enabledCommandsList = enabledCommands(for: sessionId)

        // Ensure .claude directory exists
        let claudeDir = "\(worktreePath)/.claude"
        if !fm.fileExists(atPath: claudeDir) {
            try? fm.createDirectory(atPath: claudeDir, withIntermediateDirectories: true)
        }

        // Get current items in worktree commands directory (symlinks and processed copies)
        var existingItems: [String: (isSymlink: Bool, target: String?)] = [:]
        if fm.fileExists(atPath: worktreeCommandsPath) {
            if let contents = try? fm.contentsOfDirectory(atPath: worktreeCommandsPath) {
                for item in contents {
                    let itemPath = "\(worktreeCommandsPath)/\(item)"
                    if let target = try? fm.destinationOfSymbolicLink(atPath: itemPath) {
                        // Resolve relative symlinks to absolute paths
                        let resolvedTarget = URL(fileURLWithPath: target, relativeTo: URL(fileURLWithPath: itemPath).deletingLastPathComponent()).standardized.path
                        existingItems[item] = (isSymlink: true, target: resolvedTarget)
                    } else {
                        // Regular file (processed copy)
                        existingItems[item] = (isSymlink: false, target: nil)
                    }
                }
            }
        } else {
            // Create commands directory
            try? fm.createDirectory(atPath: worktreeCommandsPath, withIntermediateDirectories: true)
        }

        // Build desired state for each command
        let desiredCommands: [String: CommandConfig] = enabledCommandsList.reduce(into: [:]) { result, command in
            let commandFileName = URL(fileURLWithPath: command.path).lastPathComponent
            result[commandFileName] = command
        }

        // Remove items that shouldn't exist anymore
        for (name, _) in existingItems {
            if desiredCommands[name] == nil {
                let itemPath = "\(worktreeCommandsPath)/\(name)"
                try? fm.removeItem(atPath: itemPath)
            }
        }

        // Add or update commands
        for (name, command) in desiredCommands {
            let destinationPath = "\(worktreeCommandsPath)/\(name)"

            // Check if command content contains ${CLAUDE_PLUGIN_ROOT}
            guard let content = try? String(contentsOfFile: command.path, encoding: .utf8) else {
                print("Warning: Failed to read command file '\(command.path)'")
                continue
            }

            let needsSubstitution = content.contains("${CLAUDE_PLUGIN_ROOT}")

            if needsSubstitution {
                // Resolve plugin root and create processed copy
                guard let pluginRoot = resolvePluginRoot(from: command.path, source: command.source) else {
                    print("Warning: Could not resolve plugin root for command '\(name)'")
                    continue
                }

                let processedContent = substitutePluginVariables(content: content, pluginRoot: pluginRoot)

                // Check if we need to update the file
                if let existingItem = existingItems[name] {
                    if !existingItem.isSymlink {
                        // Already a processed copy, check if content matches
                        if let existingContent = try? String(contentsOfFile: destinationPath, encoding: .utf8),
                           existingContent == processedContent {
                            continue // Content already correct
                        }
                    }
                    // Remove existing item (either symlink or outdated copy)
                    try? fm.removeItem(atPath: destinationPath)
                }

                // Write processed content as regular file
                do {
                    try processedContent.write(toFile: destinationPath, atomically: true, encoding: .utf8)
                } catch {
                    print("Warning: Failed to write processed command '\(name)' to worktree: \(error)")
                }
            } else {
                // No substitution needed, use symlink for efficiency
                if let existingItem = existingItems[name] {
                    if existingItem.isSymlink && existingItem.target == command.path {
                        continue // Symlink already correct
                    }
                    // Remove existing item (either wrong symlink or unnecessary copy)
                    try? fm.removeItem(atPath: destinationPath)
                }

                // Create symlink
                do {
                    try fm.createSymbolicLink(atPath: destinationPath, withDestinationPath: command.path)
                } catch {
                    print("Warning: Failed to create command symlink '\(name)' in worktree: \(error)")
                }
            }
        }
    }

    /// Clean up worktree commands directory (remove all symlinks and processed copies)
    func cleanupWorktreeCommands(worktreePath: String) {
        let fm = FileManager.default
        let worktreeCommandsPath = "\(worktreePath)/.claude/commands"

        guard fm.fileExists(atPath: worktreeCommandsPath) else { return }

        if let contents = try? fm.contentsOfDirectory(atPath: worktreeCommandsPath) {
            for item in contents {
                // Only process .md files (our synced commands)
                guard item.hasSuffix(".md") else { continue }

                let itemPath = "\(worktreeCommandsPath)/\(item)"
                // Remove both symlinks and regular files (processed copies)
                // We only touch .md files to avoid removing unrelated files
                try? fm.removeItem(atPath: itemPath)
            }
        }
    }

    // MARK: - Persistence

    private func persistInstalledCommands() {
        if let encoded = try? JSONEncoder().encode(installedCommands) {
            UserDefaults.standard.set(encoded, forKey: installedCommandsKey)
        }
    }

    private func loadInstalledCommands() {
        if let data = UserDefaults.standard.data(forKey: installedCommandsKey),
           let decoded = try? JSONDecoder().decode([CommandConfig].self, from: data) {
            installedCommands = decoded
        }
    }

    private func persistSessionConfigs() {
        if let encoded = try? JSONEncoder().encode(sessionCommandConfigs) {
            UserDefaults.standard.set(encoded, forKey: sessionCommandConfigsKey)
        }
    }

    private func loadSessionConfigs() {
        if let data = UserDefaults.standard.data(forKey: sessionCommandConfigsKey),
           let decoded = try? JSONDecoder().decode([Int: SessionCommandConfig].self, from: data) {
            sessionCommandConfigs = decoded
        }
    }

}
