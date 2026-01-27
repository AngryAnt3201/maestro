//
//  AppEditorSheet.swift
//  claude-maestro
//
//  Create/edit app form with polished UI matching marketplace design language
//

import SwiftUI

// MARK: - Tab Configuration

private enum AppEditorTab: Int, CaseIterable {
    case basicInfo = 0
    case mcpServers = 1
    case skills = 2
    case commands = 3
    case plugins = 4
    case instructions = 5

    var label: String {
        switch self {
        case .basicInfo: return "Basic Info"
        case .mcpServers: return "MCP Servers"
        case .skills: return "Skills"
        case .commands: return "Commands"
        case .plugins: return "Plugins"
        case .instructions: return "Instructions"
        }
    }

    var icon: String {
        switch self {
        case .basicInfo: return "info.circle"
        case .mcpServers: return "server.rack"
        case .skills: return "wand.and.stars"
        case .commands: return "terminal"
        case .plugins: return "puzzlepiece.extension"
        case .instructions: return "doc.text"
        }
    }

    var color: Color {
        switch self {
        case .basicInfo: return .gray
        case .mcpServers: return .purple
        case .skills: return .orange
        case .commands: return .blue
        case .plugins: return .purple
        case .instructions: return .gray
        }
    }
}

// MARK: - Main View

/// Sheet for creating or editing an app configuration
struct AppEditorSheet: View {
    let app: AppConfig?
    let onSave: (AppConfig) -> Void
    let onCancel: () -> Void

    @State private var name: String = ""
    @State private var icon: String = "app.fill"
    @State private var description: String = ""
    @State private var defaultMode: TerminalMode = .claudeCode
    @State private var defaultProjectPath: String = ""
    @State private var maestroMCPEnabled: Bool = true
    @State private var customInstructions: String = ""

    @State private var enabledMCPServerIds: Set<UUID> = []
    @State private var enabledSkillIds: Set<UUID> = []
    @State private var enabledCommandIds: Set<UUID> = []
    @State private var enabledPluginIds: Set<UUID> = []

    @StateObject private var mcpManager = MCPServerManager.shared
    @StateObject private var skillManager = SkillManager.shared
    @StateObject private var commandManager = CommandManager.shared
    @StateObject private var marketplaceManager = MarketplaceManager.shared

    @State private var selectedTab: AppEditorTab = .basicInfo
    @Environment(\.colorScheme) private var colorScheme

    private var isEditing: Bool { app != nil }
    private var isDark: Bool { colorScheme == .dark }

    var body: some View {
        VStack(spacing: 0) {
            // Styled header
            headerView

            // Gradient separator
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [Color.clear, Color.purple.opacity(0.3), Color.blue.opacity(0.3), Color.clear],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .frame(height: 1)

            // Custom tab bar
            tabBarView
                .padding(.horizontal, 24)
                .padding(.top, 16)

            // Content area
            ScrollView {
                tabContent
                    .padding(.horizontal, 24)
                    .padding(.vertical, 16)
            }

            // Footer with gradient separator
            footerView
        }
        .frame(width: 700, height: 580)
        .background(Color(NSColor.windowBackgroundColor))
        .onAppear {
            if let app = app {
                name = app.name
                icon = app.icon
                description = app.description
                defaultMode = app.defaultMode
                defaultProjectPath = app.defaultProjectPath ?? ""
                maestroMCPEnabled = app.maestroMCPEnabled
                customInstructions = app.customInstructions ?? ""
                enabledMCPServerIds = app.enabledMCPServerIds
                enabledSkillIds = app.enabledSkillIds
                enabledCommandIds = app.enabledCommandIds
                enabledPluginIds = app.enabledPluginIds
            }
        }
    }

    // MARK: - Header View

