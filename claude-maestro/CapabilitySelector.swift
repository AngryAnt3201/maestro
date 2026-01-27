//
//  CapabilitySelector.swift
//  claude-maestro
//
//  Combined skills and commands selector with popover UI
//

import SwiftUI

struct CapabilitySelector: View {
    let sessionId: Int
    @ObservedObject var skillManager: SkillManager
    @ObservedObject var commandManager: CommandManager
    var isDisabled: Bool = false

    @State private var showPopover = false
    @State private var searchText = ""

    private var sessionSkillConfig: SessionSkillConfig {
        skillManager.getSkillConfig(for: sessionId)
    }

    private var sessionCommandConfig: SessionCommandConfig {
        commandManager.getCommandConfig(for: sessionId)
    }

    /// Count of enabled skills for this session
    private var enabledSkillCount: Int {
        skillManager.installedSkills.filter { skill in
            sessionSkillConfig.isSkillEnabled(skill.id)
        }.count
    }

    /// Count of enabled commands for this session
    private var enabledCommandCount: Int {
        commandManager.installedCommands.filter { command in
            sessionCommandConfig.isCommandEnabled(command.id)
        }.count
    }

    /// Total enabled count
    private var totalEnabledCount: Int {
        enabledSkillCount + enabledCommandCount
    }

    /// Filtered skills based on search
    private var filteredSkills: [SkillConfig] {
        if searchText.isEmpty {
            return skillManager.installedSkills
        }
        let lowercased = searchText.lowercased()
        return skillManager.installedSkills.filter {
            $0.name.lowercased().contains(lowercased) ||
            $0.description.lowercased().contains(lowercased) ||
            $0.commandName.lowercased().contains(lowercased)
        }
    }

    /// Filtered commands based on search
    private var filteredCommands: [CommandConfig] {
        if searchText.isEmpty {
            return commandManager.installedCommands
        }
        let lowercased = searchText.lowercased()
        return commandManager.installedCommands.filter {
            $0.name.lowercased().contains(lowercased) ||
            $0.description.lowercased().contains(lowercased) ||
            $0.commandName.lowercased().contains(lowercased)
        }
    }

    /// Commands grouped by plugin for bundling
    /// Returns array of (pluginName, commands) tuples
    /// Plugins with 2+ commands are bundled; single-command plugins shown individually
    private var commandsByPlugin: [(pluginName: String?, commands: [CommandConfig])] {
        // Group commands by plugin name
        var grouped: [String?: [CommandConfig]] = [:]
        for command in filteredCommands {
            let pluginName = command.source.pluginName
            grouped[pluginName, default: []].append(command)
        }

        // Build result: bundle plugins with 2+ commands, show single commands individually
        var result: [(pluginName: String?, commands: [CommandConfig])] = []

        // First add bundles (plugins with 2+ commands)
        for (pluginName, commands) in grouped.sorted(by: { ($0.key ?? "") < ($1.key ?? "") }) {
            if pluginName != nil && commands.count >= 2 {
                result.append((pluginName: pluginName, commands: commands))
            }
        }

        // Then add individual commands (single-command plugins or non-plugin commands)
        for (pluginName, commands) in grouped.sorted(by: { ($0.key ?? "") < ($1.key ?? "") }) {
            if pluginName == nil || commands.count < 2 {
                for command in commands {
                    result.append((pluginName: nil, commands: [command]))
                }
            }
        }

        return result
    }

    /// List of enabled skill names for tooltip
    private var enabledSkillNames: [String] {
        skillManager.installedSkills
            .filter { sessionSkillConfig.isSkillEnabled($0.id) }
            .map { "/\($0.commandName)" }
    }

    /// List of enabled command names for tooltip
    private var enabledCommandNames: [String] {
        commandManager.installedCommands
            .filter { sessionCommandConfig.isCommandEnabled($0.id) }
            .map { "/\($0.commandName)" }
    }

    var body: some View {
        Group {
            if isDisabled {
                // Post-launch: Read-only badge
                readOnlyBadge
            } else {
                // Pre-launch: Interactive popover
                interactiveButton
            }
        }
        .onAppear {
            // Initialize session configs with defaults if needed
            skillManager.initializeSessionConfig(for: sessionId)
            commandManager.initializeSessionConfig(for: sessionId)
        }
    }

    // MARK: - Read-Only Badge (Post-Launch)

    private var readOnlyBadge: some View {
        HStack(spacing: 4) {
            Image(systemName: "sparkles")
            Text("\(totalEnabledCount) Active")
        }
        .font(.caption2)
        .foregroundColor(.orange)
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(Color.orange.opacity(0.15))
        .cornerRadius(6)
        .help(tooltipText)
    }

