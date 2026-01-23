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
            .padding(.top, 12)

            Divider()
                .padding(.top, 8)

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    // Process Tree Section
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
                }
                .padding(.bottom, 8)
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
        VStack(alignment: .leading, spacing: 8) {
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
                        VStack(spacing: 4) {
                            ForEach(Array(coordinator.processes.values).sorted(by: { $0.sessionId < $1.sessionId })) { process in
                                CompactProcessRow(process: process, coordinator: coordinator)
                            }
                        }
                        .padding(8)
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
        .padding(.vertical, 4)
        .padding(.horizontal, 6)
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
