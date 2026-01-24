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
    @State private var showBrowser: Bool = false
    @State private var showPluginDetail: InstalledPlugin? = nil
    @State private var showDeleteConfirmation: Bool = false
    @State private var pluginToDelete: InstalledPlugin? = nil

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
                } else if skillManager.installedSkills.isEmpty && marketplaceManager.installedPlugins.isEmpty {
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
                                onToggle: { enabled in
                                    var updated = plugin
                                    updated.isEnabled = enabled
                                    // Update in manager (would need update method)
                                },
                                onTap: { showPluginDetail = plugin },
                                onDelete: {
                                    pluginToDelete = plugin
                                    showDeleteConfirmation = true
                                }
                            )
                        }

                        // Discovered skills (not from plugins)
                        ForEach(skillManager.installedSkills) { skill in
                            SkillRow(
                                skill: skill,
                                onToggle: { enabled in
                                    var updated = skill
                                    updated.isEnabled = enabled
                                    skillManager.updateSkill(updated)
                                }
                            )
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
    let onToggle: (Bool) -> Void
    let onTap: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            // Enable toggle
            Toggle("", isOn: Binding(
                get: { plugin.isEnabled },
                set: { onToggle($0) }
            ))
            .toggleStyle(.switch)
            .controlSize(.mini)

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
                .fill(plugin.isEnabled ? Color.purple.opacity(0.1) : Color.clear)
        )
        .contentShape(Rectangle())
        .onTapGesture { onTap() }
    }
}

// MARK: - Skill Row

struct SkillRow: View {
    let skill: SkillConfig
    let onToggle: (Bool) -> Void

    var body: some View {
        HStack(spacing: 8) {
            // Enable toggle
            Toggle("", isOn: Binding(
                get: { skill.isEnabled },
                set: { onToggle($0) }
            ))
            .toggleStyle(.switch)
            .controlSize(.mini)

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
                .fill(skill.isEnabled ? Color.orange.opacity(0.1) : Color.clear)
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

                if !plugin.skills.isEmpty {
                    DetailRow(label: "Skills", value: plugin.skills.joined(separator: ", "))
                }

                if !plugin.mcpServers.isEmpty {
                    DetailRow(label: "MCP Servers", value: plugin.mcpServers.joined(separator: ", "))
                }
            }

            Spacer()
        }
        .padding()
        .frame(width: 400, height: 350)
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
