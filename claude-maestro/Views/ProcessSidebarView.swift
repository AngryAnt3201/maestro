//
//  ProcessSidebarView.swift
//  claude-maestro
//
//  Processes sidebar tab showing process tree and output streams
//

import SwiftUI
import AppKit

// MARK: - Session Color Palette

struct SessionColors {
    static let palette: [Color] = [
        .blue, .green, .orange, .purple, .pink,
        .cyan, .yellow, .red, .indigo, .mint,
        .teal, .brown
    ]

    static func color(for sessionId: Int) -> Color {
        palette[sessionId % palette.count]
    }
}

// MARK: - Process Sidebar View

struct ProcessSidebarView: View {
    @ObservedObject var manager: SessionManager
    @StateObject private var coordinator = ManagedProcessCoordinator()
    @StateObject private var activityMonitor = ProcessActivityMonitor()
    @State private var isAgentSessionsExpanded = true
    @State private var isProcessTreeExpanded = true
    @State private var selectedSessionIds: Set<Int> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack {
                Text("Processes")
                    .font(.headline)

                Spacer()

                // Refresh button
                Button {
                    Task {
                        await refreshAll()
                    }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
                .help("Refresh")
            }
            .padding(.horizontal)
            .padding(.vertical, 8)

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Agent Sessions Section (AI agents: Claude/Gemini/Codex)
                    AgentProcessesSection(
                        manager: manager,
                        activityMonitor: activityMonitor,
                        isExpanded: $isAgentSessionsExpanded
                    )

                    Divider()
                        .padding(.horizontal)

                    // Dev Server Process Tree Section
                    ProcessTreeSection(
                        coordinator: coordinator,
                        isExpanded: $isProcessTreeExpanded
                    )

                    Divider()
                        .padding(.horizontal)

                    // Output Streams Section
                    OutputStreamsSection(
                        manager: manager,
                        coordinator: coordinator,
                        selectedSessionIds: $selectedSessionIds
                    )

                    Divider()
                        .padding(.horizontal)

                    // Orphaned Processes Section (for cleanup)
                    OrphanedProcessesSection(
                        processRegistry: manager.processRegistry
                    )
                }
                .padding(.vertical, 12)
            }
        }
    }

    private func refreshAll() async {
        // Trigger a refresh of the process coordinator
        // The coordinator auto-refreshes, but we can trigger manually
    }
}

// MARK: - Process Tree Section

struct ProcessTreeSection: View {
    @ObservedObject var coordinator: ManagedProcessCoordinator
    @Binding var isExpanded: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header
            HStack {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        isExpanded.toggle()
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .frame(width: 12)

                        Text("Process Tree")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                }
                .buttonStyle(.plain)

                Spacer()

                // Process count badge
                if !coordinator.processes.isEmpty {
                    Text("\(coordinator.processes.count)")
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.green)
                        .foregroundColor(.white)
                        .clipShape(Capsule())
                }
            }

            if isExpanded {
                VStack(spacing: 0) {
                    if coordinator.processes.isEmpty {
                        // Empty state
                        HStack {
                            Image(systemName: "cpu")
                                .foregroundColor(.secondary)
                                .font(.caption)
                            Text("No running processes")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                    } else {
                        // Compact process list
                        VStack(spacing: 6) {
                            ForEach(Array(coordinator.processes.values).sorted(by: { $0.sessionId < $1.sessionId })) { process in
                                CompactProcessRow(process: process, coordinator: coordinator)
                            }
                        }
                        .padding(10)
                    }
                }
                .background(Color(NSColor.windowBackgroundColor))
                .cornerRadius(8)
            }
        }
        .padding(.horizontal)
    }
}

// MARK: - Compact Process Row

