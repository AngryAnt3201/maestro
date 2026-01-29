//
//  MarketplaceSection.swift
//  claude-maestro
//
//  Sidebar section for managing plugins and skills
//

import SwiftUI

struct MarketplaceSection: View {
    @StateObject private var marketplaceManager = MarketplaceManager.shared
    @StateObject private var skillManager = SkillManager.shared
    @StateObject private var commandManager = CommandManager.shared
    @State private var showBrowser: Bool = false
    @State private var showPluginDetail: InstalledPlugin? = nil
    @State private var showDeleteConfirmation: Bool = false
    @State private var pluginToDelete: InstalledPlugin? = nil

    /// Filter out skills that belong to installed plugins (to avoid duplication)
    private var standaloneSkills: [SkillConfig] {
        skillManager.installedSkills.filter { $0.source.pluginName == nil }
    }

    /// Filter out commands that belong to installed plugins (to avoid duplication)
    private var standaloneCommands: [CommandConfig] {
        commandManager.installedCommands.filter { $0.source.pluginName == nil }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header
            HStack {
                Text("Plugins & Skills")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                Spacer()

                // Refresh button
                Button {
                    skillManager.scanForSkills()
                    Task {
                        await marketplaceManager.refreshMarketplaces()
                    }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
                .help("Refresh plugins and skills")

                // Browse marketplace button
                Button {
                    showBrowser = true
                } label: {
                    Image(systemName: "plus.circle")
                        .foregroundColor(.accentColor)
                }
                .buttonStyle(.plain)
                .help("Browse marketplace")
            }

            // Skills list
            VStack(spacing: 0) {
                if skillManager.isScanning || marketplaceManager.isLoading {
                    HStack {
                        ProgressView()
                            .scaleEffect(0.7)
                        Text("Loading...")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                } else if standaloneSkills.isEmpty && standaloneCommands.isEmpty && marketplaceManager.installedPlugins.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Image(systemName: "sparkles")
                                .foregroundColor(.secondary)
                                .font(.caption)
                            Text("No skills installed")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        Text("Browse marketplace to install plugins")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                } else {
                    VStack(spacing: 4) {
                        // Installed plugins
                        ForEach(marketplaceManager.installedPlugins) { plugin in
                            InstalledPluginRow(
                                plugin: plugin,
                                onTap: { showPluginDetail = plugin },
                                onDelete: {
                                    pluginToDelete = plugin
                                    showDeleteConfirmation = true
                                }
                            )
                        }

                        // Discovered skills (not from plugins)
                        ForEach(standaloneSkills) { skill in
                            SkillRow(skill: skill)
                        }

                        // Discovered commands (not from plugins)
                        ForEach(standaloneCommands) { command in
                            CommandRow(command: command)
                        }
                    }
                    .padding(8)
                }
            }
            .background(Color(NSColor.windowBackgroundColor))
            .cornerRadius(8)
        }
        .padding(.horizontal, 8)
        .sheet(isPresented: $showBrowser) {
            MarketplaceBrowserView()
        }
        .sheet(item: $showPluginDetail) { plugin in
            PluginDetailSheet(plugin: plugin)
        }
        .alert("Delete Plugin?", isPresented: $showDeleteConfirmation) {
            Button("Cancel", role: .cancel) {
                pluginToDelete = nil
            }
            Button("Delete", role: .destructive) {
                if let plugin = pluginToDelete {
                    Task {
                        try? await marketplaceManager.uninstallPlugin(id: plugin.id)
                    }
                }
                pluginToDelete = nil
            }
        } message: {
            if let plugin = pluginToDelete {
                Text("Are you sure you want to delete \"\(plugin.name)\"? This cannot be undone.")
            }
        }
    }
}

// MARK: - Installed Plugin Row

struct InstalledPluginRow: View {
    let plugin: InstalledPlugin
    let onTap: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            // Plugin type icon
            Image(systemName: "puzzlepiece.extension")
                .foregroundColor(.purple)
                .font(.caption)
                .frame(width: 16)

            // Plugin info
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text(plugin.name)
                        .font(.caption)
                        .fontWeight(.medium)
                        .lineLimit(1)