    private var headerView: some View {
        HStack(spacing: 12) {
            // Gradient icon background
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(
                        LinearGradient(
                            colors: [Color.purple, Color.blue],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 40, height: 40)

                Image(systemName: isEditing ? "pencil.and.outline" : "plus.app.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(.white)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(isEditing ? "Edit App" : "Create App")
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                Text(isEditing ? "Modify your app configuration" : "Bundle configurations into a reusable preset")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.secondary)
            }

            Spacer()

            Button {
                onCancel()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(.secondary)
                    .frame(width: 28, height: 28)
                    .background(Color(NSColor.controlBackgroundColor).opacity(0.8))
                    .cornerRadius(8)
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.escape)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
    }

    // MARK: - Tab Bar View

    private var tabBarView: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(AppEditorTab.allCases, id: \.rawValue) { tab in
                    TabChip(
                        label: tab.label,
                        icon: tab.icon,
                        isSelected: selectedTab == tab,
                        color: tab.color
                    ) {
                        withAnimation(.spring(response: 0.3)) {
                            selectedTab = tab
                        }
                    }
                }
            }
        }
    }

    // MARK: - Tab Content

    @ViewBuilder
    private var tabContent: some View {
        switch selectedTab {
        case .basicInfo:
            basicInfoTab
        case .mcpServers:
            mcpServersTab
        case .skills:
            skillsTab
        case .commands:
            commandsTab
        case .plugins:
            pluginsTab
        case .instructions:
            instructionsTab
        }
    }

    // MARK: - Basic Info Tab

    private var basicInfoTab: some View {
        VStack(spacing: 16) {
            // App Details Card
            StyledSection(title: "App Details", icon: "app.badge.fill", color: .gray) {
                VStack(spacing: 14) {
                    // Name field
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Name")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.secondary)
                        StyledTextField(
                            placeholder: "My Development App",
                            text: $name
                        )
                    }

                    // Description field
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Description")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.secondary)
                        StyledTextField(
                            placeholder: "A brief description of this app configuration",
                            text: $description
                        )
                    }

                    // Icon picker
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Icon")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.secondary)

                        HStack(spacing: 16) {
                            // Preview
                            ZStack {
                                RoundedRectangle(cornerRadius: 12)
                                    .fill(
                                        LinearGradient(
                                            colors: [Color.purple.opacity(0.2), Color.blue.opacity(0.2)],
                                            startPoint: .topLeading,
                                            endPoint: .bottomTrailing
                                        )
                                    )
                                    .frame(width: 48, height: 48)

                                Image(systemName: icon)
                                    .font(.system(size: 22))
                                    .foregroundColor(.purple)
                            }

                            // Icon grid
                            LazyVGrid(columns: Array(repeating: GridItem(.fixed(32), spacing: 8), count: 8), spacing: 8) {
                                ForEach(AppIconOptions.icons.prefix(16), id: \.self) { iconName in
                                    Button {
                                        withAnimation(.spring(response: 0.2)) {
                                            icon = iconName
                                        }
                                    } label: {
                                        Image(systemName: iconName)
                                            .font(.system(size: 14))
                                            .foregroundColor(icon == iconName ? .white : .primary)
                                            .frame(width: 32, height: 32)
                                            .background(
                                                RoundedRectangle(cornerRadius: 6)
                                                    .fill(icon == iconName ? Color.purple : Color(NSColor.controlBackgroundColor))
                                            )
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                }
            }

            // Default Settings Card
            StyledSection(title: "Default Settings", icon: "gearshape.fill", color: .gray) {
                VStack(spacing: 14) {
                    // Default Mode
                    HStack {
                        Text("Default Mode")
                            .font(.system(size: 13, weight: .medium))

                        Spacer()

                        Picker("", selection: $defaultMode) {
                            ForEach(TerminalMode.allCases, id: \.self) { mode in
                                Label(mode.rawValue, systemImage: mode.icon)
                                    .tag(mode)
                            }
                        }
                        .pickerStyle(.menu)
                        .frame(width: 160)
                    }

                    Divider()
                        .opacity(0.5)

                    // Maestro MCP Toggle
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Enable Maestro MCP")
                                .font(.system(size: 13, weight: .medium))
                            Text("Connect to Maestro's process management server")
                                .font(.system(size: 11))
                                .foregroundColor(.secondary)
                        }

                        Spacer()

                        Toggle("", isOn: $maestroMCPEnabled)
                            .toggleStyle(.switch)
                            .tint(.purple)
                    }

                    Divider()
                        .opacity(0.5)

                    // Project Path
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Default Project Path")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.secondary)

                        HStack(spacing: 8) {
                            StyledTextField(
                                placeholder: "Optional - Browse to select a directory",
                                text: $defaultProjectPath
                            )

                            Button {
                                selectProjectPath()
                            } label: {
                                Image(systemName: "folder.fill")
                                    .font(.system(size: 12))
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                }
            }
        }
    }

    // MARK: - MCP Servers Tab

    private var mcpServersTab: some View {
        VStack(spacing: 16) {
            StyledSection(
                title: "MCP Servers",
                icon: "server.rack",
                color: .purple,
                subtitle: "Select MCP servers to enable with this app"
            ) {
                if mcpManager.customServers.isEmpty {
                    styledEmptyState(
                        icon: "server.rack",
                        title: "No MCP Servers",
                        message: "Add MCP servers in the sidebar to include them in apps.",
                        color: .purple
                    )
                } else {
                    VStack(spacing: 8) {
                        ForEach(mcpManager.customServers) { server in
                            StyledToggleRow(
                                icon: "server.rack",
                                title: server.name,
                                subtitle: server.command,
                                color: .purple,
                                isEnabled: Binding(
                                    get: { enabledMCPServerIds.contains(server.id) },
                                    set: { enabled in
                                        if enabled {
                                            enabledMCPServerIds.insert(server.id)
                                        } else {
                                            enabledMCPServerIds.remove(server.id)
                                        }
                                    }
                                )
                            )
                        }
                    }
                }
            }
        }
    }

    // MARK: - Skills Tab

    private var skillsTab: some View {
        VStack(spacing: 16) {
            StyledSection(
                title: "Skills",
                icon: "wand.and.stars",
                color: .orange,
                subtitle: "Select skills to enable with this app"
            ) {
                if skillManager.installedSkills.isEmpty {
                    styledEmptyState(
                        icon: "wand.and.stars",
                        title: "No Skills",
                        message: "Install skills from the marketplace or create personal skills.",
                        color: .orange
                    )
                } else {
                    VStack(spacing: 8) {
                        ForEach(skillManager.installedSkills) { skill in
                            StyledToggleRow(
                                icon: "wand.and.stars",
                                title: skill.name,
                                subtitle: skill.description,
                                color: .orange,
                                isEnabled: Binding(
                                    get: { enabledSkillIds.contains(skill.id) },
                                    set: { enabled in
                                        if enabled {
                                            enabledSkillIds.insert(skill.id)
                                        } else {
                                            enabledSkillIds.remove(skill.id)
                                        }
                                    }
                                )
                            )
                        }
                    }
                }
            }
        }
    }

    // MARK: - Commands Tab

    private var commandsTab: some View {
        VStack(spacing: 16) {
            StyledSection(
                title: "Commands",
                icon: "terminal",
                color: .blue,
                subtitle: "Select commands to enable with this app"
            ) {
                if commandManager.installedCommands.isEmpty {
                    styledEmptyState(
                        icon: "terminal",
                        title: "No Commands",
                        message: "Create commands in ~/.claude/commands/ or install from plugins.",
                        color: .blue
                    )
                } else {
                    VStack(spacing: 8) {
                        ForEach(commandManager.installedCommands) { command in
                            StyledToggleRow(
                                icon: "terminal",
                                title: "/\(command.commandName)",
                                subtitle: command.description,
                                color: .blue,
                                isEnabled: Binding(
                                    get: { enabledCommandIds.contains(command.id) },
                                    set: { enabled in
                                        if enabled {
                                            enabledCommandIds.insert(command.id)
                                        } else {
                                            enabledCommandIds.remove(command.id)
                                        }
                                    }
                                )
                            )
                        }
                    }
                }
            }
        }
    }

    // MARK: - Plugins Tab

    private var pluginsTab: some View {
        VStack(spacing: 16) {
            StyledSection(
                title: "Plugins",
                icon: "puzzlepiece.extension",
                color: .purple,
                subtitle: "Select plugins to enable with this app"
            ) {
                if marketplaceManager.installedPlugins.isEmpty {
                    styledEmptyState(
                        icon: "puzzlepiece.extension",
                        title: "No Plugins",
                        message: "Install plugins from the Skills Marketplace.",
                        color: .purple
                    )
                } else {
                    VStack(spacing: 8) {
                        ForEach(marketplaceManager.installedPlugins) { plugin in
                            StyledToggleRow(
                                icon: "puzzlepiece.extension",
                                title: plugin.name,
                                subtitle: plugin.description,
                                color: .purple,
                                isEnabled: Binding(
                                    get: { enabledPluginIds.contains(plugin.id) },
                                    set: { enabled in
                                        if enabled {
                                            enabledPluginIds.insert(plugin.id)
                                        } else {
                                            enabledPluginIds.remove(plugin.id)
                                        }
                                    }
                                )
                            )
                        }
                    }
                }
            }
        }
    }

    // MARK: - Instructions Tab

    private var instructionsTab: some View {
        VStack(spacing: 16) {
            StyledSection(
                title: "Custom Instructions",
                icon: "doc.text",
                color: .gray,
                subtitle: "Instructions that will be added to the session's CLAUDE.md"
            ) {
                VStack(alignment: .leading, spacing: 12) {
                    ZStack(alignment: .topLeading) {
                        // Background
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color(NSColor.textBackgroundColor).opacity(isDark ? 0.5 : 0.8))

                        // Gradient border
                        RoundedRectangle(cornerRadius: 10)
                            .strokeBorder(
                                LinearGradient(
                                    colors: [Color.gray.opacity(0.3), Color.gray.opacity(0.15)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                ),
                                lineWidth: 1
                            )

                        // Text editor
                        if customInstructions.isEmpty {
                            Text("Enter custom instructions for Claude...")
                                .font(.system(.body, design: .monospaced))
                                .foregroundColor(.secondary.opacity(0.6))
                                .padding(12)
                        }

                        TextEditor(text: $customInstructions)
                            .font(.system(.body, design: .monospaced))
                            .scrollContentBackground(.hidden)
                            .padding(8)
                    }
                    .frame(minHeight: 200)

                    // Helper text
                    HStack(spacing: 6) {
                        Image(systemName: "lightbulb.fill")
                            .font(.system(size: 10))
                            .foregroundColor(.orange.opacity(0.7))
                        Text("Example: \"Always use TypeScript\", \"Prefer functional components\", \"Use Swift concurrency\"")
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                    }
                }
            }
        }
    }

    // MARK: - Footer View

    private var footerView: some View {
        VStack(spacing: 0) {
            // Gradient separator
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [Color.clear, Color.primary.opacity(0.1), Color.clear],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .frame(height: 1)

            HStack {
                // Validation hint
                if name.trimmingCharacters(in: .whitespaces).isEmpty {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.circle")
                            .font(.system(size: 11))
                        Text("Name is required")
                            .font(.system(size: 11))
                    }
                    .foregroundColor(.orange)
                }

                Spacer()

                Button {
                    saveApp()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: isEditing ? "checkmark.circle.fill" : "plus.circle.fill")
                            .font(.system(size: 13))
                        Text(isEditing ? "Save Changes" : "Create App")
                            .font(.system(size: 13, weight: .semibold))
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(.purple)
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
        }
    }

    // MARK: - Helper Views

    private func styledEmptyState(icon: String, title: String, message: String, color: Color) -> some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(color.opacity(0.1))
                    .frame(width: 56, height: 56)

                Image(systemName: icon)
                    .font(.system(size: 24))
                    .foregroundColor(color.opacity(0.6))
            }

            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.secondary)

            Text(message)
                .font(.system(size: 12))
                .foregroundColor(.secondary.opacity(0.8))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
    }

    // MARK: - Actions

    private func selectProjectPath() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.message = "Select default project directory"

        if panel.runModal() == .OK {
            defaultProjectPath = panel.url?.path ?? ""
        }
    }

    private func saveApp() {
        let trimmedPath = defaultProjectPath.trimmingCharacters(in: .whitespaces)
        let trimmedInstructions = customInstructions.trimmingCharacters(in: .whitespacesAndNewlines)

        let savedApp = AppConfig(
            id: app?.id ?? UUID(),
            name: name.trimmingCharacters(in: .whitespaces),
            icon: icon,
            description: description.trimmingCharacters(in: .whitespaces),
            enabledMCPServerIds: enabledMCPServerIds,
            enabledSkillIds: enabledSkillIds,
            enabledCommandIds: enabledCommandIds,
            enabledPluginIds: enabledPluginIds,
            defaultMode: defaultMode,
            defaultProjectPath: trimmedPath.isEmpty ? nil : trimmedPath,
            maestroMCPEnabled: maestroMCPEnabled,
            customInstructions: trimmedInstructions.isEmpty ? nil : trimmedInstructions,
            createdAt: app?.createdAt ?? Date(),
            lastUsed: app?.lastUsed
        )

        onSave(savedApp)
    }
}

