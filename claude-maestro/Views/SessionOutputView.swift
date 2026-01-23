//
//  SessionOutputView.swift
//  claude-maestro
//
//  Individual session output view with log streaming
//

import SwiftUI

// MARK: - Session Output View

struct SessionOutputView: View {
    let sessionId: Int
    let isRunning: Bool
    @ObservedObject var coordinator: ManagedProcessCoordinator

    @State private var logs: [LogEntry] = []
    @State private var isExpanded = true
    @State private var autoScroll = true
    @State private var filterStream: LogStream? = nil
    @State private var refreshTimer: Timer?

    private let logManager = NativeLogManager()
    private let maxLogLines = 100

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            sessionHeader

            // Content (when expanded)
            if isExpanded {
                VStack(spacing: 0) {
                    // Filter bar
                    filterBar

                    Divider()

                    // Log content
                    logContent
                }
                .background(Color(red: 0.08, green: 0.08, blue: 0.1))
                .cornerRadius(6)
            }
        }
        .background(Color(NSColor.windowBackgroundColor))
        .cornerRadius(8)
        .onAppear {
            startRefreshing()
        }
        .onDisappear {
            stopRefreshing()
        }
    }

    // MARK: - Header

    private var sessionHeader: some View {
        HStack(spacing: 8) {
            // Expand/collapse
            Button {
                withAnimation(.easeInOut(duration: 0.15)) {
                    isExpanded.toggle()
                }
            } label: {
                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .frame(width: 12)
            }
            .buttonStyle(.plain)

            // Session color indicator
            Circle()
                .fill(SessionColors.color(for: sessionId))
                .frame(width: 10, height: 10)

            // Session ID
            Text("Session #\(sessionId)")
                .font(.caption)
                .fontWeight(.medium)

            // Status indicator
            if isRunning {
                HStack(spacing: 2) {
                    Circle()
                        .fill(Color.green)
                        .frame(width: 6, height: 6)
                    Text("Running")
                        .font(.caption2)
                        .foregroundColor(.green)
                }
            } else {
                Text("Stopped")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            Spacer()

            // Auto-scroll toggle
            if isExpanded {
                Button {
                    autoScroll.toggle()
                } label: {
                    Image(systemName: autoScroll ? "arrow.down.to.line" : "arrow.down.to.line.compact")
                        .font(.caption2)
                        .foregroundColor(autoScroll ? .accentColor : .secondary)
                }
                .buttonStyle(.plain)
                .help(autoScroll ? "Auto-scroll enabled" : "Auto-scroll disabled")

                // Clear logs
                Button {
                    Task {
                        await logManager.clearLogs(sessionId: sessionId)
                        logs = []
                    }
                } label: {
                    Image(systemName: "trash")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
                .help("Clear logs")
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
    }

    // MARK: - Filter Bar

    private var filterBar: some View {
        HStack(spacing: 8) {
            // Stream filter buttons
            ForEach([nil] + LogStream.allCases, id: \.self) { stream in
                Button {
                    filterStream = stream
                } label: {
                    HStack(spacing: 2) {
                        if let stream = stream {
                            Circle()
                                .fill(streamColor(stream))
                                .frame(width: 6, height: 6)
                            Text(stream.rawValue)
                                .font(.system(size: 9, design: .monospaced))
                        } else {
                            Text("All")
                                .font(.system(size: 9, design: .monospaced))
                        }
                    }
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(
                        RoundedRectangle(cornerRadius: 3)
                            .fill(filterStream == stream ? Color.accentColor.opacity(0.2) : Color.clear)
                    )
                    .foregroundColor(filterStream == stream ? .accentColor : .secondary)
                }
                .buttonStyle(.plain)
            }

            Spacer()

            // Line count
            Text("\(filteredLogs.count) lines")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color(NSColor.controlBackgroundColor).opacity(0.5))
    }

    // MARK: - Log Content

    private var logContent: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(filteredLogs) { entry in
                        LogEntryRow(entry: entry)
                            .id(entry.id)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
            }
            .frame(height: 120)
            .onChange(of: logs.count) { _, _ in
                if autoScroll, let lastEntry = filteredLogs.last {
                    withAnimation(.easeOut(duration: 0.1)) {
                        proxy.scrollTo(lastEntry.id, anchor: .bottom)
                    }
                }
            }
        }
    }

    // MARK: - Helpers

    private var filteredLogs: [LogEntry] {
        guard let filter = filterStream else { return logs }
        return logs.filter { $0.stream == filter }
    }

    private func streamColor(_ stream: LogStream) -> Color {
        switch stream {
        case .stdout: return .green
        case .stderr: return .red
        case .system: return .blue
        }
    }

    private func startRefreshing() {
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
            Task { @MainActor in
                await refreshLogs()
            }
        }
        // Initial load
        Task {
            await refreshLogs()
        }
    }

    private func stopRefreshing() {
        refreshTimer?.invalidate()
        refreshTimer = nil
    }

    private func refreshLogs() async {
        let newLogs = await logManager.getLogs(sessionId: sessionId, count: maxLogLines)
        if newLogs.count != logs.count {
            logs = newLogs
        }
    }
}

// MARK: - Log Entry Row

struct LogEntryRow: View {
    let entry: LogEntry

    var body: some View {
        HStack(alignment: .top, spacing: 4) {
            // Timestamp
            Text(formattedTime)
                .font(.system(size: 9, design: .monospaced))
                .foregroundColor(.secondary.opacity(0.7))

            // Stream indicator
            Text("[\(entry.stream.rawValue)]")
                .font(.system(size: 9, design: .monospaced))
                .foregroundColor(streamColor)
                .frame(width: 30, alignment: .leading)

            // Content
            Text(entry.content)
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.white.opacity(0.9))
                .textSelection(.enabled)
                .lineLimit(nil)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 1)
    }

    private var formattedTime: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: entry.timestamp)
    }

    private var streamColor: Color {
        switch entry.stream {
        case .stdout: return .green
        case .stderr: return .red
        case .system: return .blue
        }
    }
}

// MARK: - Preview

#Preview {
    SessionOutputView(
        sessionId: 1,
        isRunning: true,
        coordinator: ManagedProcessCoordinator()
    )
    .frame(width: 240)
}
