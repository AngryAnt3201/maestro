//
//  SidebarView.swift
//  claude-maestro
//
//  Configuration sidebar for terminal management
//

import SwiftUI
import AppKit

// MARK: - Sidebar Tab

enum SidebarTab: String, CaseIterable {
    case configuration = "Config"
    case processes = "Processes"

    var icon: String {
        switch self {
        case .configuration: return "gearshape"
        case .processes: return "cpu"
        }
    }
}

// MARK: - Sidebar View

struct SidebarView: View {
    @ObservedObject var manager: SessionManager
    @State private var selectedTab: SidebarTab = .configuration

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Tab Picker - moved from safeAreaInset to main VStack
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    ForEach(SidebarTab.allCases, id: \.self) { tab in
                        Button {
                            withAnimation(.easeInOut(duration: 0.15)) {
                                selectedTab = tab
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: tab.icon)
                                    .font(.caption)
                                Text(tab.rawValue)
                                    .font(.caption)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity)
                            .background(
                                selectedTab == tab
                                    ? Color.accentColor.opacity(0.2)
                                    : Color.clear
                            )
                            .foregroundColor(selectedTab == tab ? .accentColor : .secondary)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .background(Color(NSColor.controlBackgroundColor))

                Divider()
            }
            .padding(.bottom, 12)

            // Tab Content
            switch selectedTab {
            case .configuration:
                ConfigurationSidebarContent(manager: manager)
            case .processes:
                ProcessSidebarView(manager: manager)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .onAppear {
            manager.loadPresets()
        }
    }
}

// MARK: - Configuration Sidebar Content

struct ConfigurationSidebarContent: View {
    @ObservedObject var manager: SessionManager

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header
            HStack {
                Text(manager.isRunning ? "Sessions" : "Configuration")
                    .font(.headline)

                Spacer()

                // Multi-select toggle (only when not running)
                if !manager.isRunning {
                    Button {
                        manager.selectionManager.isMultiSelectMode.toggle()
                        if !manager.selectionManager.isMultiSelectMode {
                            manager.selectionManager.clearSelection()
                        }
                    } label: {
                        Image(systemName: manager.selectionManager.isMultiSelectMode ? "checklist.checked" : "checklist")
                            .foregroundColor(manager.selectionManager.isMultiSelectMode ? .accentColor : .secondary)
                    }
                    .buttonStyle(.plain)
                    .help(manager.selectionManager.isMultiSelectMode ? "Exit multi-select" : "Multi-select mode")
                }
            }
            .padding(.horizontal, 8)

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    // Configuration sections (hidden while running)
                    if !manager.isRunning {
                        // Presets Section
                        PresetSelector(manager: manager)

                        Divider()
                            .padding(.horizontal, 8)

                        // Terminal Count Section
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Terminals")
                                .font(.subheadline)
                                .foregroundColor(.secondary)

                            Stepper(value: $manager.terminalCount, in: 1...12) {
                                HStack {
                                    Text("\(manager.terminalCount)")
                                        .font(.title2)
                                        .fontWeight(.bold)
                                    Text("terminals")
                                        .foregroundColor(.secondary)
                                }
                            }

                            // Grid preview
                            Text("Grid: \(manager.gridConfig.rows) x \(manager.gridConfig.columns)")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            // Quick actions
                            HStack(spacing: 4) {
                                Button("Select All") {
                                    manager.selectionManager.selectAll(sessions: manager.sessions)
                                    manager.selectionManager.isMultiSelectMode = true
                                }
                                .buttonStyle(.bordered)
                                .controlSize(.small)

                                Button("Apply Default") {
                                    manager.applyDefaultModeToAll()
                                }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                            }
                            .font(.caption)
                        }
                        .padding(.horizontal, 8)