struct CompactProcessRow: View {
    let process: ManagedProcess
    @ObservedObject var coordinator: ManagedProcessCoordinator
    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 6) {
            // Session color indicator
            Circle()
                .fill(SessionColors.color(for: process.sessionId))
                .frame(width: 8, height: 8)

            // Session ID
            Text("#\(process.sessionId)")
                .font(.caption)
                .fontWeight(.medium)

            // Status
            Text(process.status.rawValue)
                .font(.caption2)
                .foregroundColor(statusColor)
                .padding(.horizontal, 4)
                .background(statusColor.opacity(0.15))
                .cornerRadius(3)

            Spacer()

            // Port badge
            if let port = process.port {
                Text(":\(port)")
                    .font(.caption2)
                    .foregroundColor(.green)
                    .padding(.horizontal, 3)
                    .background(Color.green.opacity(0.15))
                    .cornerRadius(3)
            }

            // Actions on hover
            if isHovered {
                HStack(spacing: 4) {
                    // Open in browser
                    if let url = process.serverURL {
                        Button {
                            if let nsUrl = URL(string: url) {
                                NSWorkspace.shared.open(nsUrl)
                            }
                        } label: {
                            Image(systemName: "safari")
                                .font(.caption2)
                                .foregroundColor(.blue)
                        }
                        .buttonStyle(.plain)
                        .help("Open in browser")
                    }

                    // Restart
                    Button {
                        Task {
                            try? await coordinator.restartDevServer(sessionId: process.sessionId)
                        }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.plain)
                    .help("Restart")

                    // Stop
                    Button {
                        Task {
                            try? await coordinator.stopDevServer(sessionId: process.sessionId)
                        }
                    } label: {
                        Image(systemName: "xmark.circle")
                            .font(.caption2)
                            .foregroundColor(.red.opacity(0.7))
                    }
                    .buttonStyle(.plain)
                    .help("Stop")
                }
            }
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 8)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(isHovered ? Color(NSColor.selectedContentBackgroundColor).opacity(0.3) : Color.clear)
        )
        .contentShape(Rectangle())
        .onHover { isHovered = $0 }
    }

    private var statusColor: Color {
        switch process.status {
        case .starting: return .yellow
        case .running: return .green
        case .stopping: return .orange
        case .stopped: return .gray
        case .error: return .red
        }
    }
}

// MARK: - Agent Processes Section

struct AgentProcessesSection: View {
    @ObservedObject var manager: SessionManager
    @ObservedObject var activityMonitor: ProcessActivityMonitor
    @Binding var isExpanded: Bool

    // Filter to only show launched terminal sessions
    private var launchedSessions: [SessionInfo] {
        manager.sessions.filter { $0.isTerminalLaunched && $0.isVisible }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header
            HStack {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        isExpanded.toggle()
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .frame(width: 12)

                        Text("Agent Sessions")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                }
                .buttonStyle(.plain)

                Spacer()

                // Session count badge
                if !launchedSessions.isEmpty {
                    Text("\(launchedSessions.count)")
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.purple)
                        .foregroundColor(.white)
                        .clipShape(Capsule())
                }
            }

            if isExpanded {
                VStack(spacing: 0) {
                    if launchedSessions.isEmpty {
                        // Empty state
                        HStack {
                            Image(systemName: "brain")
                                .foregroundColor(.secondary)
                                .font(.caption)
                            Text("No agent sessions running")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                    } else {
                        // Agent session list
                        VStack(spacing: 6) {
                            ForEach(launchedSessions) { session in
                                AgentProcessRow(
                                    session: session,
                                    activityMonitor: activityMonitor
                                )
                            }
                        }
                        .padding(10)
                    }
                }
                .background(Color(NSColor.windowBackgroundColor))
                .cornerRadius(8)
            }
        }
        .padding(.horizontal)
    }
}

// MARK: - Agent Process Row

struct AgentProcessRow: View {
    let session: SessionInfo
    @ObservedObject var activityMonitor: ProcessActivityMonitor
    @State private var isHovered = false

    private var activityLevel: ActivityLevel {
        guard let pid = session.terminalPid else { return .unknown }
        return activityMonitor.getActivityLevel(for: pid)
    }

    var body: some View {
        HStack(spacing: 6) {
            // Session color indicator with pulse for active
            ZStack {
                Circle()
                    .fill(SessionColors.color(for: session.id))
                    .frame(width: 8, height: 8)

                // Activity pulse ring
                if activityLevel == .active {
                    Circle()
                        .stroke(SessionColors.color(for: session.id).opacity(0.5), lineWidth: 2)
                        .frame(width: 12, height: 12)
                        .scaleEffect(1.2)
                        .opacity(0.6)
                }
            }
            .frame(width: 14, height: 14)

            // Session ID
            Text("#\(session.id)")
                .font(.caption)
                .fontWeight(.medium)

            // Agent type icon + label
            HStack(spacing: 2) {
                Image(systemName: session.mode.icon)
                    .font(.caption2)
                    .foregroundColor(session.mode.color)
                Text(shortModeName(session.mode))
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            Spacer()

            // Status badge
            HStack(spacing: 3) {
                Circle()
                    .fill(session.status.color)
                    .frame(width: 6, height: 6)
                Text(session.status.label)
                    .font(.caption2)
                    .foregroundColor(session.status.color)
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 2)
            .background(session.status.color.opacity(0.1))
            .cornerRadius(3)

            // PID badge (if available)
            if let pid = session.terminalPid {
                Text("PID:\(pid)")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 3)
                    .background(Color.secondary.opacity(0.1))
                    .cornerRadius(3)
            }

            // Activity indicator
            if activityLevel == .active {
                Image(systemName: "bolt.fill")
                    .font(.caption2)
                    .foregroundColor(.yellow)
                    .help("Active CPU/IO")
            }
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 8)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(isHovered ? Color(NSColor.selectedContentBackgroundColor).opacity(0.3) : Color.clear)
        )
        .contentShape(Rectangle())
        .onHover { isHovered = $0 }
    }

    private func shortModeName(_ mode: TerminalMode) -> String {
        switch mode {
        case .claudeCode: return "Claude"
        case .geminiCli: return "Gemini"
        case .openAiCodex: return "Codex"
        case .plainTerminal: return "Shell"
        }
    }
}