                    // Source badge
                    Text(plugin.source.displayName)
                        .font(.system(size: 9))
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(Color.secondary.opacity(0.1))
                        .cornerRadius(3)
                }

                if !plugin.description.isEmpty {
                    Text(plugin.description)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer()

            // Delete button
            Button { onDelete() } label: {
                Image(systemName: "trash")
                    .font(.caption2)
                    .foregroundColor(.red.opacity(0.7))
            }
            .buttonStyle(.plain)
            .help("Uninstall plugin")
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 4)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.purple.opacity(0.05))
        )
        .contentShape(Rectangle())
        .onTapGesture { onTap() }
    }
}

// MARK: - Skill Row

struct SkillRow: View {
    let skill: SkillConfig

    var body: some View {
        HStack(spacing: 8) {
            // Skill type icon
            Image(systemName: skill.source.icon)
                .foregroundColor(.orange)
                .font(.caption)
                .frame(width: 16)

            // Skill info
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text("/\(skill.commandName)")
                        .font(.caption)
                        .fontWeight(.medium)
                        .lineLimit(1)

                    // Source badge
                    Text(skill.source.displayName)
                        .font(.system(size: 9))
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(Color.secondary.opacity(0.1))
                        .cornerRadius(3)
                }

                if !skill.description.isEmpty {
                    Text(skill.description)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer()
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 4)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.orange.opacity(0.05))
        )
    }
}

// MARK: - Command Row

struct CommandRow: View {
    let command: CommandConfig

    var body: some View {
        HStack(spacing: 8) {
            // Command type icon
            Image(systemName: command.source.icon)
                .foregroundColor(.blue)
                .font(.caption)
                .frame(width: 16)

            // Command info
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text("/\(command.commandName)")
                        .font(.caption)
                        .fontWeight(.medium)
                        .lineLimit(1)

                    // Source badge
                    Text(command.source.displayName)
                        .font(.system(size: 9))
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(Color.secondary.opacity(0.1))
                        .cornerRadius(3)
                }

                if !command.description.isEmpty {
                    Text(command.description)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer()
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 4)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.blue.opacity(0.05))
        )
    }
}

// MARK: - Plugin Detail Sheet

struct PluginDetailSheet: View {
    let plugin: InstalledPlugin
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Header
            HStack {
                Image(systemName: "puzzlepiece.extension")
                    .font(.title)
                    .foregroundColor(.purple)

                VStack(alignment: .leading) {
                    Text(plugin.name)
                        .font(.headline)
                    Text("v\(plugin.version)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()

                Button { dismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
            }

            Divider()

            // Description
            Text(plugin.description)
                .font(.body)

            // Details
            VStack(alignment: .leading, spacing: 8) {
                DetailRow(label: "Source", value: plugin.source.displayName)
                DetailRow(label: "Scope", value: plugin.installScope.rawValue)
                DetailRow(label: "Installed", value: plugin.installedAt.formatted())
                DetailRow(label: "Location", value: plugin.path)
            }

            // Capabilities section
            if !plugin.skills.isEmpty || !plugin.commands.isEmpty || !plugin.mcpServers.isEmpty {
                Divider()

                VStack(alignment: .leading, spacing: 8) {
                    Text("Capabilities")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(.secondary)

                    // Skills
                    if !plugin.skills.isEmpty {
                        CapabilityRow(
                            icon: "sparkles",
                            iconColor: .orange,
                            label: "Skills",
                            items: plugin.skills
                        )
                    }

                    // Commands
                    if !plugin.commands.isEmpty {
                        CapabilityRow(
                            icon: "terminal",
                            iconColor: .blue,
                            label: "Commands",
                            items: plugin.commands
                        )
                    }

                    // MCP Servers
                    if !plugin.mcpServers.isEmpty {
                        CapabilityRow(
                            icon: "server.rack",
                            iconColor: .green,
                            label: "MCP Servers",
                            items: plugin.mcpServers
                        )
                    }
                }
            }

            Spacer()
        }
        .padding()
        .frame(width: 400, height: 400)
    }
}

// MARK: - Capability Row

struct CapabilityRow: View {
    let icon: String
    let iconColor: Color
    let label: String
    let items: [String]

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon)
                .foregroundColor(iconColor)
                .font(.caption)
                .frame(width: 16)

            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.caption)
                    .fontWeight(.medium)
                Text(items.joined(separator: ", "))
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
            }
        }
    }
}

struct DetailRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .top) {
            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
                .frame(width: 80, alignment: .leading)
            Text(value)
                .font(.caption)
                .lineLimit(2)
                .truncationMode(.middle)
        }
    }
}

#Preview {
    MarketplaceSection()
        .frame(width: 250)
        .padding()
}