                        Divider()
                            .padding(.horizontal, 8)
                    }

                    // Git Repository Info Section (always visible)
                    GitInfoSection(gitManager: manager.gitManager)

                    Divider()
                        .padding(.horizontal, 8)

                    // Project Context (CLAUDE.md) Section
                    ClaudeMDSection(
                        claudeMDManager: manager.claudeMDManager,
                        projectPath: manager.projectPath
                    )

                    Divider()
                        .padding(.horizontal, 8)

                    // Batch Action Bar (when selection active, only when not running)
                    if !manager.isRunning && manager.selectionManager.hasSelection {
                        BatchActionBar(manager: manager)

                        Divider()
                            .padding(.horizontal, 8)
                    }

                    // Session List Section
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Sessions")
                                .font(.subheadline)
                                .foregroundColor(.secondary)

                            Spacer()

                            // Selection count badge
                            if manager.selectionManager.hasSelection {
                                Text("\(manager.selectionManager.selectionCount)")
                                    .font(.caption2)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Color.accentColor)
                                    .foregroundColor(.white)
                                    .clipShape(Capsule())
                            }
                        }

                        LazyVStack(spacing: 4) {
                            ForEach(manager.sessions) { session in
                                let sessionId = session.id
                                SelectableSessionRow(
                                    session: session,
                                    isSelected: manager.selectionManager.isSelected(sessionId),
                                    isMultiSelectMode: manager.selectionManager.isMultiSelectMode,
                                    mode: Binding(
                                        get: { manager.session(byId: sessionId)?.mode ?? .claudeCode },
                                        set: { newValue in manager.updateSession(id: sessionId) { $0.mode = newValue } }
                                    ),
                                    onSelect: {
                                        manager.selectionManager.toggleSelection(for: sessionId)
                                    },
                                    isRunning: manager.isRunning
                                )
                            }
                        }
                    }
                    .padding(.horizontal, 8)

                    // Status Overview Section
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Status")
                            .font(.subheadline)
                            .foregroundColor(.secondary)

                        StatusOverviewView(manager: manager)
                    }
                    .padding(.horizontal, 8)

                    Divider()
                        .padding(.horizontal, 8)

                    // Maestro MCP Status Section
                    MaestroMCPStatusSection()

                    // Custom MCP Servers Section
                    CustomMCPServersSection()

                    Divider()
                        .padding(.horizontal, 8)

                    // Plugins & Skills Section
                    MarketplaceSection()

                    Divider()
                        .padding(.horizontal, 8)

                    // Quick Actions Section
                    QuickActionsSection()
                }
                .padding(.bottom, 8)
            }
        }
    }
}

// MARK: - Status Overview

struct StatusOverviewView: View {
    @ObservedObject var manager: SessionManager

    var body: some View {
        VStack(spacing: 4) {
            // Mode counts
            ForEach(TerminalMode.allCases, id: \.self) { mode in
                let count = manager.sessions.filter { $0.mode == mode }.count
                if count > 0 {
                    HStack {
                        Image(systemName: mode.icon)
                            .foregroundColor(mode.color)
                            .frame(width: 12)
                        Text("\(shortModeName(mode)):")
                        Spacer()
                        Text("\(count)")
                            .fontWeight(.medium)
                    }
                    .font(.caption)
                }
            }

            Divider()

            // Status counts
            ForEach(SessionStatus.allCases, id: \.self) { status in
                let count = manager.statusSummary[status] ?? 0
                if count > 0 || status == .idle {
                    HStack {
                        Circle()
                            .fill(status.color)
                            .frame(width: 8, height: 8)
                        Text("\(status.label):")
                        Spacer()
                        Text("\(count)")
                            .fontWeight(.medium)
                    }
                    .font(.caption)
                }
            }
        }
        .padding(8)
        .background(Color(NSColor.windowBackgroundColor))
        .cornerRadius(8)
    }

