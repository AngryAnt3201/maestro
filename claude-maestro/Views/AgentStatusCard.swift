//
//  AgentStatusCard.swift
//  claude-maestro
//
//  UI component for displaying agent status from MaestroStateMonitor
//

import SwiftUI
import AppKit

// MARK: - Agent Status Card

struct AgentStatusCard: View {
    let session: SessionInfo
    let agentState: AgentState?
    @State private var isHovered = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // Main row
            HStack(spacing: 6) {
                // Session color indicator
                Circle()
                    .fill(SessionColors.color(for: session.id))
                    .frame(width: 8, height: 8)

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

                // Status pill
                if let state = agentState {
                    StatusPill(state: state.state)
                } else {
                    // Fallback to session status when no MCP state
                    StatusPill(sessionStatus: session.status)
                }

                // PID badge (if available)
                if let pid = session.terminalPid {
                    Text("PID:\(pid)")
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 3)
                        .background(Color.secondary.opacity(0.1))
                        .cornerRadius(3)
                }
            }

            // Message line (only if we have agent state with a non-empty message)
            if let state = agentState, !state.message.isEmpty {
                Text(state.message)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
                    .padding(.leading, 14) // Align with content after indicator
            }

            // Needs input prompt (when agent is waiting for input)
            if let state = agentState, state.state == .needsInput, let prompt = state.needsInputPrompt {
                HStack(spacing: 4) {
                    Image(systemName: "questionmark.circle.fill")
                        .foregroundColor(.orange)
                        .font(.caption2)
                    Text(prompt)
                        .font(.caption2)
                        .foregroundColor(.orange)
                        .lineLimit(2)
                }
                .padding(.leading, 14)
                .padding(.top, 2)
            }
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 8)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(isHovered ? Color(NSColor.selectedContentBackgroundColor).opacity(0.3) : Color.clear)
        )
        .overlay(
            // Orange border when needs input
            RoundedRectangle(cornerRadius: 6)
                .stroke(needsInputBorderColor, lineWidth: needsInputBorderWidth)
        )
        .contentShape(Rectangle())
        .onHover { isHovered = $0 }
    }

    private var needsInputBorderColor: Color {
        if let state = agentState, state.state == .needsInput {
            return .orange
        }
        return .clear
    }

    private var needsInputBorderWidth: CGFloat {
        if let state = agentState, state.state == .needsInput {
            return 1.5
        }
        return 0
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

// MARK: - Status Pill

struct StatusPill: View {
    let state: AgentStatusState?
    let sessionStatus: SessionStatus?

    init(state: AgentStatusState) {
        self.state = state
        self.sessionStatus = nil
    }

    init(sessionStatus: SessionStatus) {
        self.state = nil
        self.sessionStatus = sessionStatus
    }

    var body: some View {
        HStack(spacing: 3) {
            Circle()
                .fill(pillColor)
                .frame(width: 6, height: 6)
            Text(pillLabel)
                .font(.caption2)
                .foregroundColor(pillColor)
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 2)
        .background(pillColor.opacity(0.1))
        .cornerRadius(3)
    }

    private var pillColor: Color {
        if let state = state {
            return colorForAgentState(state)
        } else if let sessionStatus = sessionStatus {
            return sessionStatus.color
        }
        return .gray
    }

    private var pillLabel: String {
        if let state = state {
            return state.displayName
        } else if let sessionStatus = sessionStatus {
            return sessionStatus.label
        }
        return "Unknown"
    }

    private func colorForAgentState(_ state: AgentStatusState) -> Color {
        switch state {
        case .idle: return .gray
        case .working: return .blue
        case .needsInput: return .orange
        case .finished: return .green
        case .error: return .red
        }
    }
}

// MARK: - Agent Status Section (replacement for AgentProcessesSection)

struct AgentStatusSection: View {
    @ObservedObject var manager: SessionManager
    @ObservedObject var stateMonitor: MaestroStateMonitor
    @Binding var isExpanded: Bool

    // Filter to only show launched AI agent sessions (exclude plain terminals)
    private var launchedSessions: [SessionInfo] {
        manager.sessions.filter { $0.isTerminalLaunched && $0.isVisible && $0.mode.isAIMode }
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

                // Needs input indicator
                if hasAgentNeedingInput {
                    HStack(spacing: 2) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundColor(.orange)
                            .font(.caption2)
                        Text("Input")
                            .font(.caption2)
                            .foregroundColor(.orange)
                    }
                    .padding(.horizontal, 4)
                    .padding(.vertical, 2)
                    .background(Color.orange.opacity(0.15))
                    .cornerRadius(3)
                }

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
                                AgentStatusCard(
                                    session: session,
                                    agentState: stateMonitor.agentState(forSessionId: session.id)
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

    private var hasAgentNeedingInput: Bool {
        launchedSessions.contains { session in
            stateMonitor.agentState(forSessionId: session.id)?.needsInput == true
        }
    }
}
