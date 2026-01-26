//
//  MarketplaceManager.swift
//  claude-maestro
//
//  Manages marketplace sources, plugin discovery, and installation
//

import Foundation
import Combine

/// Manages marketplace sources and plugin installation
@MainActor
class MarketplaceManager: ObservableObject {
    static let shared = MarketplaceManager()

    // Marketplace sources
    @Published var sources: [MarketplaceSource] = []

    // Available plugins from all sources
    @Published var availablePlugins: [MarketplacePlugin] = []

    // Installed plugins
    @Published var installedPlugins: [InstalledPlugin] = []

    // Per-session plugin configurations (sessionId -> config)
    @Published var sessionPluginConfigs: [Int: SessionPluginConfig] = [:]

    // Loading state
    @Published var isLoading: Bool = false
    @Published var lastError: String?

    private let sourcesKey = "claude-maestro-marketplace-sources"
    private let installedPluginsKey = "claude-maestro-installed-plugins"
    private let sessionPluginConfigsKey = "claude-maestro-session-plugin-configs"

    private init() {
        loadSources()
        loadInstalledPlugins()
        loadSessionConfigs()
        setupDefaultSources()
        verifyPluginSymlinks()
        // Note: Don't call syncMarketplaceSkills() here - skills should only appear
        // after being explicitly installed via installPlugin()
    }

    /// Verify and recreate any missing symlinks for installed plugins
    /// Note: Only verifies command symlinks now. Skill symlinks are created per-session in worktrees.
    private func verifyPluginSymlinks() {
        let fm = FileManager.default

        // Ensure plugins directory exists (skills dir no longer needed for global symlinks)
        try? ensurePluginsDirectory()

        var needsPersist = false

        for index in installedPlugins.indices {
            var plugin = installedPlugins[index]

            // Clean up any legacy skill symlinks (from before per-session skills)
            if !plugin.skillSymlinks.isEmpty {
                removePluginSymlinks(plugin.skillSymlinks)
                plugin.skillSymlinks = []
                // Re-discover skills from the plugin path
                plugin.skills = discoverSkillNames(in: plugin.path, pluginName: plugin.name)
                installedPlugins[index] = plugin
                needsPersist = true
            }

            // Check if command symlinks need migration to new plugin directory format
            // Old format: individual .md symlinks in ~/.claude/commands/
            // New format: single plugin directory symlink in ~/.claude/plugins/
            var needsCommandMigration = false
            var oldStyleSymlinksToRemove: [String] = []
            let expectedPluginSymlink = "\(pluginsPath)/\(plugin.name)"

            if plugin.commandSymlinks.isEmpty {
                // No symlinks recorded, check if plugin has commands
                let commandsDir = "\(plugin.path)/commands"
                if fm.fileExists(atPath: commandsDir) {
                    needsCommandMigration = true
                }
            } else if plugin.commandSymlinks.contains(where: { $0.contains("/.claude/commands/") }) {
                // Old-style individual .md symlinks - migrate to new format
                needsCommandMigration = true
                // Mark old symlinks for removal AFTER successful migration
                oldStyleSymlinksToRemove = plugin.commandSymlinks.filter { $0.contains("/.claude/commands/") }
            } else if !fm.fileExists(atPath: expectedPluginSymlink) {
                // New-style symlink missing
                needsCommandMigration = true
            }

            // If command symlinks need migration/recreation
            if needsCommandMigration && fm.fileExists(atPath: plugin.path) {
                do {
                    let newSymlinks = try symlinkPluginCommands(from: plugin.path, pluginName: plugin.name)

                    // Only delete old symlinks AFTER successfully creating new ones
                    if !newSymlinks.isEmpty && !oldStyleSymlinksToRemove.isEmpty {
                        for oldPath in oldStyleSymlinksToRemove {
                            try? fm.removeItem(atPath: oldPath)
                        }
                    }

                    plugin.commandSymlinks = newSymlinks
                    // Extract command names from the plugin's commands directory
                    plugin.commands = discoverCommandNames(in: plugin.path)
                    installedPlugins[index] = plugin
                    needsPersist = true
                } catch {
                    print("Warning: Failed to recreate command symlinks for \(plugin.name): \(error)")
                }
            }
        }

        if needsPersist {
            persistInstalledPlugins()
        }
    }

    // MARK: - Marketplace Skills Sync

    /// Marketplaces directory path
    private var marketplacesPath: String {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/plugins/marketplaces").path
    }