    private func shortModeName(_ mode: TerminalMode) -> String {
        switch mode {
        case .claudeCode: return "Claude"
        case .geminiCli: return "Gemini"
        case .openAiCodex: return "Codex"
        case .plainTerminal: return "Terminal"
        }
    }
}

// MARK: - Batch Action Bar

struct BatchActionBar: View {
    @ObservedObject var manager: SessionManager

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("\(manager.selectionManager.selectionCount) selected")
                    .font(.caption)
                    .fontWeight(.medium)

                Spacer()

                Button("Clear") {
                    manager.selectionManager.clearSelection()
                }
                .buttonStyle(.plain)
                .font(.caption)
                .foregroundColor(.accentColor)
            }

            Divider()

            // Batch mode selection
            Text("Set Mode:")
                .font(.caption2)
                .foregroundColor(.secondary)

            HStack(spacing: 4) {
                ForEach(TerminalMode.allCases, id: \.self) { mode in
                    Button {
                        manager.setModeForSelected(mode)
                    } label: {
                        Image(systemName: mode.icon)
                            .foregroundColor(mode.color)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .help("Set all selected to \(mode.rawValue)")
                }
            }

            // Batch branch assignment (if git repo)
            if manager.gitManager.isGitRepo {
                Text("Set Branch:")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .padding(.top, 4)

                Menu {
                    Button("Current Branch") {
                        manager.assignBranchToSelected(nil)
                    }

                    Divider()

                    ForEach(manager.gitManager.localBranches) { branch in
                        Button(branch.name) {
                            manager.assignBranchToSelected(branch.name)
                        }
                    }
                } label: {
                    Label("Select Branch", systemImage: "arrow.triangle.branch")
                        .font(.caption)
                }
                .menuStyle(.borderlessButton)
            }
        }
        .padding(8)
        .background(Color.accentColor.opacity(0.1))
        .cornerRadius(8)
        .padding(.horizontal, 8)
    }
}

// MARK: - Remote Status Indicator

struct RemoteStatusIndicator: View {
    let status: RemoteConnectionStatus

    var body: some View {
        HStack(spacing: 3) {
            if case .checking = status {
                ProgressView()
                    .scaleEffect(0.5)
                    .frame(width: 12, height: 12)
            } else {
                Image(systemName: status.icon)
                    .foregroundColor(status.color)
                    .font(.caption2)
            }
        }
        .help(status.label)
    }
}

// MARK: - Git Info Section

