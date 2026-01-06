//
//  SidebarView.swift
//  claude-maestro
//
//  Configuration sidebar for terminal management
//

import SwiftUI
import AppKit

struct SidebarView: View {
    @ObservedObject var manager: SessionManager

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header with multi-select toggle
            HStack {
                Text("Configuration")
                    .font(.headline)

                Spacer()

                // Multi-select toggle
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
                .disabled(manager.isRunning)
            }
            .padding(.horizontal)

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    // Presets Section
                    PresetSelector(manager: manager)
                        .disabled(manager.isRunning)

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
                        .disabled(manager.isRunning)

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
                            .disabled(manager.isRunning)

                            Button("Apply Default") {
                                manager.applyDefaultModeToAll()
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .disabled(manager.isRunning)
                        }
                        .font(.caption)
                    }
                    .padding(.horizontal)

                    Divider()
                        .padding(.horizontal)

                    // Git Repository Info Section
                    GitInfoSection(gitManager: manager.gitManager)

                    Divider()
                        .padding(.horizontal)

                    // Batch Action Bar (when selection active)
                    if manager.selectionManager.hasSelection {
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
                }
                .padding(.bottom, 8)
            }
        }
        .padding(.vertical)
        .frame(width: 240)
        .background(Color(NSColor.controlBackgroundColor))
        .onAppear {
            manager.loadPresets()
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

// MARK: - Git Info Section

struct GitInfoSection: View {
    @ObservedObject var gitManager: GitManager

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Git Repository")
                .font(.subheadline)
                .foregroundColor(.secondary)

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

                    // Remote URLs
                    if !gitManager.remoteURLs.isEmpty {
                        Divider()

                        ForEach(Array(gitManager.remoteURLs.keys.sorted()), id: \.self) { remoteName in
                            if let url = gitManager.remoteURLs[remoteName] {
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 4) {
                                        Image(systemName: "network")
                                            .foregroundColor(.green)
                                            .font(.caption2)
                                        Text(remoteName)
                                            .font(.caption)
                                            .fontWeight(.medium)
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

#Preview {
    SidebarView(manager: SessionManager())
}