// MARK: - Tab Chip Component

private struct TabChip: View {
    let label: String
    let icon: String
    let isSelected: Bool
    let color: Color
    let action: () -> Void

    @State private var isHovered: Bool = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 10, weight: .medium))
                Text(label)
                    .font(.system(size: 11, weight: .medium))
            }
            .foregroundColor(isSelected ? .white : (isHovered ? color : .primary))
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(
                Capsule()
                    .fill(
                        isSelected
                            ? color
                            : (isHovered ? color.opacity(0.1) : Color.primary.opacity(0.05))
                    )
            )
            .overlay(
                Capsule()
                    .strokeBorder(
                        isSelected ? Color.clear : color.opacity(isHovered ? 0.3 : 0),
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .animation(.easeOut(duration: 0.15), value: isHovered)
    }
}

// MARK: - Styled Section Component

private struct StyledSection<Content: View>: View {
    let title: String
    let icon: String
    let color: Color
    var subtitle: String? = nil
    @ViewBuilder let content: Content

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            // Header
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(color)

                Text(title)
                    .font(.system(size: 13, weight: .semibold))

                if let subtitle = subtitle {
                    Text("—")
                        .foregroundColor(.secondary.opacity(0.5))
                    Text(subtitle)
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                }
            }

            // Content
            content
        }
        .padding(16)
        .background(
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color(NSColor.controlBackgroundColor))
                    .shadow(
                        color: .black.opacity(colorScheme == .dark ? 0.3 : 0.06),
                        radius: 8,
                        y: 3
                    )

                // Subtle gradient overlay
                RoundedRectangle(cornerRadius: 12)
                    .fill(
                        LinearGradient(
                            colors: [color.opacity(0.03), Color.clear],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
            }
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(
                    LinearGradient(
                        colors: [color.opacity(0.15), color.opacity(0.08)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
        )
    }
}

// MARK: - Styled Text Field

private struct StyledTextField: View {
    let placeholder: String
    @Binding var text: String

    var body: some View {
        TextField(placeholder, text: $text)
            .textFieldStyle(.plain)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color(NSColor.textBackgroundColor).opacity(0.8))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
                    )
            )
    }
}