struct GitInfoSection: View {
    @ObservedObject var gitManager: GitManager
    @State private var isEditingConfig: Bool = false
    @State private var editedUserName: String = ""
    @State private var editedUserEmail: String = ""
    @State private var isSaving: Bool = false
    @State private var showFullSettings: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Git Repository")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                Spacer()
                if gitManager.isGitRepo {
                    Button {
                        showFullSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.plain)
                    .help("Git Settings")
                }
            }
            .sheet(isPresented: $showFullSettings) {
                GitSettingsView(gitManager: gitManager)
            }

            if gitManager.isGitRepo {
                VStack(alignment: .leading, spacing: 6) {
                    // User info
                    if let name = gitManager.userName, !name.isEmpty {
                        HStack(spacing: 4) {
                            Image(systemName: "person.circle")
                                .foregroundColor(.blue)
                                .font(.caption)
                            Text(name)
                                .font(.caption)
                                .lineLimit(1)
                                .help(name)
                        }
                    }

                    if let email = gitManager.userEmail, !email.isEmpty {
                        HStack(spacing: 4) {
                            Image(systemName: "envelope")
                                .foregroundColor(.blue)
                                .font(.caption)
                            Text(email)
                                .font(.caption)
                                .lineLimit(1)
                                .help(email)
                        }
                    }

                    // Remote URLs with connectivity status
                    if !gitManager.remoteURLs.isEmpty {
                        Divider()

                        ForEach(Array(gitManager.remoteURLs.keys.sorted()), id: \.self) { remoteName in
                            if let url = gitManager.remoteURLs[remoteName] {
                                let status = gitManager.remoteStatuses[remoteName] ?? .unknown
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 4) {
                                        Image(systemName: "network")
                                            .foregroundColor(.green)
                                            .font(.caption2)
                                        Text(remoteName)
                                            .font(.caption)
                                            .fontWeight(.medium)
                                        Spacer()
                                        RemoteStatusIndicator(status: status)
                                    }
                                    Text(formatRemoteURL(url))
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                        .lineLimit(2)
                                        .truncationMode(.middle)
                                        .help(url)
                                }
                                .contextMenu {
                                    Button("Copy URL") {
                                        NSPasteboard.general.clearContents()
                                        NSPasteboard.general.setString(url, forType: .string)
                                    }
                                    Button("Open in Browser") {
                                        let browserURL = url
                                            .replacingOccurrences(of: "git@github.com:", with: "https://github.com/")
                                            .replacingOccurrences(of: "git@gitlab.com:", with: "https://gitlab.com/")
                                            .replacingOccurrences(of: ".git", with: "")
                                        if let urlObj = URL(string: browserURL) {
                                            NSWorkspace.shared.open(urlObj)
                                        }
                                    }
                                    Divider()
                                    Button("Check Connection") {
                                        Task {
                                            await gitManager.checkAllRemotesConnectivity()
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(8)
                .background(Color(NSColor.windowBackgroundColor))
                .cornerRadius(8)
            } else {
                HStack {
                    Image(systemName: "exclamationmark.triangle")
                        .foregroundColor(.orange)
                    Text("Not a git repository")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(NSColor.windowBackgroundColor))
                .cornerRadius(8)
            }
        }
        .padding(.horizontal, 8)
    }

    private func formatRemoteURL(_ url: String) -> String {
        var formatted = url
            .replacingOccurrences(of: "git@github.com:", with: "github:")
            .replacingOccurrences(of: "git@gitlab.com:", with: "gitlab:")
            .replacingOccurrences(of: "https://github.com/", with: "github:")
            .replacingOccurrences(of: "https://gitlab.com/", with: "gitlab:")

        if formatted.hasSuffix(".git") {
            formatted = String(formatted.dropLast(4))
        }
        return formatted
    }
}

// MARK: - Selectable Session Row

struct SelectableSessionRow: View {
    let session: SessionInfo
    let isSelected: Bool
    let isMultiSelectMode: Bool
    @Binding var mode: TerminalMode
    let onSelect: () -> Void
    let isRunning: Bool

    var body: some View {
        HStack(spacing: 6) {
            // Selection checkbox (visible in multi-select mode)
            if isMultiSelectMode {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundColor(isSelected ? .accentColor : .secondary)
                    .font(.caption)
                    .onTapGesture { onSelect() }
            }

            // Status indicator
            Circle()
                .fill(session.status.color)
                .frame(width: 8, height: 8)

            // Session number
            Text("#\(session.id)")
                .font(.caption)
                .fontWeight(.medium)

            Spacer()

            // Branch indicator (if assigned)
            if let branch = session.assignedBranch {
                HStack(spacing: 2) {
                    Image(systemName: "arrow.triangle.branch")
                        .font(.caption2)
                    Text(branch)
                        .font(.caption2)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .foregroundColor(.secondary)
                .help(branch)
            }

            // Direct mode picker (replaces cycling toggle)
            CompactModePicker(selectedMode: $mode, isDisabled: isRunning)
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 6)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(isSelected ? Color.accentColor.opacity(0.2) : session.status.color.opacity(0.1))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(isSelected ? Color.accentColor : Color.clear, lineWidth: 1)
        )
        .contentShape(Rectangle())
        .onTapGesture {
            if isMultiSelectMode {
                onSelect()
            }
        }
    }
}

// MARK: - Maestro MCP Status Section

struct MaestroMCPStatusSection: View {
    @StateObject private var mcpManager = MCPServerManager.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Maestro MCP")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                Spacer()

                Button {
                    mcpManager.checkServerAvailability()
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
                .help("Refresh status")
            }

            HStack(spacing: 8) {
                // Status indicator
                Circle()
                    .fill(mcpManager.isServerAvailable ? Color.green : Color.orange)
                    .frame(width: 8, height: 8)

                VStack(alignment: .leading, spacing: 2) {
                    Text(mcpManager.isServerAvailable ? "Available" : "Not Available")
                        .font(.caption)
                        .fontWeight(.medium)

                    if let path = mcpManager.serverPath {
                        Text(path)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .help(path)
                    } else if let error = mcpManager.lastError {
                        Text(error)
                            .font(.caption2)
                            .foregroundColor(.orange)
                            .lineLimit(2)
                    }
                }

                Spacer()
            }
            .padding(8)
            .background(Color(NSColor.windowBackgroundColor))
            .cornerRadius(8)
        }
        .padding(.horizontal, 8)
    }
}

