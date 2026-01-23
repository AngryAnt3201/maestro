//
//  OutputStreamsSection.swift
//  claude-maestro
//
//  Output streams section showing vertically stacked session outputs
//

import SwiftUI

// MARK: - Output Streams Section

struct OutputStreamsSection: View {
    @ObservedObject var manager: SessionManager
    @ObservedObject var coordinator: ManagedProcessCoordinator
    @Binding var selectedSessionIds: Set<Int>

    @State private var showAllSessions = true

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header with session filter
            HStack {
                Text("Output Streams")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                Spacer()

                // Toggle all sessions
                Button {
                    showAllSessions.toggle()
                    if showAllSessions {
                        selectedSessionIds = Set(manager.sessions.map { $0.id })
                    } else {
                        selectedSessionIds = Set(coordinator.processes.keys)
                    }
                } label: {
                    Image(systemName: showAllSessions ? "eye" : "eye.slash")
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
                .help(showAllSessions ? "Show running only" : "Show all sessions")
            }

            // Session tab buttons (horizontal scroll)
            SessionTabBar(
                sessions: manager.sessions,
                runningSessionIds: Set(coordinator.processes.keys),
                selectedSessionIds: $selectedSessionIds
            )

            // Vertically stacked output views
            VStack(spacing: 8) {
                let sessionsToShow = showAllSessions
                    ? manager.sessions
                    : manager.sessions.filter { coordinator.processes[$0.id] != nil }

                if sessionsToShow.isEmpty {
                    // Empty state
                    HStack {
                        Image(systemName: "text.alignleft")
                            .foregroundColor(.secondary)
                            .font(.caption)
                        Text("No active output")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(Color(NSColor.windowBackgroundColor))
                    .cornerRadius(8)
                } else {
                    ForEach(sessionsToShow.filter { selectedSessionIds.contains($0.id) }) { session in
                        SessionOutputView(
                            sessionId: session.id,
                            isRunning: coordinator.processes[session.id] != nil,
                            coordinator: coordinator
                        )
                    }
                }
            }
        }
        .padding(.horizontal)
        .onAppear {
            // Initialize with all running sessions selected
            selectedSessionIds = Set(coordinator.processes.keys)
        }
    }
}

// MARK: - Session Tab Bar

struct SessionTabBar: View {
    let sessions: [SessionInfo]
    let runningSessionIds: Set<Int>
    @Binding var selectedSessionIds: Set<Int>

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(sessions) { session in
                    SessionTabButton(
                        sessionId: session.id,
                        isRunning: runningSessionIds.contains(session.id),
                        isSelected: selectedSessionIds.contains(session.id),
                        onToggle: {
                            if selectedSessionIds.contains(session.id) {
                                selectedSessionIds.remove(session.id)
                            } else {
                                selectedSessionIds.insert(session.id)
                            }
                        }
                    )
                }
            }
            .padding(.vertical, 2)
        }
    }
}

// MARK: - Session Tab Button

struct SessionTabButton: View {
    let sessionId: Int
    let isRunning: Bool
    let isSelected: Bool
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 4) {
                // Color indicator
                Circle()
                    .fill(SessionColors.color(for: sessionId))
                    .frame(width: 6, height: 6)

                // Session number
                Text("#\(sessionId)")
                    .font(.caption2)
                    .fontWeight(.medium)

                // Running indicator
                if isRunning {
                    Circle()
                        .fill(Color.green)
                        .frame(width: 4, height: 4)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .fill(isSelected
                        ? SessionColors.color(for: sessionId).opacity(0.2)
                        : Color(NSColor.controlBackgroundColor))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 4)
                    .stroke(isSelected ? SessionColors.color(for: sessionId) : Color.clear, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}
