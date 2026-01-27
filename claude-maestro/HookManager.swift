//
//  HookManager.swift
//  claude-maestro
//
//  Manages hook discovery from marketplace plugins and per-session hook injection
//

import Foundation
import Combine

/// Represents a hook event type
enum HookEventType: String, Codable, CaseIterable {
    case preToolUse = "PreToolUse"
    case postToolUse = "PostToolUse"
    case stop = "Stop"
    case subagentStop = "SubagentStop"
    case sessionStart = "SessionStart"
    case sessionEnd = "SessionEnd"
    case userPromptSubmit = "UserPromptSubmit"
    case preCompact = "PreCompact"
    case notification = "Notification"
}

/// Represents a single hook configuration
struct HookConfig: Codable {
    var type: String  // "command" or "prompt"
    var command: String?
    var prompt: String?
    var timeout: Int?

    enum CodingKeys: String, CodingKey {
        case type, command, prompt, timeout
    }
}

/// Represents a hook matcher with optional tool/path filters
struct HookMatcher: Codable {
    var tool: String?
    var path: String?
    var hooks: [HookConfig]
}

/// Structure of a plugin's hooks.json file (decode-only, hooks parsed separately)
struct PluginHooksManifest {
    var description: String?
    // hooks are parsed manually from raw JSON due to complex nested structure
}

/// A discovered hook from a plugin
struct DiscoveredHook: Identifiable {
    let id = UUID()
    let pluginName: String
    let pluginPath: String
    let eventType: String
    let rawConfig: [[String: Any]]
}

/// Manages hook discovery and per-session injection
@MainActor
class HookManager: ObservableObject {
    static let shared = HookManager()

    // Discovered hooks from plugins
    @Published var discoveredHooks: [DiscoveredHook] = []

    // Per-session worktree paths for hook syncing
    private var sessionWorktreePaths: [Int: String] = [:]

    private let pluginsPath: String

    private init() {
        pluginsPath = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/plugins").path
        scanForHooks()
    }

    // MARK: - Hook Discovery

    /// Scan installed plugins for hooks
    func scanForHooks() {
        var hooks: [DiscoveredHook] = []

        let fm = FileManager.default
        guard fm.fileExists(atPath: pluginsPath) else { return }

        guard let pluginDirs = try? fm.contentsOfDirectory(atPath: pluginsPath) else { return }

        for pluginName in pluginDirs {
            // Skip non-directories and special directories
            if pluginName == "marketplaces" || pluginName == "cache" ||
               pluginName == "repos" || pluginName.hasPrefix(".") {
                continue
            }

            let pluginPath = "\(pluginsPath)/\(pluginName)"

            // Resolve symlink to get actual path
            var resolvedPath = pluginPath
            if let linkTarget = try? fm.destinationOfSymbolicLink(atPath: pluginPath) {
                if linkTarget.hasPrefix("/") {
                    resolvedPath = linkTarget
                } else {
                    resolvedPath = URL(fileURLWithPath: linkTarget,
                                      relativeTo: URL(fileURLWithPath: pluginsPath))
                                 .standardized.path
                }
            }

            // Check if it's a directory
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: resolvedPath, isDirectory: &isDir), isDir.boolValue else {
                continue
            }

            // Look for hooks.json in hooks/ subdirectory
            let hooksJsonPath = "\(resolvedPath)/hooks/hooks.json"
            if let pluginHooks = parseHooksJson(at: hooksJsonPath, pluginName: pluginName, pluginPath: resolvedPath) {
                hooks.append(contentsOf: pluginHooks)
            }
        }

