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
            // Tab Picker
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
                        .padding(.vertical, 6)
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
            .background(Color(NSColor.controlBackgroundColor).opacity(0.5))

            Divider()

            // Tab Content
            switch selectedTab {
            case .configuration:
                ConfigurationSidebarContent(manager: manager)
            case .processes:
                ProcessSidebarView(manager: manager)
            }
        }
        .frame(width: 240)
        .background(Color(NSColor.controlBackgroundColor))
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
            .padding(.horizontal)
            .padding(.top, 12)

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    // Configuration sections (hidden while running)
                    if !manager.isRunning {
                        // Presets Section
                        PresetSelector(manager: manager)

                        Divider()
                            .padding(.horizontal)

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
                        .padding(.horizontal)

                        Divider()
                            .padding(.horizontal)
                    }

                    // Git Repository Info Section (always visible)
                    GitInfoSection(gitManager: manager.gitManager)

                    Divider()
                        .padding(.horizontal)

                    // Batch Action Bar (when selection active, only when not running)
                    if !manager.isRunning && manager.selectionManager.hasSelection {
                        BatchActionBar(manager: manager)

                        Divider()
                            .padding(.horizontal)
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
                    .padding(.horizontal)

                    // Status Overview Section
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Status")
                            .font(.subheadline)
                            .foregroundColor(.secondary)

                        StatusOverviewView(manager: manager)
                    }
                    .padding(.horizontal)

                    Divider()
                        .padding(.horizontal)

                    // Maestro MCP Section
                    MaestroMCPSection()

                    Divider()
                        .padding(.horizontal)

                    // Custom MCP Servers Section
                    CustomMCPServersSection()

                    Divider()
                        .padding(.horizontal)

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
        .padding(.horizontal)
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
        .padding(.horizontal)
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

// MARK: - Maestro MCP Section

struct MaestroMCPSection: View {
    @StateObject private var mcpManager = MCPServerManager.shared
    @State private var showDetails: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Maestro MCP")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                Spacer()

                // Status indicator
                Circle()
                    .fill(mcpManager.isServerAvailable ? Color.green : Color.orange)
                    .frame(width: 8, height: 8)

                // Expand/collapse
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        showDetails.toggle()
                    }
                } label: {
                    Image(systemName: showDetails ? "chevron.up" : "chevron.down")
                        .foregroundColor(.secondary)
                        .font(.caption)
                }
                .buttonStyle(.plain)
            }

            VStack(alignment: .leading, spacing: 6) {
                // Status row
                HStack(spacing: 6) {
                    Image(systemName: mcpManager.isServerAvailable ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .foregroundColor(mcpManager.isServerAvailable ? .green : .orange)
                        .font(.caption)

                    Text(mcpManager.isServerAvailable ? "Ready" : "Not Built")
                        .font(.caption)
                        .fontWeight(.medium)

                    Spacer()
                }

                // Details (expanded)
                if showDetails {
                    VStack(alignment: .leading, spacing: 4) {
                        Divider()

                        // Server path
                        if let path = mcpManager.serverPath {
                            HStack(spacing: 4) {
                                Image(systemName: "folder")
                                    .foregroundColor(.blue)
                                    .font(.caption2)
                                Text("Path")
                                    .font(.caption2)
                                Spacer()
                            }
                            Text(shortenPath(path))
                                .font(.caption2)
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                                .help(path)
                        }

                        // Available tools
                        Divider()

                        Text("Available Tools")
                            .font(.caption2)
                            .fontWeight(.medium)

                        VStack(alignment: .leading, spacing: 2) {
                            ToolRow(name: "start_dev_server", description: "Start dev server")
                            ToolRow(name: "stop_dev_server", description: "Stop dev server")
                            ToolRow(name: "get_server_status", description: "Check status")
                            ToolRow(name: "get_server_logs", description: "View logs")
                            ToolRow(name: "detect_project_type", description: "Auto-detect project")
                        }

                        // Refresh button
                        Divider()

                        Button {
                            mcpManager.checkServerAvailability()
                        } label: {
                            HStack {
                                Image(systemName: "arrow.clockwise")
                                Text("Refresh Status")
                            }
                            .font(.caption2)
                        }
                        .buttonStyle(.plain)
                        .foregroundColor(.accentColor)
                    }
                }

                // Last error from manager
                if let error = mcpManager.lastError {
                    Text(error)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }
            }
            .padding(8)
            .background(Color(NSColor.windowBackgroundColor))
            .cornerRadius(8)
        }
        .padding(.horizontal)
    }

    private func shortenPath(_ path: String) -> String {
        let components = path.split(separator: "/")
        if components.count > 3 {
            return ".../" + components.suffix(3).joined(separator: "/")
        }
        return path
    }
}

// MARK: - Tool Row

struct ToolRow: View {
    let name: String
    let description: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "wrench.and.screwdriver")
                .foregroundColor(.purple)
                .font(.system(size: 8))
            Text(name)
                .font(.system(size: 9, design: .monospaced))
                .foregroundColor(.primary)
            Spacer()
        }
        .help(description)
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
        .padding(.horizontal)
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
        .padding(.horizontal)
        .sheet(isPresented: $showManagerSheet) {
            QuickActionsManagerSheet(
                quickActionManager: quickActionManager,
                onDismiss: { showManagerSheet = false }
            )
        }
    }
}

#Preview {
    SidebarView(manager: SessionManager())
}