// MARK: - Styled Toggle Row

private struct StyledToggleRow: View {
    let icon: String
    let title: String
    let subtitle: String
    let color: Color
    @Binding var isEnabled: Bool

    @State private var isHovered: Bool = false
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(spacing: 12) {
            // Icon with glow
            ZStack {
                if isHovered || isEnabled {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(color.opacity(0.15))
                        .frame(width: 36, height: 36)
                        .blur(radius: 6)
                }

                RoundedRectangle(cornerRadius: 8)
                    .fill(
                        isEnabled
                            ? LinearGradient(
                                colors: [color, color.opacity(0.75)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                            : LinearGradient(
                                colors: [color.opacity(0.15), color.opacity(0.1)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                    )
                    .frame(width: 34, height: 34)

                Image(systemName: icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(isEnabled ? .white : color)
            }

            // Info
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 13, weight: .medium))
                    .lineLimit(1)

                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer()

            // Toggle
            Toggle("", isOn: $isEnabled)
                .toggleStyle(.switch)
                .tint(color)
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(
                    isHovered
                        ? color.opacity(0.05)
                        : Color(NSColor.controlBackgroundColor).opacity(colorScheme == .dark ? 0.3 : 0.5)
                )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(
                    isEnabled ? color.opacity(0.25) : Color.primary.opacity(0.06),
                    lineWidth: 1
                )
        )
        .onHover { isHovered = $0 }
        .animation(.easeOut(duration: 0.15), value: isHovered)
        .animation(.easeOut(duration: 0.15), value: isEnabled)
    }
}

#Preview {
    AppEditorSheet(
        app: nil,
        onSave: { _ in },
        onCancel: {}
    )
}
