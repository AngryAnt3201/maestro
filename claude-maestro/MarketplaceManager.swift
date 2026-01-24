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
    }

    // MARK: - Default Setup

    private func setupDefaultSources() {
        // Add official marketplace if not present
        if !sources.contains(where: { $0.name == "claude-plugins-official" }) {
            let officialSource = MarketplaceSource(
                name: "claude-plugins-official",
                repositoryURL: "anthropics/claude-plugins-official",
                isOfficial: true
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
        if let manifest = try? decoder.decode(MarketplaceManifest.self, from: data) {
            return manifest.plugins.map { $0.toMarketplacePlugin(marketplace: source.name, baseURL: baseURL) }
        }

        // Try parsing as array of plugins directly
        if let plugins = try? decoder.decode([MarketplacePluginManifest].self, from: data) {
            return plugins.map { $0.toMarketplacePlugin(marketplace: source.name, baseURL: baseURL) }
        }

        throw MarketplaceError.parseError("Failed to parse marketplace manifest")
    }

    // MARK: - Plugin Installation

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

        // Create installation directory
        try FileManager.default.createDirectory(atPath: installPath, withIntermediateDirectories: true)

        // Download plugin contents
        if let downloadURL = plugin.downloadURL, let url = URL(string: downloadURL) {
            let (data, _) = try await URLSession.shared.data(from: url)
            // Write downloaded content (simplified - real implementation would unzip or clone)
            let targetPath = "\(installPath)/plugin.json"
            try data.write(to: URL(fileURLWithPath: targetPath))
        }

        // Create installed plugin record
        let installed = InstalledPlugin(
            name: plugin.name,
            description: plugin.description,
            version: plugin.version,
            source: plugin.marketplace == "claude-plugins-official" ? .official : .marketplace(name: plugin.marketplace),
            installScope: scope,
            path: installPath,
            skills: plugin.types.contains(.skill) ? [plugin.name] : [],
            mcpServers: plugin.types.contains(.mcp) ? [plugin.name] : []
        )

        installedPlugins.append(installed)
        persistInstalledPlugins()

        // If plugin contains skills, trigger skill rescan
        if plugin.types.contains(.skill) {
            SkillManager.shared.scanForSkills()
        }

        return installed
    }

    /// Uninstall a plugin
    func uninstallPlugin(id: UUID) async throws {
        guard let plugin = installedPlugins.first(where: { $0.id == id }) else {
            throw MarketplaceError.pluginNotFound
        }

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

        // Rescan skills
        SkillManager.shared.scanForSkills()
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