// MARK: - Custom MCP Servers Section

struct CustomMCPServersSection: View {
    @StateObject private var mcpManager = MCPServerManager.shared
    @State private var showAddSheet: Bool = false
    @State private var editingServer: MCPServerConfig? = nil
    @State private var showDeleteConfirmation: Bool = false
    @State private var serverToDelete: MCPServerConfig? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("MCP Servers")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                Spacer()

                Button {
                    showAddSheet = true
                } label: {
                    Image(systemName: "plus.circle")
                        .foregroundColor(.accentColor)
                }
                .buttonStyle(.plain)
                .help("Add MCP server")
            }

            VStack(spacing: 0) {
                if mcpManager.customServers.isEmpty {
                    HStack {
                        Image(systemName: "server.rack")
                            .foregroundColor(.secondary)
                            .font(.caption)
                        Text("No custom servers")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                } else {
                    VStack(spacing: 4) {
                        ForEach(mcpManager.customServers) { server in
                            MCPServerRow(
                                server: server,
                                onEdit: { editingServer = server },
                                onDelete: {
                                    serverToDelete = server
                                    showDeleteConfirmation = true
                                },
                                onToggle: { enabled in
                                    var updated = server
                                    updated.isEnabled = enabled
                                    mcpManager.updateServer(updated)
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
        .sheet(isPresented: $showAddSheet) {
            MCPServerEditorSheet(
                server: nil,
                onSave: { server in
                    mcpManager.addServer(server)
                    showAddSheet = false
                },
                onCancel: { showAddSheet = false }
            )
        }
        .sheet(item: $editingServer) { server in
            MCPServerEditorSheet(
                server: server,
                onSave: { updated in
                    mcpManager.updateServer(updated)
                    editingServer = nil
                },
                onCancel: { editingServer = nil }
            )
        }
        .alert("Delete Server?", isPresented: $showDeleteConfirmation) {
            Button("Cancel", role: .cancel) {
                serverToDelete = nil
            }
            Button("Delete", role: .destructive) {
                if let server = serverToDelete {
                    mcpManager.deleteServer(id: server.id)
                }
                serverToDelete = nil
            }
        } message: {
            if let server = serverToDelete {
                Text("Are you sure you want to delete \"\(server.name)\"? This cannot be undone.")
            }
        }
    }
}

// MARK: - MCP Server Row

struct MCPServerRow: View {
    let server: MCPServerConfig
    let onEdit: () -> Void
    let onDelete: () -> Void
    let onToggle: (Bool) -> Void

    var body: some View {
        HStack(spacing: 8) {
            // Enable toggle
            Toggle("", isOn: Binding(
                get: { server.isEnabled },
                set: { onToggle($0) }
            ))
            .toggleStyle(.switch)
            .controlSize(.mini)

            // Server info
            VStack(alignment: .leading, spacing: 1) {
                Text(server.name)
                    .font(.caption)
                    .fontWeight(.medium)
                    .lineLimit(1)
                Text(server.command + (server.args.isEmpty ? "" : " " + server.args.first!))
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }

            Spacer()

            // Actions
            HStack(spacing: 4) {
                Button { onEdit() } label: {
                    Image(systemName: "pencil")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
                .help("Edit server")

                Button { onDelete() } label: {
                    Image(systemName: "trash")
                        .font(.caption2)
                        .foregroundColor(.red.opacity(0.7))
                }
                .buttonStyle(.plain)
                .help("Delete server")
            }
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 4)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(server.isEnabled ? Color.accentColor.opacity(0.1) : Color.clear)
        )
    }
}

// MARK: - Quick Actions Section

struct QuickActionsSection: View {
    @StateObject private var quickActionManager = QuickActionManager.shared
    @State private var showManagerSheet: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Quick Actions")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                Spacer()

                Button {
                    showManagerSheet = true
                } label: {
                    Image(systemName: "gearshape")
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
                .help("Manage quick actions")
            }

            VStack(spacing: 0) {
                if quickActionManager.quickActions.isEmpty {
                    HStack {
                        Image(systemName: "bolt.circle")
                            .foregroundColor(.secondary)
                            .font(.caption)
                        Text("No quick actions")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                } else {
                    VStack(spacing: 4) {
                        ForEach(quickActionManager.sortedActions) { action in
                            HStack(spacing: 8) {
                                Image(systemName: action.icon)
                                    .foregroundColor(action.color)
                                    .font(.caption)
                                    .frame(width: 16)

                                Text(action.name)
                                    .font(.caption)
                                    .fontWeight(.medium)
                                    .lineLimit(1)

                                Spacer()
                            }
                            .padding(.vertical, 4)
                            .padding(.horizontal, 4)
                        }
                    }
                    .padding(8)
                }
            }
            .background(Color(NSColor.windowBackgroundColor))
            .cornerRadius(8)
        }
        .padding(.horizontal, 8)
        .sheet(isPresented: $showManagerSheet) {
            QuickActionsManagerSheet(
                quickActionManager: quickActionManager,
                onDismiss: { showManagerSheet = false }
            )
        }
    }
}

// MARK: - Claude.md Section

struct ClaudeMDSection: View {
    @ObservedObject var claudeMDManager: ClaudeMDManager
    let projectPath: String
    @State private var showEditor: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Project Context")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                Spacer()
                Button {
                    showEditor = true
                } label: {
                    Image(systemName: "pencil.circle")
                        .foregroundColor(.accentColor)
                }
                .buttonStyle(.plain)
                .help("Edit CLAUDE.md")
                .disabled(projectPath.isEmpty)
            }

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Image(systemName: claudeMDManager.fileExists ? "doc.text.fill" : "doc.badge.plus")
                        .foregroundColor(claudeMDManager.fileExists ? .green : .orange)
                        .font(.caption)
                    Text(claudeMDManager.fileExists ? "CLAUDE.md" : "No CLAUDE.md")
                        .font(.caption)
                        .fontWeight(.medium)
                }

                if claudeMDManager.fileExists {
                    // Preview first few lines
                    let preview = String(claudeMDManager.content.prefix(100))
                    Text(preview.isEmpty ? "Empty file" : preview + (claudeMDManager.content.count > 100 ? "..." : ""))
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                } else {
                    Text("Click to create project context file")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(NSColor.windowBackgroundColor))
            .cornerRadius(8)
            .onTapGesture {
                if !projectPath.isEmpty {
                    showEditor = true
                }
            }
        }
        .padding(.horizontal, 8)
        .sheet(isPresented: $showEditor) {
            ClaudeMDEditorSheet(claudeMDManager: claudeMDManager)
        }
    }
}

#Preview {
    SidebarView(manager: SessionManager())
}