    /// Sync skills from marketplace plugins to ~/.claude/skills/
    /// Creates symlinks for all skills found in marketplace plugins
    func syncMarketplaceSkills() {
        let fm = FileManager.default

        // Ensure skills directory exists
        try? ensureSkillsDirectory()

        // Clean up orphaned symlinks first
        cleanupOrphanedSkillSymlinks()

        // Scan marketplaces directory
        guard fm.fileExists(atPath: marketplacesPath) else { return }

        guard let marketplaceDirs = try? fm.contentsOfDirectory(atPath: marketplacesPath) else {
            return
        }

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
                        createSkillSymlinksForPlugin(at: pluginPath, pluginName: pluginName)
                    }
                }
            }
        }

        // Trigger skill manager rescan to pick up the new symlinks
        SkillManager.shared.scanForSkills()
    }

    /// Create symlinks for all skills in a plugin directory
    private func createSkillSymlinksForPlugin(at pluginPath: String, pluginName: String) {
        let fm = FileManager.default
        var isDir: ObjCBool = false

        guard fm.fileExists(atPath: pluginPath, isDirectory: &isDir), isDir.boolValue else {
            return
        }

        // Check if plugin root contains SKILL.md
        let rootSkillPath = "\(pluginPath)/SKILL.md"
        if fm.fileExists(atPath: rootSkillPath) {
            createSymlinkIfNeeded(from: pluginPath, skillName: pluginName)
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
                    createSymlinkIfNeeded(from: skillPath, skillName: skillName)
                }
            }
        }
    }

    /// Create a symlink in ~/.claude/skills/ if it doesn't exist or is broken
    private func createSymlinkIfNeeded(from sourcePath: String, skillName: String) {
        let fm = FileManager.default
        let symlinkPath = "\(personalSkillsPath)/\(skillName)"

        // Check if symlink already exists and points to correct location
        if let existingTarget = try? fm.destinationOfSymbolicLink(atPath: symlinkPath) {
            // Resolve to absolute path for comparison
            let resolvedExisting = URL(fileURLWithPath: existingTarget, relativeTo: URL(fileURLWithPath: symlinkPath).deletingLastPathComponent()).standardized.path
            let resolvedSource = URL(fileURLWithPath: sourcePath).standardized.path

            if resolvedExisting == resolvedSource {
                return // Symlink already exists and points to correct location
            }
        }

        // Remove existing symlink or file if it exists
        try? fm.removeItem(atPath: symlinkPath)

        // Create new symlink
        do {
            try fm.createSymbolicLink(atPath: symlinkPath, withDestinationPath: sourcePath)
        } catch {
            print("Warning: Failed to create symlink for skill '\(skillName)': \(error)")
        }
    }

    /// Remove symlinks from ~/.claude/skills/ that point to non-existent locations
    private func cleanupOrphanedSkillSymlinks() {
        let fm = FileManager.default

        guard let contents = try? fm.contentsOfDirectory(atPath: personalSkillsPath) else {
            return
        }

        for item in contents {
            let itemPath = "\(personalSkillsPath)/\(item)"

            // Check if it's a symlink
            guard let attrs = try? fm.attributesOfItem(atPath: itemPath),
                  let fileType = attrs[.type] as? FileAttributeType,
                  fileType == .typeSymbolicLink else {
                continue
            }

            // Check if symlink target exists
            if let targetPath = try? fm.destinationOfSymbolicLink(atPath: itemPath) {
                // Resolve relative path if needed
                let resolvedTarget = URL(fileURLWithPath: targetPath, relativeTo: URL(fileURLWithPath: itemPath).deletingLastPathComponent()).path

                // If target doesn't exist, remove the orphaned symlink
                if !fm.fileExists(atPath: resolvedTarget) {
                    try? fm.removeItem(atPath: itemPath)
                }
            }
        }
    }

    // MARK: - Default Setup

    private func setupDefaultSources() {
        // Add official marketplace if not present
        // Note: Disabled by default until official repo exists
        if !sources.contains(where: { $0.name == "claude-plugins-official" }) {
            let officialSource = MarketplaceSource(
                name: "claude-plugins-official",
                repositoryURL: "anthropics/claude-plugins-official",
                isOfficial: true,
                isEnabled: false
            )
            sources.append(officialSource)
            persistSources()
        }
    }

    // MARK: - Marketplace Fetching

    /// Refresh all enabled marketplaces
    func refreshMarketplaces() async {
        isLoading = true
        lastError = nil

        var allPlugins: [MarketplacePlugin] = []

        for source in sources where source.isEnabled {
            do {
                let plugins = try await fetchPlugins(from: source)
                allPlugins.append(contentsOf: plugins)

                // Update source last fetched
                if let index = sources.firstIndex(where: { $0.id == source.id }) {
                    sources[index].lastFetched = Date()
                    sources[index].lastError = nil
                }
            } catch {
                // Update source with error
                if let index = sources.firstIndex(where: { $0.id == source.id }) {
                    sources[index].lastError = error.localizedDescription
                }
                if lastError == nil {
                    lastError = "Failed to fetch from \(source.name): \(error.localizedDescription)"
                }
            }
        }

        availablePlugins = allPlugins
        persistSources()
        // Note: Don't sync marketplace skills here - only installed plugins should have their skills visible
        isLoading = false
    }

    /// Fetch plugins from a specific source
    func fetchPlugins(from source: MarketplaceSource) async throws -> [MarketplacePlugin] {
        guard let (owner, repo) = source.githubOwnerRepo else {
            throw MarketplaceError.invalidSourceURL
        }

        // Fetch marketplace.json from GitHub raw content
        let rawURL = "https://raw.githubusercontent.com/\(owner)/\(repo)/main/.claude-plugin/marketplace.json"

        guard let url = URL(string: rawURL) else {
            throw MarketplaceError.invalidSourceURL
        }

        let (data, response) = try await URLSession.shared.data(from: url)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw MarketplaceError.networkError("Invalid response")
        }

        if httpResponse.statusCode == 404 {
            // Try plugins.json as fallback
            let fallbackURL = "https://raw.githubusercontent.com/\(owner)/\(repo)/main/plugins.json"
            if let fallbackUrlObj = URL(string: fallbackURL) {
                let (fallbackData, fallbackResponse) = try await URLSession.shared.data(from: fallbackUrlObj)
                if let httpFallbackResponse = fallbackResponse as? HTTPURLResponse,
                   httpFallbackResponse.statusCode == 200 {
                    return try parseMarketplace(data: fallbackData, source: source, baseURL: "https://raw.githubusercontent.com/\(owner)/\(repo)/main")
                }
            }
            throw MarketplaceError.manifestNotFound
        }

        guard httpResponse.statusCode == 200 else {
            throw MarketplaceError.networkError("HTTP \(httpResponse.statusCode)")
        }

        return try parseMarketplace(data: data, source: source, baseURL: "https://raw.githubusercontent.com/\(owner)/\(repo)/main")
    }

    /// Parse marketplace manifest data
    private func parseMarketplace(data: Data, source: MarketplaceSource, baseURL: String) throws -> [MarketplacePlugin] {
        let decoder = JSONDecoder()

        // Try parsing as MarketplaceManifest first
        do {
            let manifest = try decoder.decode(MarketplaceManifest.self, from: data)
            return (manifest.plugins ?? []).map { $0.toMarketplacePlugin(marketplace: source.name, baseURL: baseURL) }
        } catch let manifestError {
            // Try parsing as array of plugins directly
            do {
                let plugins = try decoder.decode([MarketplacePluginManifest].self, from: data)
                return plugins.map { $0.toMarketplacePlugin(marketplace: source.name, baseURL: baseURL) }
            } catch let arrayError {
                // Include diagnostic info from both attempts
                let dataPreview = String(data: data.prefix(200), encoding: .utf8) ?? "Unable to decode data"
                throw MarketplaceError.parseError(
                    "Failed to parse manifest. As MarketplaceManifest: \(manifestError.localizedDescription). As plugin array: \(arrayError.localizedDescription). Data preview: \(dataPreview)"
                )
            }
        }
    }

    // MARK: - Plugin Installation

    /// Personal skills directory path
    private var personalSkillsPath: String {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/skills").path
    }

    /// Personal commands directory path
    private var personalCommandsPath: String {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/commands").path
    }

    /// Ensure the skills directory exists
    private func ensureSkillsDirectory() throws {
        let fm = FileManager.default
        if !fm.fileExists(atPath: personalSkillsPath) {
            try fm.createDirectory(atPath: personalSkillsPath, withIntermediateDirectories: true)
        }
    }

    /// Ensure the commands directory exists
    private func ensureCommandsDirectory() throws {
        let fm = FileManager.default
        if !fm.fileExists(atPath: personalCommandsPath) {
            try fm.createDirectory(atPath: personalCommandsPath, withIntermediateDirectories: true)
        }
    }

    /// Create symlinks for plugin skills in ~/.claude/skills/
    private func symlinkPluginSkills(from pluginPath: String, pluginName: String) throws -> [String] {
        let fm = FileManager.default
        var createdSymlinks: [String] = []

        // Ensure skills directory exists
        try ensureSkillsDirectory()

        // Look for skills directory in plugin
        let skillsDir = "\(pluginPath)/skills"
        guard fm.fileExists(atPath: skillsDir) else {
            // No skills directory - check if plugin root contains SKILL.md
            let rootSkillPath = "\(pluginPath)/SKILL.md"
            if fm.fileExists(atPath: rootSkillPath) {
                // Plugin root is a skill - symlink it
                let symlinkPath = "\(personalSkillsPath)/\(pluginName)"
                try? fm.removeItem(atPath: symlinkPath) // Remove existing symlink if any
                try fm.createSymbolicLink(atPath: symlinkPath, withDestinationPath: pluginPath)
                createdSymlinks.append(symlinkPath)
            }
            return createdSymlinks
        }

        // Scan skills directory for subdirectories with SKILL.md
        guard let contents = try? fm.contentsOfDirectory(atPath: skillsDir) else {
            return createdSymlinks
        }

        for skillName in contents {
            let skillPath = "\(skillsDir)/\(skillName)"
            let skillMDPath = "\(skillPath)/SKILL.md"

            var isDir: ObjCBool = false
            if fm.fileExists(atPath: skillPath, isDirectory: &isDir),
               isDir.boolValue,
               fm.fileExists(atPath: skillMDPath) {
                // Create symlink in ~/.claude/skills/
                let symlinkPath = "\(personalSkillsPath)/\(skillName)"
                try? fm.removeItem(atPath: symlinkPath) // Remove existing symlink if any
                try fm.createSymbolicLink(atPath: symlinkPath, withDestinationPath: skillPath)
                createdSymlinks.append(symlinkPath)
            }
        }

        return createdSymlinks
    }

    /// Plugins directory path for symlinks
    private var pluginsPath: String {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/plugins").path
    }

    /// Ensure the plugins directory exists
    private func ensurePluginsDirectory() throws {
        let fm = FileManager.default
        if !fm.fileExists(atPath: pluginsPath) {
            try fm.createDirectory(atPath: pluginsPath, withIntermediateDirectories: true)
        }
    }

    /// Create a plugin directory symlink in ~/.claude/plugins/
    /// This allows CommandManager to discover commands with proper plugin attribution
    private func symlinkPluginCommands(from pluginPath: String, pluginName: String) throws -> [String] {
        let fm = FileManager.default
        var createdSymlinks: [String] = []

        // Ensure plugins directory exists
        try ensurePluginsDirectory()

        // Standardize the plugin path to an absolute path
        let absolutePluginPath = URL(fileURLWithPath: pluginPath).standardized.path

        // Check if plugin has a commands directory - verify it actually exists
        let commandsDir = "\(absolutePluginPath)/commands"
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: commandsDir, isDirectory: &isDir), isDir.boolValue else {
            print("Warning: Commands directory not found at \(commandsDir)")
            return createdSymlinks
        }

        // Create symlink for the entire plugin directory in ~/.claude/plugins/
        // This allows CommandManager.scanPluginsForCommands() to discover it with proper source attribution
        let symlinkPath = "\(pluginsPath)/\(pluginName)"

        // Check if symlink already exists and points to correct location
        if let existingTarget = try? fm.destinationOfSymbolicLink(atPath: symlinkPath) {
            let resolvedExisting = URL(fileURLWithPath: existingTarget, relativeTo: URL(fileURLWithPath: symlinkPath).deletingLastPathComponent()).standardized.path
            if resolvedExisting == absolutePluginPath {
                // Symlink already exists and points to correct location
                createdSymlinks.append(symlinkPath)
                return createdSymlinks
            }
        }

        // Remove existing symlink or directory if it exists
        try? fm.removeItem(atPath: symlinkPath)

        // Create new symlink to the plugin directory using the absolute path
        try fm.createSymbolicLink(atPath: symlinkPath, withDestinationPath: absolutePluginPath)
        createdSymlinks.append(symlinkPath)

        return createdSymlinks
    }

    /// Discover command names from a plugin's commands directory
    private func discoverCommandNames(in pluginPath: String) -> [String] {
        let fm = FileManager.default
        let commandsDir = "\(pluginPath)/commands"
        guard let contents = try? fm.contentsOfDirectory(atPath: commandsDir) else {
            return []
        }

        return contents
            .filter { $0.hasSuffix(".md") }
            .map { URL(fileURLWithPath: $0).deletingPathExtension().lastPathComponent }
    }

    /// Discover skill names from a plugin directory
    /// Checks for: 1. Plugin root containing SKILL.md, 2. skills subdirectory with skill folders
    private func discoverSkillNames(in pluginPath: String, pluginName: String) -> [String] {
        let fm = FileManager.default
        var skillNames: [String] = []

        // Check if plugin root contains SKILL.md (plugin itself is a skill)
        let rootSkillPath = "\(pluginPath)/SKILL.md"
        if fm.fileExists(atPath: rootSkillPath) {
            skillNames.append(pluginName)
        }

        // Check for skills subdirectory
        let skillsDir = "\(pluginPath)/skills"
        if let contents = try? fm.contentsOfDirectory(atPath: skillsDir) {
            for skillName in contents {
                let skillPath = "\(skillsDir)/\(skillName)"
                let skillMDPath = "\(skillPath)/SKILL.md"

                var isDir: ObjCBool = false
                if fm.fileExists(atPath: skillPath, isDirectory: &isDir),
                   isDir.boolValue,
                   fm.fileExists(atPath: skillMDPath) {
                    skillNames.append(skillName)
                }
            }
        }

        return skillNames
    }

    /// Remove skill symlinks created for a plugin
    private func removePluginSymlinks(_ symlinks: [String]) {
        let fm = FileManager.default
        for symlinkPath in symlinks {
            try? fm.removeItem(atPath: symlinkPath)
        }
    }

    /// Derive the local marketplace source path from a plugin's download URL and marketplace name
    /// For example:
    /// - downloadURL: "https://raw.githubusercontent.com/owner/repo/main/./plugins/ralph-loop"
    /// - marketplace: "claude-plugins-official"
    /// - Returns: "~/.claude/plugins/marketplaces/claude-plugins-official/plugins/ralph-loop"
    private func deriveMarketplaceSourcePath(from plugin: MarketplacePlugin) -> String? {
        guard let downloadURL = plugin.downloadURL else { return nil }

        // Extract the path portion after the branch (usually "main/")
        // Format: https://raw.githubusercontent.com/owner/repo/main/./plugins/plugin-name
        // or: https://raw.githubusercontent.com/owner/repo/main/plugins/plugin-name
        let patterns = [
            "/main/./",  // With ./ prefix
            "/main/",    // Without ./ prefix
            "/master/./",
            "/master/"
        ]

        var relativePath: String?
        for pattern in patterns {
            if let range = downloadURL.range(of: pattern) {
                relativePath = String(downloadURL[range.upperBound...])
                break
            }
        }

        guard let path = relativePath else { return nil }

        // Clean up the path (remove leading ./ if present)
        let cleanPath = path.hasPrefix("./") ? String(path.dropFirst(2)) : path

        // Construct the local marketplace path
        let sourcePath = "\(marketplacesPath)/\(plugin.marketplace)/\(cleanPath)"
        return sourcePath
    }

    /// Check if a plugin exists at the given marketplace source path
    private func pluginExistsAtMarketplaceSource(_ path: String) -> Bool {
        let fm = FileManager.default
        var isDir: ObjCBool = false
        return fm.fileExists(atPath: path, isDirectory: &isDir) && isDir.boolValue
    }

    /// Install a plugin from marketplace
    func installPlugin(_ plugin: MarketplacePlugin, scope: InstallScope) async throws -> InstalledPlugin {
        // Determine installation path based on scope
        let installPath: String
        switch scope {
        case .user:
            installPath = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".claude/plugins/\(plugin.id)").path
        case .project:
            // Would need current project path
            throw MarketplaceError.installationError("Project scope requires a project path")
        case .local:
            throw MarketplaceError.installationError("Local scope requires a project path")
        }

        // Determine the source path for symlinking
        // Priority: 1. Local marketplace source (already cloned), 2. Download
        var sourcePath: String = installPath
        var useMarketplaceSource = false

        if let marketplaceSourcePath = deriveMarketplaceSourcePath(from: plugin),
           pluginExistsAtMarketplaceSource(marketplaceSourcePath) {
            // Use the existing marketplace source path
            sourcePath = marketplaceSourcePath
            useMarketplaceSource = true
        } else {
            // Plugin source not found in local marketplace - cannot install
            throw MarketplaceError.installationError(
                "Plugin '\(plugin.name)' not found in local marketplace. " +
                "Try refreshing the marketplace or check if the plugin exists in the repository."
            )
        }

        // Discover skills in the plugin (but don't create global symlinks)
        // Skills will be symlinked per-session into worktree .claude/skills/ directories
        var discoveredSkills: [String] = []
        discoveredSkills = discoverSkillNames(in: sourcePath, pluginName: plugin.name)

        // Create plugin directory symlink for commands
        var commandSymlinks: [String] = []
        var discoveredCommands: [String] = []
        do {
            commandSymlinks = try symlinkPluginCommands(from: sourcePath, pluginName: plugin.name)
            // Extract command names from the plugin's commands directory
            discoveredCommands = discoverCommandNames(in: sourcePath)
        } catch {
            print("Warning: Failed to create command symlinks: \(error)")
        }

        // Determine detected types based on what was actually found
        var detectedTypes: [PluginType] = plugin.types
        if !discoveredSkills.isEmpty && !detectedTypes.contains(.skill) {
            detectedTypes.append(.skill)
        }
        if !discoveredCommands.isEmpty && !detectedTypes.contains(.command) {
            detectedTypes.append(.command)
        }

        // Create installed plugin record
        // Store the source path so symlink verification works correctly
        // Note: skillSymlinks is now empty - skills are symlinked per-session into worktrees
        let installed = InstalledPlugin(
            name: plugin.name,
            description: plugin.description,
            version: plugin.version,
            source: plugin.marketplace == "claude-plugins-official" ? .official : .marketplace(name: plugin.marketplace),
            installScope: scope,
            path: useMarketplaceSource ? sourcePath : installPath,  // Use actual source path
            skills: discoveredSkills,
            commands: discoveredCommands,
            mcpServers: plugin.types.contains(.mcp) ? [plugin.name] : [],
            skillSymlinks: [],  // No longer creating global symlinks
            commandSymlinks: commandSymlinks
        )

        installedPlugins.append(installed)
        persistInstalledPlugins()

        // Trigger skill and command rescan to pick up the new symlinks
        SkillManager.shared.scanForSkills()
        CommandManager.shared.scanForCommands()

        return installed
    }

    /// Uninstall a plugin
    func uninstallPlugin(id: UUID) async throws {
        guard let plugin = installedPlugins.first(where: { $0.id == id }) else {
            throw MarketplaceError.pluginNotFound
        }

        // Remove skill and command symlinks first
        removePluginSymlinks(plugin.skillSymlinks)
        removePluginSymlinks(plugin.commandSymlinks)

        // Remove plugin directory
        try? FileManager.default.removeItem(atPath: plugin.path)

        // Remove from installed list
        installedPlugins.removeAll { $0.id == id }

        // Remove from session configs
        for key in sessionPluginConfigs.keys {
            sessionPluginConfigs[key]?.enabledPluginIds.remove(id)
        }

        persistInstalledPlugins()
        persistSessionConfigs()

        // Rescan skills and commands
        SkillManager.shared.scanForSkills()
        CommandManager.shared.scanForCommands()
    }

    /// Check if a marketplace plugin is already installed
    func isInstalled(_ plugin: MarketplacePlugin) -> Bool {
        installedPlugins.contains { $0.name == plugin.name }
    }

    // MARK: - Source Management

    /// Add a new marketplace source
    func addSource(repositoryURL: String, name: String? = nil) async throws -> MarketplaceSource {
        // Parse the URL to get a name
        let sourceName: String
        if let name = name {
            sourceName = name
        } else {
            // Extract from URL (e.g., "owner/repo" -> "owner-repo")
            sourceName = repositoryURL
                .replacingOccurrences(of: "https://github.com/", with: "")
                .replacingOccurrences(of: "git@github.com:", with: "")
                .replacingOccurrences(of: ".git", with: "")
                .replacingOccurrences(of: "/", with: "-")
        }

        // Check for duplicates
        if sources.contains(where: { $0.name == sourceName || $0.repositoryURL == repositoryURL }) {
            throw MarketplaceError.sourceAlreadyExists
        }

        let source = MarketplaceSource(
            name: sourceName,
            repositoryURL: repositoryURL
        )

        // Validate by fetching
        _ = try await fetchPlugins(from: source)

        sources.append(source)
        persistSources()

        return source
    }

    /// Remove a marketplace source
    func removeSource(id: UUID) {
        guard let source = sources.first(where: { $0.id == id }), !source.isOfficial else {
            return // Don't remove official marketplace
        }

        sources.removeAll { $0.id == id }

        // Remove plugins from this source
        availablePlugins.removeAll { $0.marketplace == source.name }

        persistSources()
    }

    /// Toggle source enabled state
    func toggleSourceEnabled(id: UUID) {
        if let index = sources.firstIndex(where: { $0.id == id }) {
            sources[index].isEnabled.toggle()
            persistSources()
        }
    }

    // MARK: - Per-Session Configuration

    /// Get plugin configuration for a specific session
    func getPluginConfig(for sessionId: Int) -> SessionPluginConfig {
        return sessionPluginConfigs[sessionId] ?? SessionPluginConfig()
    }

    /// Set whether a plugin is enabled for a session
    func setPluginEnabled(_ pluginId: UUID, enabled: Bool, for sessionId: Int) {
        var config = getPluginConfig(for: sessionId)
        if enabled {
            config.enabledPluginIds.insert(pluginId)
        } else {
            config.enabledPluginIds.remove(pluginId)
        }
        sessionPluginConfigs[sessionId] = config
        persistSessionConfigs()
    }

    /// Get all plugins that are enabled for a specific session
    func enabledPlugins(for sessionId: Int) -> [InstalledPlugin] {
        let config = getPluginConfig(for: sessionId)
        return installedPlugins.filter { plugin in
            plugin.isEnabled && config.enabledPluginIds.contains(plugin.id)
        }
    }

    /// Initialize session config with all enabled plugins
    func initializeSessionConfig(for sessionId: Int) {
        if sessionPluginConfigs[sessionId] == nil {
            let enabledIds = Set(installedPlugins.filter { $0.isEnabled }.map { $0.id })
            sessionPluginConfigs[sessionId] = SessionPluginConfig(enabledPluginIds: enabledIds)
            persistSessionConfigs()
        }
    }

    // MARK: - Persistence

    private func persistSources() {
        if let encoded = try? JSONEncoder().encode(sources) {
            UserDefaults.standard.set(encoded, forKey: sourcesKey)
        }
    }

    private func loadSources() {
        if let data = UserDefaults.standard.data(forKey: sourcesKey),
           let decoded = try? JSONDecoder().decode([MarketplaceSource].self, from: data) {
            sources = decoded
        }
    }

    private func persistInstalledPlugins() {
        if let encoded = try? JSONEncoder().encode(installedPlugins) {
            UserDefaults.standard.set(encoded, forKey: installedPluginsKey)
        }
    }

    private func loadInstalledPlugins() {
        if let data = UserDefaults.standard.data(forKey: installedPluginsKey),
           let decoded = try? JSONDecoder().decode([InstalledPlugin].self, from: data) {
            installedPlugins = decoded
        }
    }

    private func persistSessionConfigs() {
        if let encoded = try? JSONEncoder().encode(sessionPluginConfigs) {
            UserDefaults.standard.set(encoded, forKey: sessionPluginConfigsKey)
        }
    }

    private func loadSessionConfigs() {
        if let data = UserDefaults.standard.data(forKey: sessionPluginConfigsKey),
           let decoded = try? JSONDecoder().decode([Int: SessionPluginConfig].self, from: data) {
            sessionPluginConfigs = decoded
        }
    }
}

// MARK: - Errors

enum MarketplaceError: LocalizedError {
    case invalidSourceURL
    case manifestNotFound
    case networkError(String)
    case parseError(String)
    case installationError(String)
    case pluginNotFound
    case sourceAlreadyExists

    var errorDescription: String? {
        switch self {
        case .invalidSourceURL:
            return "Invalid marketplace URL"
        case .manifestNotFound:
            return "Marketplace manifest not found"
        case .networkError(let message):
            return "Network error: \(message)"
        case .parseError(let message):
            return "Parse error: \(message)"
        case .installationError(let message):
            return "Installation failed: \(message)"
        case .pluginNotFound:
            return "Plugin not found"
        case .sourceAlreadyExists:
            return "Marketplace source already exists"
        }
    }
}