        discoveredHooks = hooks
    }

    /// Parse a hooks.json file and extract hook configurations
    private func parseHooksJson(at path: String, pluginName: String, pluginPath: String) -> [DiscoveredHook]? {
        let fm = FileManager.default
        guard fm.fileExists(atPath: path) else { return nil }

        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let hooksDict = json["hooks"] as? [String: Any] else {
            return nil
        }

        var discoveredHooks: [DiscoveredHook] = []

        for (eventType, config) in hooksDict {
            if let configArray = config as? [[String: Any]] {
                discoveredHooks.append(DiscoveredHook(
                    pluginName: pluginName,
                    pluginPath: pluginPath,
                    eventType: eventType,
                    rawConfig: configArray
                ))
            }
        }

        return discoveredHooks.isEmpty ? nil : discoveredHooks
    }

    // MARK: - Hook Injection

    /// Sync hooks to a worktree's .claude/settings.local.json based on enabled plugins
    func syncWorktreeHooks(worktreePath: String, for sessionId: Int) {
        sessionWorktreePaths[sessionId] = worktreePath

        let fm = FileManager.default
        let claudeDir = "\(worktreePath)/.claude"
        let settingsPath = "\(claudeDir)/settings.local.json"

        // Get enabled plugins for this session
        let enabledPlugins = MarketplaceManager.shared.enabledPlugins(for: sessionId)
        let enabledPluginNames = Set(enabledPlugins.map { $0.name })

        // Filter hooks to only enabled plugins
        let enabledHooks = discoveredHooks.filter { enabledPluginNames.contains($0.pluginName) }

        // If no hooks to inject, remove any existing hook settings
        guard !enabledHooks.isEmpty else {
            removeHooksFromSettings(at: settingsPath)
            return
        }

        // Ensure .claude directory exists
        if !fm.fileExists(atPath: claudeDir) {
            try? fm.createDirectory(atPath: claudeDir, withIntermediateDirectories: true)
        }

        // Read existing settings or create new
        var settings: [String: Any] = [:]
        if let existingData = try? Data(contentsOf: URL(fileURLWithPath: settingsPath)),
           let existingJson = try? JSONSerialization.jsonObject(with: existingData) as? [String: Any] {
            settings = existingJson
        }

        // Build hooks section with ${CLAUDE_PLUGIN_ROOT} substituted
        var mergedHooks: [String: [[String: Any]]] = [:]

        for hook in enabledHooks {
            let processedConfig = processHookConfig(hook.rawConfig, pluginPath: hook.pluginPath)

            if var existing = mergedHooks[hook.eventType] {
                existing.append(contentsOf: processedConfig)
                mergedHooks[hook.eventType] = existing
            } else {
                mergedHooks[hook.eventType] = processedConfig
            }
        }

        // Update settings with hooks
        settings["hooks"] = mergedHooks

        // Write back
        do {
            let jsonData = try JSONSerialization.data(withJSONObject: settings, options: [.prettyPrinted, .sortedKeys])
            try jsonData.write(to: URL(fileURLWithPath: settingsPath))
        } catch {
            print("Warning: Failed to write hooks to settings.local.json: \(error)")
        }
    }

    /// Process hook config to substitute ${CLAUDE_PLUGIN_ROOT}
    private func processHookConfig(_ config: [[String: Any]], pluginPath: String) -> [[String: Any]] {
        return config.map { matcher in
            var processedMatcher = matcher

            if var hooks = matcher["hooks"] as? [[String: Any]] {
                hooks = hooks.map { hook in
                    var processedHook = hook

                    // Substitute in command field
                    if let command = hook["command"] as? String {
                        processedHook["command"] = command.replacingOccurrences(
                            of: "${CLAUDE_PLUGIN_ROOT}",
                            with: pluginPath
                        )
                    }

                    // Substitute in prompt field (in case it references files)
                    if let prompt = hook["prompt"] as? String {
                        processedHook["prompt"] = prompt.replacingOccurrences(
                            of: "${CLAUDE_PLUGIN_ROOT}",
                            with: pluginPath
                        )
                    }

                    return processedHook
                }
                processedMatcher["hooks"] = hooks
            }

            return processedMatcher
        }
    }

    /// Remove hooks section from settings file
    private func removeHooksFromSettings(at path: String) {
        let fm = FileManager.default
        guard fm.fileExists(atPath: path),
              let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
              var json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }

        // Remove hooks key
        json.removeValue(forKey: "hooks")

        // If settings is now empty (or only has empty dicts), remove the file
        if json.isEmpty {
            try? fm.removeItem(atPath: path)
            return
        }

        // Write back without hooks
        if let jsonData = try? JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys]) {
            try? jsonData.write(to: URL(fileURLWithPath: path))
        }
    }

    /// Clean up worktree hooks (remove settings.local.json hooks section)
    func cleanupWorktreeHooks(worktreePath: String) {
        let settingsPath = "\(worktreePath)/.claude/settings.local.json"
        removeHooksFromSettings(at: settingsPath)
    }

    /// Re-sync hooks when plugins are toggled for a session
    func resyncHooksForSession(_ sessionId: Int) {
        if let worktreePath = sessionWorktreePaths[sessionId] {
            syncWorktreeHooks(worktreePath: worktreePath, for: sessionId)
        }
    }

    // MARK: - Plugin Hooks Info

    /// Get hooks for a specific plugin
    func hooks(for pluginName: String) -> [DiscoveredHook] {
        discoveredHooks.filter { $0.pluginName == pluginName }
    }

    /// Check if a plugin has hooks
    func hasHooks(_ pluginName: String) -> Bool {
        discoveredHooks.contains { $0.pluginName == pluginName }
    }
}