    private var tooltipText: String {
        let all = enabledSkillNames + enabledCommandNames
        if all.isEmpty {
            return "No skills or commands enabled"
        }
        return all.joined(separator: ", ")
    }

    // MARK: - Interactive Button with Popover (Pre-Launch)

    private var interactiveButton: some View {
        Button {
            showPopover.toggle()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "sparkles")
                Text("\(totalEnabledCount)")
                Image(systemName: "chevron.down")
                    .font(.caption2)
            }
            .font(.caption)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.orange.opacity(0.15))
            .cornerRadius(6)
        }
        .buttonStyle(.plain)
        .popover(isPresented: $showPopover, arrowEdge: .bottom) {
            popoverContent
        }
    }

    // MARK: - Popover Content

    private var popoverContent: some View {
        VStack(spacing: 0) {
            // Search bar
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.secondary)
                TextField("Search skills & commands...", text: $searchText)
                    .textFieldStyle(.plain)
                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(8)
            .background(Color(NSColor.controlBackgroundColor))

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    // Skills section
                    if !filteredSkills.isEmpty {
                        SectionHeader(title: "Skills", count: enabledSkillCount, total: filteredSkills.count)
                        ForEach(filteredSkills) { skill in
                            SkillToggleRow(
                                skill: skill,
                                isEnabled: sessionSkillConfig.isSkillEnabled(skill.id),
                                onToggle: { enabled in
                                    skillManager.setSkillEnabled(skill.id, enabled: enabled, for: sessionId)
                                }
                            )
                        }
                    }

                    // Commands section
                    if !filteredCommands.isEmpty {
                        if !filteredSkills.isEmpty {
                            Divider()
                                .padding(.vertical, 4)
                        }
                        SectionHeader(title: "Commands", count: enabledCommandCount, total: filteredCommands.count)
                        ForEach(Array(commandsByPlugin.enumerated()), id: \.offset) { _, item in
                            if let pluginName = item.pluginName, item.commands.count >= 2 {
                                // Render as bundle
                                PluginCommandBundleRow(
                                    pluginName: pluginName,
                                    commands: item.commands,
                                    enabledIds: sessionCommandConfig.enabledCommandIds,
                                    onToggleAll: { enabled in
                                        for command in item.commands {
                                            commandManager.setCommandEnabled(command.id, enabled: enabled, for: sessionId)
                                        }
                                    },
                                    onToggleCommand: { command, enabled in
                                        commandManager.setCommandEnabled(command.id, enabled: enabled, for: sessionId)
                                    }
                                )
                            } else if let command = item.commands.first {
                                // Render as individual command
                                CommandToggleRow(
                                    command: command,
                                    isEnabled: sessionCommandConfig.isCommandEnabled(command.id),
                                    onToggle: { enabled in
                                        commandManager.setCommandEnabled(command.id, enabled: enabled, for: sessionId)
                                    }
                                )
                            }
                        }
                    }

                    // Empty state
                    if filteredSkills.isEmpty && filteredCommands.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "sparkles")
                                .font(.title2)
                                .foregroundColor(.secondary)
                            Text(searchText.isEmpty ? "No skills or commands installed" : "No matches found")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 20)
                    }
                }
                .padding(8)
            }
            .frame(maxHeight: 350)

            Divider()

            // Footer with rescan button
            HStack {
                Button {
                    skillManager.scanForSkills()
                    commandManager.scanForCommands()
                } label: {
                    Label("Rescan", systemImage: "arrow.clockwise")
                        .font(.caption)
                }
                .buttonStyle(.plain)
                .foregroundColor(.accentColor)

                Spacer()

                Text("\(skillManager.installedSkills.count) skills, \(commandManager.installedCommands.count) commands")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            .padding(8)
        }
        .frame(width: 300)
    }
}

// MARK: - Section Header

private struct SectionHeader: View {
    let title: String
    let count: Int
    let total: Int

    var body: some View {
        HStack {
            Text(title)
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundColor(.secondary)
            Spacer()
            Text("\(count)/\(total)")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .padding(.horizontal, 4)
    }
}

// MARK: - Skill Toggle Row

private struct SkillToggleRow: View {
    let skill: SkillConfig
    let isEnabled: Bool
    let onToggle: (Bool) -> Void

