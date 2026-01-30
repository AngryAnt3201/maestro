//
//  ClaudeDocManager.swift
//  claude-maestro
//
//  Created by Jack on 14/1/2026.
//

import Foundation

class ClaudeDocManager {

    /// Detect run command based on common project configuration files
    static func detectRunCommand(for projectPath: String) -> String? {
        let fm = FileManager.default
        let baseURL = URL(fileURLWithPath: projectPath)

        // Check for package.json (Node.js)
        let packageJson = baseURL.appendingPathComponent("package.json")
        if fm.fileExists(atPath: packageJson.path),
           let data = try? Data(contentsOf: packageJson),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let scripts = json["scripts"] as? [String: String] {
            if scripts["dev"] != nil { return "npm run dev" }
            if scripts["start"] != nil { return "npm start" }
        }

        // Check for Cargo.toml (Rust)
        if fm.fileExists(atPath: baseURL.appendingPathComponent("Cargo.toml").path) {
            return "cargo run"
        }

        // Check for Package.swift (Swift)
        if fm.fileExists(atPath: baseURL.appendingPathComponent("Package.swift").path) {
            return "swift run"
        }

        // Check for pyproject.toml (Python)
        if fm.fileExists(atPath: baseURL.appendingPathComponent("pyproject.toml").path) {
            return "python -m pytest"
        }

        // Check for requirements.txt (Python)
        if fm.fileExists(atPath: baseURL.appendingPathComponent("requirements.txt").path) {
            return "python main.py"
        }

        // Check for Makefile
        if fm.fileExists(atPath: baseURL.appendingPathComponent("Makefile").path) {
            return "make run"
        }

        // Check for go.mod (Go)
        if fm.fileExists(atPath: baseURL.appendingPathComponent("go.mod").path) {
            return "go run ."
        }

        return nil
    }

    /// Generate skills section for CLAUDE.md
    static func generateSkillsSection(enabledSkills: [SkillConfig]) -> String {
        guard !enabledSkills.isEmpty else { return "" }

        var section = """

        ## Available Skills

        The following skills are enabled for this session:

        """

        for skill in enabledSkills {
            section += "- `/\(skill.commandName)` - \(skill.description)\n"
            if let hint = skill.argumentHint {
                section += "  - Usage: `/\(skill.commandName) \(hint)`\n"
            }
        }

        section += """

        ### Skill Locations

        Skills are loaded from these paths:
        """

        for skill in enabledSkills {
            section += "\n- `\(skill.path)`"
        }

        return section
    }

    /// Generate claude.md content for a project
    static func generateContent(
        projectPath: String,
        runCommand: String?,
        branch: String?,
        sessionId: Int,
        port: Int?,
        mcpServerPath: String? = nil,
        mainRepoClaudeMD: String? = nil,
        skillsSection: String? = nil,
        customInstructions: String? = nil
    ) -> String {
        var content = """
        # Claude Code Session Context

        This file provides context for Claude Code running in this worktree.

        ## Project Information
        - **Path:** \(projectPath)
        """

        if let branch = branch {
            content += "\n- **Branch:** \(branch)"
        }

        content += "\n- **Session ID:** \(sessionId)"

        if let port = port {
            content += "\n- **Assigned Port:** \(port)"
        }

        // Add MCP Server Integration section
        if mcpServerPath != nil {
            content += """


            ## MCP Server Integration

            This session is connected to Claude Maestro's status reporting server.

            ### Status Reporting

            Report your status to Maestro using the `maestro_status` tool:
            - `maestro_status` - Report your current state to the Maestro UI
              - state: "idle" | "working" | "needs_input" | "finished" | "error"
              - message: Brief description of what you're doing
              - needsInputPrompt: (when state="needs_input") The question for the user
            """
        }

        content += "\n\n## Running the Application\n"

        if let cmd = runCommand {
            content += """

            To run this application, use:
            ```bash
            \(cmd)
            ```
            """
        } else {
            content += """

            The run command has not been configured yet. Common commands:
            - `npm run dev` - Node.js projects
            - `swift run` - Swift packages
            - `cargo run` - Rust projects
            - `python main.py` - Python projects
            - `go run .` - Go projects
            """
        }

        // Add skills section if provided
        if let skills = skillsSection, !skills.isEmpty {
            content += skills
        }

        // Add custom instructions from app config if provided
        if let instructions = customInstructions, !instructions.isEmpty {
            content += """


        ## App Instructions

        \(instructions)
        """
        }

        content += """


        ## Session Notes

        This worktree is managed by Claude Maestro. Changes made here are isolated
        from other sessions working on different branches.

        ---
        *Auto-generated by Claude Maestro*
        """

        // Append main repo CLAUDE.md content if provided
        if let mainContent = mainRepoClaudeMD, !mainContent.isEmpty {
            content += """


        ---

        ## Project Context (from main repository CLAUDE.md)

        \(mainContent)
        """
        }

        return content
    }