// MARK: - Orphaned Processes Section

struct OrphanedProcessesSection: View {
    let processRegistry: ProcessRegistry
    @State private var orphanedProcesses: [ProcessInfo] = []
    @State private var isExpanded = true
    @State private var isLoading = false
    @State private var isTerminating = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header
            HStack {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        isExpanded.toggle()
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .frame(width: 12)

                        Text("Orphaned Processes")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                }
                .buttonStyle(.plain)

                Spacer()

                // Orphan count badge (warning color if > 0)
                if !orphanedProcesses.isEmpty {
                    Text("\(orphanedProcesses.count)")
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.orange)
                        .foregroundColor(.white)
                        .clipShape(Capsule())
                }

                // Refresh button
                Button {
                    Task { await refreshOrphans() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
                .disabled(isLoading)
            }

            if isExpanded {
                VStack(spacing: 0) {
                    if isLoading {
                        HStack {
                            ProgressView()
                                .scaleEffect(0.7)
                            Text("Scanning...")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                    } else if orphanedProcesses.isEmpty {
                        // Empty state - all good!
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                                .font(.caption)
                            Text("No orphaned processes")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                    } else {
                        // Orphan list
                        VStack(spacing: 6) {
                            // Terminate All button
                            Button {
                                Task { await terminateAll() }
                            } label: {
                                HStack {
                                    Image(systemName: "xmark.circle.fill")
                                    Text("Terminate All (\(orphanedProcesses.count))")
                                }
                                .font(.caption)
                                .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.orange)
                            .controlSize(.small)
                            .disabled(isTerminating)

                            Divider()
                                .padding(.vertical, 4)

                            // Individual orphan rows
                            ForEach(orphanedProcesses) { process in
                                OrphanedProcessRow(
                                    process: process,
                                    onTerminate: { await terminateProcess(process.pid) }
                                )
                            }
                        }
                        .padding(10)
                    }
                }
                .background(Color(NSColor.windowBackgroundColor))
                .cornerRadius(8)
            }
        }
        .padding(.horizontal)
        .onAppear {
            Task { await refreshOrphans() }
        }
    }

    private func refreshOrphans() async {
        isLoading = true
        orphanedProcesses = await processRegistry.findOrphanedAgentProcesses()
        isLoading = false
    }

    private func terminateAll() async {
        isTerminating = true
        _ = await processRegistry.terminateOrphanedAgentProcesses()
        // Wait a moment then refresh
        try? await Task.sleep(nanoseconds: 500_000_000)
        await refreshOrphans()
        isTerminating = false
    }

    private func terminateProcess(_ pid: pid_t) async {
        _ = processRegistry.terminateOrphanedProcess(pid: pid)
        // Wait a moment then refresh
        try? await Task.sleep(nanoseconds: 500_000_000)
        await refreshOrphans()
    }
}

// MARK: - Orphaned Process Row

struct OrphanedProcessRow: View {
    let process: ProcessInfo
    let onTerminate: () async -> Void
    @State private var isHovered = false
    @State private var isTerminating = false

    var body: some View {
        HStack(spacing: 6) {
            // Warning indicator
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(.orange)
                .font(.caption2)

            // Process name
            Text(process.displayName)
                .font(.caption)
                .fontWeight(.medium)

            // PID
            Text("PID:\(process.pid)")
                .font(.system(size: 9, design: .monospaced))
                .foregroundColor(.secondary)
                .padding(.horizontal, 3)
                .background(Color.secondary.opacity(0.1))
                .cornerRadius(3)

            Spacer()

            // Start time (if available)
            if let startTime = process.startTime {
                Text(formatStartTime(startTime))
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            // Terminate button (on hover or always visible)
            if isHovered || isTerminating {
                Button {
                    Task {
                        isTerminating = true
                        await onTerminate()
                        isTerminating = false
                    }
                } label: {
                    if isTerminating {
                        ProgressView()
                            .scaleEffect(0.5)
                            .frame(width: 12, height: 12)
                    } else {
                        Image(systemName: "xmark.circle")
                            .font(.caption2)
                            .foregroundColor(.red.opacity(0.7))
                    }
                }
                .buttonStyle(.plain)
                .help("Terminate this process")
                .disabled(isTerminating)
            }
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 8)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(isHovered ? Color.orange.opacity(0.1) : Color.clear)
        )
        .contentShape(Rectangle())
        .onHover { isHovered = $0 }
    }

    private func formatStartTime(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}