    var body: some View {
        Button {
            onToggle(!isEnabled)
        } label: {
            HStack(spacing: 8) {
                // Checkbox
                Image(systemName: isEnabled ? "checkmark.circle.fill" : "circle")
                    .foregroundColor(isEnabled ? .orange : .secondary)

                // Icon
                Image(systemName: skill.source.icon)
                    .foregroundColor(.orange)
                    .font(.caption)
                    .frame(width: 16)

                // Info
                VStack(alignment: .leading, spacing: 1) {
                    Text("/\(skill.commandName)")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.primary)
                    if !skill.description.isEmpty {
                        Text(skill.description)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer()

                // Source badge
                Text(skill.source.displayName)
                    .font(.system(size: 9))
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                    .background(Color.secondary.opacity(0.1))
                    .cornerRadius(3)
            }
            .padding(.vertical, 4)
            .padding(.horizontal, 4)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .fill(isEnabled ? Color.orange.opacity(0.05) : Color.clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Command Toggle Row

private struct CommandToggleRow: View {
    let command: CommandConfig
    let isEnabled: Bool
    let onToggle: (Bool) -> Void
    var indented: Bool = false

    var body: some View {
        Button {
            onToggle(!isEnabled)
        } label: {
            HStack(spacing: 8) {
                // Checkbox
                Image(systemName: isEnabled ? "checkmark.circle.fill" : "circle")
                    .foregroundColor(isEnabled ? .blue : .secondary)

                // Icon
                Image(systemName: command.source.icon)
                    .foregroundColor(.blue)
                    .font(.caption)
                    .frame(width: 16)

                // Info
                VStack(alignment: .leading, spacing: 1) {
                    Text("/\(command.commandName)")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.primary)
                    if !command.description.isEmpty {
                        Text(command.description)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer()

                // Source badge (hide when indented in bundle)
                if !indented {
                    Text(command.source.displayName)
                        .font(.system(size: 9))
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(Color.secondary.opacity(0.1))
                        .cornerRadius(3)
                }
            }
            .padding(.vertical, 4)
            .padding(.horizontal, 4)
            .padding(.leading, indented ? 20 : 0)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .fill(isEnabled ? Color.blue.opacity(0.05) : Color.clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Plugin Command Bundle Row

private struct PluginCommandBundleRow: View {
    let pluginName: String
    let commands: [CommandConfig]
    let enabledIds: Set<UUID>
    let onToggleAll: (Bool) -> Void
    let onToggleCommand: (CommandConfig, Bool) -> Void

    @State private var isExpanded = false

    private var enabledCount: Int {
        commands.filter { enabledIds.contains($0.id) }.count
    }

    private var checkboxState: CheckboxState {
        if enabledCount == 0 {
            return .none
        } else if enabledCount == commands.count {
            return .all
        } else {
            return .partial
        }
    }

    private enum CheckboxState {
        case none, partial, all

        var icon: String {
            switch self {
            case .none: return "circle"
            case .partial: return "minus.circle.fill"
            case .all: return "checkmark.circle.fill"
            }
        }

        var color: Color {
            switch self {
            case .none: return .secondary
            case .partial, .all: return .blue
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Bundle header row
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 8) {
                    // Expand/collapse chevron
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .frame(width: 10)

                    // Bundle checkbox (clickable separately)
                    Button {
                        let shouldEnable = checkboxState != .all
                        onToggleAll(shouldEnable)
                    } label: {
                        Image(systemName: checkboxState.icon)
                            .foregroundColor(checkboxState.color)
                    }
                    .buttonStyle(.plain)

                    // Plugin icon
                    Image(systemName: "puzzlepiece.extension")
                        .foregroundColor(.blue)
                        .font(.caption)
                        .frame(width: 16)

                    // Plugin name
                    Text(pluginName)
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.primary)

                    Spacer()

                    // Command count badge
                    Text("\(enabledCount)/\(commands.count)")
                        .font(.system(size: 9))
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(Color.secondary.opacity(0.1))
                        .cornerRadius(3)
                }
                .padding(.vertical, 4)
                .padding(.horizontal, 4)
                .background(
                    RoundedRectangle(cornerRadius: 4)
                        .fill(enabledCount > 0 ? Color.blue.opacity(0.05) : Color.clear)
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            // Expanded commands
            if isExpanded {
                ForEach(commands) { command in
                    CommandToggleRow(
                        command: command,
                        isEnabled: enabledIds.contains(command.id),
                        onToggle: { enabled in
                            onToggleCommand(command, enabled)
                        },
                        indented: true
                    )
                }
            }
        }
    }
}

#Preview {
    HStack {
        CapabilitySelector(
            sessionId: 1,
            skillManager: SkillManager.shared,
            commandManager: CommandManager.shared,
            isDisabled: false
        )
        CapabilitySelector(
            sessionId: 1,
            skillManager: SkillManager.shared,
            commandManager: CommandManager.shared,
            isDisabled: true
        )
    }
    .padding()
}