    /// Generate .mcp.json content for Claude Code MCP configuration (legacy single-server)
    static func generateMCPConfig(mcpServerPath: String, sessionId: Int, projectPath: String? = nil, portRangeStart: Int = 3000, portRangeEnd: Int = 3099) -> String {
        return generateMCPConfig(
            sessionId: sessionId,
            maestroServerPath: mcpServerPath,
            customServers: [],
            projectPath: projectPath,
            portRangeStart: portRangeStart,
            portRangeEnd: portRangeEnd
        )
    }

    /// Generate .mcp.json content with all enabled MCP servers
    static func generateMCPConfig(
        sessionId: Int,
        maestroServerPath: String?,
        customServers: [MCPServerConfig],
        pluginMCPServers: [String: Any] = [:],
        projectPath: String? = nil,
        portRangeStart: Int = 3000,
        portRangeEnd: Int = 3099
    ) -> String {
        var mcpServers: [String: Any] = [:]

        // Add Maestro MCP if available (native Swift binary)
        if let maestroPath = maestroServerPath {
            mcpServers["maestro"] = [
                "type": "stdio",
                "command": maestroPath,
                "args": [] as [String],
                "env": [
                    "MAESTRO_SESSION_ID": "\(sessionId)",
                    "MAESTRO_PORT_RANGE_START": "\(portRangeStart)",
                    "MAESTRO_PORT_RANGE_END": "\(portRangeEnd)"
                ]
            ] as [String: Any]
        }

        // Add custom MCP servers
        for server in customServers {
            mcpServers[server.mcpKey] = server.toMCPJSON()
        }

        // Add plugin MCP servers
        for (key, value) in pluginMCPServers {
            mcpServers[key] = value
        }

        let config: [String: Any] = ["mcpServers": mcpServers]

        if let jsonData = try? JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .sortedKeys]),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            return jsonString
        }

        return "{}"
    }

    /// Write .mcp.json to the specified directory (legacy single-server)
    static func writeMCPConfig(
        to directory: String,
        mcpServerPath: String,
        sessionId: Int
    ) {
        let content = generateMCPConfig(mcpServerPath: mcpServerPath, sessionId: sessionId)
        let filePath = URL(fileURLWithPath: directory)
            .appendingPathComponent(".mcp.json")

        do {
            try content.write(to: filePath, atomically: true, encoding: .utf8)
        } catch {
            print("Failed to generate .mcp.json: \(error)")
        }
    }

    /// Write .mcp.json with session-specific enabled servers
    @MainActor
    static func writeMCPConfigForSession(
        to directory: String,
        sessionId: Int,
        projectPath: String? = nil
    ) {
        let mcpManager = MCPServerManager.shared
        let sessionConfig = mcpManager.getMCPConfig(for: sessionId)

        // Get Maestro path if enabled for this session
        let maestroPath = sessionConfig.maestroEnabled ? mcpManager.getServerPath() : nil

        // Get enabled custom servers for this session
        let enabledServers = mcpManager.enabledServers(for: sessionId)

        // Get enabled plugins and collect their MCP server configs
        let pluginMCPServers = collectPluginMCPServers(for: sessionId)

        let content = generateMCPConfig(
            sessionId: sessionId,
            maestroServerPath: maestroPath,
            customServers: enabledServers,
            pluginMCPServers: pluginMCPServers,
            projectPath: projectPath
        )

        let filePath = URL(fileURLWithPath: directory)
            .appendingPathComponent(".mcp.json")

        do {
            try content.write(to: filePath, atomically: true, encoding: .utf8)
        } catch {
            print("Failed to generate .mcp.json: \(error)")
        }
    }

    /// Collect MCP server configurations from enabled plugins
    @MainActor
    static func collectPluginMCPServers(for sessionId: Int) -> [String: Any] {
        var pluginMCPServers: [String: Any] = [:]
        let fm = FileManager.default
        var processedPaths = Set<String>()

        // Get enabled plugins for this session from MarketplaceManager
        let enabledPlugins = MarketplaceManager.shared.enabledPlugins(for: sessionId)

        for plugin in enabledPlugins {
            // Check if plugin has a .mcp.json file
            let mcpJsonPath = "\(plugin.path)/.mcp.json"
            processedPaths.insert(plugin.path)

            guard fm.fileExists(atPath: mcpJsonPath),
                  let data = try? Data(contentsOf: URL(fileURLWithPath: mcpJsonPath)),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let servers = json["mcpServers"] as? [String: Any] else {
                continue
            }

            // Merge plugin's MCP servers (prefix with plugin name to avoid conflicts)
            for (serverName, serverConfig) in servers {
                // Use plugin-prefixed name to avoid conflicts
                let prefixedName = "\(plugin.name):\(serverName)"
                pluginMCPServers[prefixedName] = serverConfig
            }
        }

        // Also scan ~/.claude/plugins/ directory for symlinked plugins with .mcp.json
        // This catches plugins that exist as symlinks but aren't in the installedPlugins list
        // (e.g., due to UserDefaults data loss or manual installation)
        let pluginsDir = fm.homeDirectoryForCurrentUser.appendingPathComponent(".claude/plugins").path

        if let pluginDirs = try? fm.contentsOfDirectory(atPath: pluginsDir) {
            for pluginName in pluginDirs {
                // Skip non-plugin directories
                if ["cache", "repos", "marketplaces"].contains(pluginName) {
                    continue
                }
                // Skip files that aren't directories (like config.json, installed_plugins.json)
                if pluginName.hasSuffix(".json") {
                    continue
                }

                let pluginPath = "\(pluginsDir)/\(pluginName)"

                // Skip if already processed from enabledPlugins
                if processedPaths.contains(pluginPath) {
                    continue
                }

                // Resolve symlink to get the actual path
                var resolvedPath = pluginPath
                if let target = try? fm.destinationOfSymbolicLink(atPath: pluginPath) {
                    // Resolve relative symlinks to absolute paths
                    if target.hasPrefix("/") {
                        resolvedPath = target
                    } else {
                        resolvedPath = URL(fileURLWithPath: target, relativeTo: URL(fileURLWithPath: pluginPath).deletingLastPathComponent()).standardized.path
                    }
                }

                // Skip if we've already processed this resolved path
                if processedPaths.contains(resolvedPath) {
                    continue
                }
                processedPaths.insert(resolvedPath)

                // Check if this plugin has a .mcp.json file
                let mcpJsonPath = "\(resolvedPath)/.mcp.json"

                guard fm.fileExists(atPath: mcpJsonPath),
                      let data = try? Data(contentsOf: URL(fileURLWithPath: mcpJsonPath)),
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let servers = json["mcpServers"] as? [String: Any] else {
                    continue
                }

                // Merge plugin's MCP servers (prefix with plugin name to avoid conflicts)
                for (serverName, serverConfig) in servers {
                    let prefixedName = "\(pluginName):\(serverName)"
                    // Don't override if already set from enabledPlugins
                    if pluginMCPServers[prefixedName] == nil {
                        pluginMCPServers[prefixedName] = serverConfig
                    }
                }
            }
        }

        return pluginMCPServers
    }

    /// Write claude.md to the specified directory
    @MainActor
    static func writeClaudeMD(
        to directory: String,
        projectPath: String,
        runCommand: String?,
        branch: String?,
        sessionId: Int,
        port: Int?
    ) {
        let effectiveRunCommand = runCommand ?? detectRunCommand(for: directory)
        let mcpServerPath = MCPServerManager.shared.getServerPath()

        let content = generateContent(
            projectPath: projectPath,
            runCommand: effectiveRunCommand,
            branch: branch,
            sessionId: sessionId,
            port: port,
            mcpServerPath: mcpServerPath
        )

        let filePath = URL(fileURLWithPath: directory)
            .appendingPathComponent("claude.md")

        do {
            try content.write(to: filePath, atomically: true, encoding: .utf8)
        } catch {
            print("Failed to generate claude.md: \(error)")
        }

        // Initialize session MCP config if needed
        MCPServerManager.shared.initializeSessionConfig(for: sessionId)

        // Write .mcp.json with session-specific MCP server configuration
        writeMCPConfigForSession(to: directory, sessionId: sessionId, projectPath: projectPath)
    }

    // MARK: - Multi-CLI Support

    /// Action for Codex config modification
    enum CodexConfigAction {
        case add
        case remove
    }

    /// One-time setup: Configure Codex and Gemini CLI to read CLAUDE.md
    static func setupCLIContextFiles() {
        setupCodexFallbackFilenames()
        setupGeminiContextFileName()
    }

    /// Configure Codex to read CLAUDE.md as fallback context file
    private static func setupCodexFallbackFilenames() {
        let fm = FileManager.default
        let homeDir = fm.homeDirectoryForCurrentUser
        let codexDir = homeDir.appendingPathComponent(".codex")
        let configPath = codexDir.appendingPathComponent("config.toml")

        do {
            // Create .codex directory if it doesn't exist
            if !fm.fileExists(atPath: codexDir.path) {
                try fm.createDirectory(at: codexDir, withIntermediateDirectories: true)
            }

            // Read existing config or start fresh
            var content = ""
            if fm.fileExists(atPath: configPath.path) {
                content = try String(contentsOf: configPath, encoding: .utf8)
            }

            // Check if already configured
            if content.contains("project_doc_fallback_filenames") {
                return // Already configured
            }

            // Append the fallback filenames configuration
            let fallbackConfig = """

            # Claude Maestro: Enable reading CLAUDE.md context files
            project_doc_fallback_filenames = ["CLAUDE.md", "AGENTS.md"]
            """

            content += fallbackConfig
            try content.write(to: configPath, atomically: true, encoding: .utf8)
        } catch {
            print("Failed to configure Codex fallback filenames: \(error)")
        }
    }

    /// Configure Gemini CLI to read CLAUDE.md as context file
    private static func setupGeminiContextFileName() {
        let fm = FileManager.default
        let homeDir = fm.homeDirectoryForCurrentUser
        let geminiDir = homeDir.appendingPathComponent(".gemini")
        let settingsPath = geminiDir.appendingPathComponent("settings.json")

        do {
            // Create .gemini directory if it doesn't exist
            if !fm.fileExists(atPath: geminiDir.path) {
                try fm.createDirectory(at: geminiDir, withIntermediateDirectories: true)
            }

            // Read existing settings or start fresh
            var settings: [String: Any] = [:]
            if fm.fileExists(atPath: settingsPath.path),
               let data = try? Data(contentsOf: settingsPath),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                settings = json
            }

            // Check if context.fileName already configured
            if let context = settings["context"] as? [String: Any],
               context["fileName"] != nil {
                return // Already configured
            }

            // Add or merge context configuration
            var context = settings["context"] as? [String: Any] ?? [:]
            context["fileName"] = ["GEMINI.md", "CLAUDE.md", "AGENTS.md"]
            settings["context"] = context

            // Write back
            if let jsonData = try? JSONSerialization.data(withJSONObject: settings, options: [.prettyPrinted, .sortedKeys]) {
                try jsonData.write(to: settingsPath)
            }
        } catch {
            print("Failed to configure Gemini CLI context fileName: \(error)")
        }
    }

    /// Generate Gemini CLI MCP config (for .gemini/settings.json)
    static func generateGeminiMCPConfig(
        sessionId: Int,
        maestroServerPath: String?,
        customServers: [MCPServerConfig],
        pluginMCPServers: [String: Any] = [:],
        projectPath: String? = nil,
        portRangeStart: Int = 3000,
        portRangeEnd: Int = 3099
    ) -> [String: Any] {
        var mcpServers: [String: Any] = [:]

        // Add Maestro MCP if available (native Swift binary)
        if let maestroPath = maestroServerPath {
            mcpServers["maestro"] = [
                "command": maestroPath,
                "args": [] as [String],
                "env": [
                    "MAESTRO_SESSION_ID": "\(sessionId)",
                    "MAESTRO_PORT_RANGE_START": "\(portRangeStart)",
                    "MAESTRO_PORT_RANGE_END": "\(portRangeEnd)"
                ]
            ] as [String: Any]
        }

        // Add custom MCP servers
        for server in customServers {
            var config: [String: Any] = [
                "command": server.command,
                "args": server.args
            ]
            if !server.env.isEmpty {
                config["env"] = server.env
            }
            mcpServers[server.mcpKey] = config
        }

        // Add plugin MCP servers
        for (key, value) in pluginMCPServers {
            mcpServers[key] = value
        }

        return ["mcpServers": mcpServers]
    }

    /// Write Gemini CLI MCP config to .gemini/settings.json in project directory
    @MainActor
    static func writeGeminiMCPConfig(to directory: String, sessionId: Int, projectPath: String? = nil) {
        let fm = FileManager.default
        let geminiDir = URL(fileURLWithPath: directory).appendingPathComponent(".gemini")
        let settingsPath = geminiDir.appendingPathComponent("settings.json")

        let mcpManager = MCPServerManager.shared
        let sessionConfig = mcpManager.getMCPConfig(for: sessionId)

        // Get Maestro path if enabled
        let maestroPath = sessionConfig.maestroEnabled ? mcpManager.getServerPath() : nil
        let enabledServers = mcpManager.enabledServers(for: sessionId)

        // Get enabled plugins and collect their MCP server configs
        let pluginMCPServers = collectPluginMCPServers(for: sessionId)

        do {
            // Create .gemini directory if needed
            if !fm.fileExists(atPath: geminiDir.path) {
                try fm.createDirectory(at: geminiDir, withIntermediateDirectories: true)
            }

            // Read existing settings or start fresh
            var settings: [String: Any] = [:]
            if fm.fileExists(atPath: settingsPath.path),
               let data = try? Data(contentsOf: settingsPath),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                settings = json
            }

            // Generate and merge MCP config
            let mcpConfig = generateGeminiMCPConfig(
                sessionId: sessionId,
                maestroServerPath: maestroPath,
                customServers: enabledServers,
                pluginMCPServers: pluginMCPServers,
                projectPath: projectPath
            )

            // Merge mcpServers into existing settings
            settings["mcpServers"] = mcpConfig["mcpServers"]

            // Write back
            if let jsonData = try? JSONSerialization.data(withJSONObject: settings, options: [.prettyPrinted, .sortedKeys]) {
                try jsonData.write(to: settingsPath)
            }
        } catch {
            print("Failed to write Gemini MCP config: \(error)")
        }
    }

    /// Update Codex global config with session MCP server
    @MainActor
    static func updateCodexMCPConfig(
        sessionId: Int,
        action: CodexConfigAction,
        maestroServerPath: String?,
        customServers: [MCPServerConfig],
        projectPath: String? = nil,
        portRangeStart: Int = 3000,
        portRangeEnd: Int = 3099
    ) {
        let fm = FileManager.default
        let homeDir = fm.homeDirectoryForCurrentUser
        let codexDir = homeDir.appendingPathComponent(".codex")
        let configPath = codexDir.appendingPathComponent("config.toml")

        do {
            // Create .codex directory if it doesn't exist
            if !fm.fileExists(atPath: codexDir.path) {
                try fm.createDirectory(at: codexDir, withIntermediateDirectories: true)
            }

            // Read existing config
            var content = ""
            if fm.fileExists(atPath: configPath.path) {
                content = try String(contentsOf: configPath, encoding: .utf8)
            }

            // Session-specific server key
            let sessionKey = "maestro_session_\(sessionId)"

            switch action {
            case .add:
                // Remove existing entry for this session if present
                content = removeCodexMCPSection(from: content, sessionKey: sessionKey)

                // Add Maestro MCP if available (native Swift binary)
                if let maestroPath = maestroServerPath {
                    let serverConfig = """

                    # Claude Maestro Session \(sessionId)
                    [mcp_servers.\(sessionKey)]
                    command = "\(maestroPath)"
                    args = []

                    [mcp_servers.\(sessionKey).env]
                    MAESTRO_SESSION_ID = "\(sessionId)"
                    MAESTRO_PORT_RANGE_START = "\(portRangeStart)"
                    MAESTRO_PORT_RANGE_END = "\(portRangeEnd)"
                    """
                    content += serverConfig
                }

                // Add custom servers
                for (index, server) in customServers.enumerated() {
                    let customKey = "\(sessionKey)_custom_\(index)"
                    var serverConfig = """

                    # Claude Maestro Session \(sessionId) - \(server.name)
                    [mcp_servers.\(customKey)]
                    command = "\(server.command)"
                    args = [\(server.args.map { "\"\($0)\"" }.joined(separator: ", "))]
                    """

                    if !server.env.isEmpty {
                        serverConfig += "\n\n[mcp_servers.\(customKey).env]"
                        for (key, value) in server.env {
                            serverConfig += "\n\(key) = \"\(value)\""
                        }
                    }
                    content += serverConfig
                }

            case .remove:
                // Remove the session entry and any custom servers for this session
                content = removeCodexMCPSection(from: content, sessionKey: sessionKey)
                // Also remove any custom server entries for this session
                var index = 0
                while true {
                    let customKey = "\(sessionKey)_custom_\(index)"
                    let newContent = removeCodexMCPSection(from: content, sessionKey: customKey)
                    if newContent == content {
                        break // No more custom entries
                    }
                    content = newContent
                    index += 1
                }
            }

            try content.write(to: configPath, atomically: true, encoding: .utf8)
        } catch {
            print("Failed to update Codex MCP config: \(error)")
        }
    }

    /// Remove a session's MCP section from Codex config
    /// Handles both main section [mcp_servers.maestro_session_N] and subsections like [mcp_servers.maestro_session_N.env]
    private static func removeCodexMCPSection(from content: String, sessionKey: String) -> String {
        var lines = content.components(separatedBy: "\n")
        var result: [String] = []
        var skipUntilNextSection = false

        // Exact prefix for main section and subsection prefix
        let sectionExact = "[mcp_servers.\(sessionKey)]"
        let subsectionPrefix = "[mcp_servers.\(sessionKey)."

        // Extract session number for EXACT comment matching
        // Handle keys like "maestro_session_3", "maestro_session_3_status", "maestro_session_3_custom_0"
        let sessionNumber = sessionKey
            .replacingOccurrences(of: "maestro_session_", with: "")
            .components(separatedBy: "_")
            .first ?? ""

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            // Check if this is the exact main section or any subsection for our session
            if trimmed == sectionExact || trimmed.hasPrefix(subsectionPrefix) {
                skipUntilNextSection = true
                continue
            }

            // Skip comment lines for this EXACT session using regex for word boundary
            if trimmed.hasPrefix("#") && trimmed.contains("Maestro Session") {
                // Extract the session number from comment and compare exactly
                if let match = trimmed.range(of: "Session (\\d+)", options: .regularExpression) {
                    let matchedText = String(trimmed[match])
                    let commentSessionNum = matchedText.replacingOccurrences(of: "Session ", with: "")
                    if commentSessionNum == sessionNumber {
                        continue
                    }
                }
            }

            // Check if we've reached a different section (one that doesn't belong to our session)
            if skipUntilNextSection && trimmed.hasPrefix("[") {
                // New section that isn't ours - stop skipping
                skipUntilNextSection = false
            }

            // Skip key=value lines and empty lines while in skip mode
            if skipUntilNextSection && (trimmed.contains("=") || trimmed.isEmpty) {
                continue
            }

            if !skipUntilNextSection {
                result.append(line)
            }
        }

        return result.joined(separator: "\n")
    }

    /// Clean up orphaned or malformed MCP sections from Codex config
    /// Call this at app startup to fix historical corruption
    static func cleanupOrphanedCodexSections() {
        let fm = FileManager.default
        let homeDir = fm.homeDirectoryForCurrentUser
        let configPath = homeDir.appendingPathComponent(".codex/config.toml")

        guard fm.fileExists(atPath: configPath.path),
              var content = try? String(contentsOf: configPath, encoding: .utf8) else {
            return
        }

        let lines = content.components(separatedBy: "\n")
        var mainSections = Set<String>()  // Sections with [mcp_servers.X] (have command/args)
        var envSections = Set<String>()   // Sections with [mcp_servers.X.env]

        // First pass: identify all main sections and env subsections
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            // Match main section: [mcp_servers.maestro_session_N]
            if let match = trimmed.range(of: "^\\[mcp_servers\\.(maestro_session_[^.\\]]+)\\]$", options: .regularExpression) {
                let sectionName = String(trimmed[match])
                    .replacingOccurrences(of: "[mcp_servers.", with: "")
                    .replacingOccurrences(of: "]", with: "")
                mainSections.insert(sectionName)
            }

            // Match env subsection: [mcp_servers.maestro_session_N.env]
            if let match = trimmed.range(of: "^\\[mcp_servers\\.(maestro_session_[^.]+)\\.env\\]$", options: .regularExpression) {
                let fullMatch = String(trimmed[match])
                let parentName = fullMatch
                    .replacingOccurrences(of: "[mcp_servers.", with: "")
                    .replacingOccurrences(of: ".env]", with: "")
                envSections.insert(parentName)
            }
        }

        // Find orphans: env sections without corresponding main sections
        let orphans = envSections.subtracting(mainSections)

        if orphans.isEmpty {
            return
        }

        // Remove orphan sections
        for orphan in orphans {
            content = removeCodexMCPSection(from: content, sessionKey: orphan)
        }

        // Clean up multiple consecutive blank lines
        var cleanedLines: [String] = []
        var lastWasBlank = false
        for line in content.components(separatedBy: "\n") {
            let isBlank = line.trimmingCharacters(in: .whitespaces).isEmpty
            if isBlank && lastWasBlank {
                continue
            }
            cleanedLines.append(line)
            lastWasBlank = isBlank
        }
        content = cleanedLines.joined(separator: "\n")

        // Write back
        try? content.write(to: configPath, atomically: true, encoding: .utf8)
        print("ClaudeDocManager: Cleaned up \(orphans.count) orphaned Codex MCP sections")
    }

    /// Write all session configs based on terminal mode
    @MainActor
    static func writeSessionConfigs(
        to directory: String,
        projectPath: String,
        runCommand: String?,
        branch: String?,
        sessionId: Int,
        port: Int?,
        mode: TerminalMode
    ) {
        // Always write CLAUDE.md - all CLIs can be configured to read it
        let effectiveRunCommand = runCommand ?? detectRunCommand(for: directory)
        let mcpServerPath = MCPServerManager.shared.getServerPath()

        // Read main repo CLAUDE.md if it exists (for worktrees, include the main project's context)
        var mainRepoClaudeMD: String? = nil
        if directory != projectPath {
            // This is a worktree - include main repo's CLAUDE.md content
            let mainClaudeMDPath = URL(fileURLWithPath: projectPath)
                .appendingPathComponent("CLAUDE.md").path
            mainRepoClaudeMD = try? String(contentsOfFile: mainClaudeMDPath, encoding: .utf8)
        }

        // Initialize skill manager session config and generate skills section
        SkillManager.shared.initializeSessionConfig(for: sessionId)
        SkillManager.shared.scanProjectSkills(projectPath: projectPath)
        let enabledSkills = SkillManager.shared.enabledSkills(for: sessionId)
        let skillsSection = generateSkillsSection(enabledSkills: enabledSkills)

        // Sync skills to worktree's .claude/skills/ directory (per-session skill control)
        SkillManager.shared.syncWorktreeSkills(worktreePath: directory, for: sessionId)

        // Initialize command manager session config and sync commands
        CommandManager.shared.initializeSessionConfig(for: sessionId)
        CommandManager.shared.scanProjectCommands(projectPath: projectPath)
        CommandManager.shared.syncWorktreeCommands(worktreePath: directory, for: sessionId)

        // Sync hooks from enabled plugins to worktree's .claude/settings.local.json
        HookManager.shared.scanForHooks()
        HookManager.shared.syncWorktreeHooks(worktreePath: directory, for: sessionId)

        let content = generateContent(
            projectPath: projectPath,
            runCommand: effectiveRunCommand,
            branch: branch,
            sessionId: sessionId,
            port: port,
            mcpServerPath: mcpServerPath,
            mainRepoClaudeMD: mainRepoClaudeMD,
            skillsSection: skillsSection,
            customInstructions: nil
        )

        let filePath = URL(fileURLWithPath: directory).appendingPathComponent("CLAUDE.md")

        do {
            try content.write(to: filePath, atomically: true, encoding: .utf8)
        } catch {
            print("Failed to generate CLAUDE.md: \(error)")
        }

        // Initialize session MCP config
        MCPServerManager.shared.initializeSessionConfig(for: sessionId)

        // Write CLI-specific MCP configuration
        switch mode {
        case .claudeCode:
            writeMCPConfigForSession(to: directory, sessionId: sessionId, projectPath: projectPath)

        case .geminiCli:
            writeGeminiMCPConfig(to: directory, sessionId: sessionId, projectPath: projectPath)

        case .openAiCodex:
            let mcpManager = MCPServerManager.shared
            let sessionConfig = mcpManager.getMCPConfig(for: sessionId)
            let maestroPath = sessionConfig.maestroEnabled ? mcpManager.getServerPath() : nil
            let enabledServers = mcpManager.enabledServers(for: sessionId)

            updateCodexMCPConfig(
                sessionId: sessionId,
                action: .add,
                maestroServerPath: maestroPath,
                customServers: enabledServers,
                projectPath: projectPath
            )

        case .plainTerminal:
            break // No MCP config needed
        }
    }

    /// Clean up Codex MCP config when session closes
    @MainActor
    static func cleanupCodexMCPConfig(sessionId: Int) {
        updateCodexMCPConfig(
            sessionId: sessionId,
            action: .remove,
            maestroServerPath: nil,
            customServers: []
        )
    }
}
