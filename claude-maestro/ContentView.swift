//
//  ContentView.swift
//  claude-maestro
//
//  Created by Jack Wakem on 6/1/2026.
//

import SwiftUI
import AppKit
import Combine

// MARK: - Terminal Mode

enum TerminalMode: String, CaseIterable, Codable {
    case claudeCode = "Claude Code"
    case geminiCli = "Gemini CLI"
    case openAiCodex = "OpenAI Codex"
    case plainTerminal = "Plain Terminal"

    var icon: String {
        switch self {
        case .claudeCode: return "brain"
        case .geminiCli: return "sparkles"
        case .openAiCodex: return "cpu"
        case .plainTerminal: return "terminal"
        }
    }

    var color: Color {
        switch self {
        case .claudeCode: return .purple
        case .geminiCli: return .blue
        case .openAiCodex: return .green
        case .plainTerminal: return .gray
        }
    }

    var command: String? {
        switch self {
        case .claudeCode: return "claude"
        case .geminiCli: return "gemini"
        case .openAiCodex: return "codex"
        case .plainTerminal: return nil
        }
    }

    var isAIMode: Bool {
        return self != .plainTerminal
    }
}

// MARK: - Grid Configuration

struct GridConfiguration {
    let rows: Int
    let columns: Int

    static func optimal(for count: Int) -> GridConfiguration {
        switch count {
        case 1: return GridConfiguration(rows: 1, columns: 1)
        case 2: return GridConfiguration(rows: 1, columns: 2)
        case 3: return GridConfiguration(rows: 1, columns: 3)
        case 4: return GridConfiguration(rows: 2, columns: 2)
        case 5, 6: return GridConfiguration(rows: 2, columns: 3)
        case 7, 8: return GridConfiguration(rows: 2, columns: 4)
        case 9: return GridConfiguration(rows: 3, columns: 3)
        case 10, 11, 12: return GridConfiguration(rows: 3, columns: 4)
        default: return GridConfiguration(rows: 2, columns: 3)
        }
    }
}

// MARK: - Session Status

enum SessionStatus: String, CaseIterable, Codable {
    case initializing = "initializing"
    case idle = "idle"
    case working = "working"
    case waiting = "waiting"
    case done = "done"
    case error = "error"

    var color: Color {
        switch self {
        case .initializing: return .orange
        case .idle: return .gray
        case .working: return .blue
        case .waiting: return .yellow
        case .done: return .green
        case .error: return .red
        }
    }

    var icon: String {
        switch self {
        case .initializing: return "hourglass"
        case .idle: return "circle.fill"
        case .working: return "arrow.triangle.2.circlepath"
        case .waiting: return "exclamationmark.circle.fill"
        case .done: return "checkmark.circle.fill"
        case .error: return "xmark.circle.fill"
        }
    }

    var label: String {
        switch self {
        case .initializing: return "Starting..."
        case .idle: return "Idle"
        case .working: return "Working"
        case .waiting: return "Needs Input"
        case .done: return "Done"
        case .error: return "Error"
        }
    }
}

// MARK: - Session Info

struct SessionInfo: Identifiable {
    var id: Int
    var status: SessionStatus = .idle
    var mode: TerminalMode = .claudeCode
    var assignedBranch: String? = nil
    var currentBranch: String? = nil
    var shouldLaunchTerminal: Bool = false  // per-session launch trigger
    var isTerminalLaunched: Bool = false    // shell is running
    var isClaudeRunning: Bool = false       // claude command has been launched
    var isVisible: Bool = true              // terminal is open (not closed)

    init(id: Int, mode: TerminalMode = .claudeCode) {
        self.id = id
        self.mode = mode
    }
}

// MARK: - Persistable Session (for UserDefaults storage)

struct PersistableSession: Codable {
    let id: Int
    var mode: TerminalMode
    var assignedBranch: String?

    init(from session: SessionInfo) {
        self.id = session.id
        self.mode = session.mode
        self.assignedBranch = session.assignedBranch
    }
}

// MARK: - Selection Manager

class SelectionManager: ObservableObject {
    @Published var selectedSessionIds: Set<Int> = []
    @Published var isMultiSelectMode: Bool = false

    var hasSelection: Bool {
        !selectedSessionIds.isEmpty
    }

    var selectionCount: Int {
        selectedSessionIds.count
    }

    func toggleSelection(for sessionId: Int) {
        if selectedSessionIds.contains(sessionId) {
            selectedSessionIds.remove(sessionId)
        } else {
            selectedSessionIds.insert(sessionId)
        }
    }

    func selectAll(sessions: [SessionInfo]) {
        selectedSessionIds = Set(sessions.map { $0.id })
    }

    func clearSelection() {
        selectedSessionIds.removeAll()
    }

    func isSelected(_ sessionId: Int) -> Bool {
        selectedSessionIds.contains(sessionId)
    }
}

// MARK: - Session Manager

class SessionManager: ObservableObject {
    @Published var sessions: [SessionInfo] = (1...6).map { SessionInfo(id: $0) }
    @Published var projectPath: String = ""
    @Published var isRunning: Bool = false
    @Published var terminalCount: Int = 6 {
        didSet {
            updateSessionsCount()
            persistSessions()
        }
    }
    @Published var defaultMode: TerminalMode = .claudeCode
    @Published var gitManager = GitManager()

    // Selection management
    @Published var selectionManager = SelectionManager()

    // Template presets
    @Published var savedPresets: [TemplatePreset] = []
    @Published var currentPresetId: UUID? = nil

    init() {
        loadPresets()
        loadSessions()
    }

    var gridConfig: GridConfiguration {
        GridConfiguration.optimal(for: terminalCount)
    }

    func setProjectPath(_ path: String) async {
        await MainActor.run {
            projectPath = path
        }
        await gitManager.setRepository(path: path)
    }

    var claudeCodeCount: Int {
        sessions.filter { $0.mode == .claudeCode }.count
    }

    var geminiCliCount: Int {
        sessions.filter { $0.mode == .geminiCli }.count
    }

    var openAiCodexCount: Int {
        sessions.filter { $0.mode == .openAiCodex }.count
    }

    var plainTerminalCount: Int {
        sessions.filter { $0.mode == .plainTerminal }.count
    }

    var aiToolCount: Int {
        sessions.filter { $0.mode.isAIMode }.count
    }

    var statusSummary: [SessionStatus: Int] {
        Dictionary(grouping: sessions, by: { $0.status })
            .mapValues { $0.count }
    }

    var activeSessionBranches: [String: Int] {
        var result: [String: Int] = [:]
        for session in sessions {
            if let branch = session.assignedBranch ?? session.currentBranch {
                result[branch] = session.id
            }
        }
        return result
    }

    func updateSessionsCount() {
        let currentCount = sessions.count
        if terminalCount > currentCount {
            // Add new sessions - they start in pending state (not launched)
            for i in (currentCount + 1)...terminalCount {
                sessions.append(SessionInfo(id: i, mode: defaultMode))
            }
        } else if terminalCount < currentCount && !isRunning {
            // Only allow removing sessions when not running
            sessions = Array(sessions.prefix(terminalCount))
        }
    }

    func resetSessions() {
        for i in 0..<sessions.count {
            sessions[i].status = .idle
        }
        isRunning = false
    }

    func updateStatus(for sessionId: Int, status: SessionStatus) {
        if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
            sessions[index].status = status
        }
    }

    func toggleMode(for sessionId: Int) {
        if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
            let allModes = TerminalMode.allCases
            let currentIndex = allModes.firstIndex(of: sessions[index].mode) ?? 0
            let nextIndex = (currentIndex + 1) % allModes.count
            sessions[index].mode = allModes[nextIndex]
        }
    }

    func applyDefaultModeToAll() {
        for i in 0..<sessions.count {
            sessions[i].mode = defaultMode
        }
    }

    func assignBranch(_ branch: String?, to sessionId: Int) {
        if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
            sessions[index].assignedBranch = branch
            persistSessions()
        }
    }

    func closeSession(_ sessionId: Int) {
        // Remove the session entirely
        sessions.removeAll { $0.id == sessionId }

        // Update terminal count to match (this also triggers persistSessions via didSet)
        terminalCount = sessions.count
    }

    func addNewSession() {
        let nextId = (sessions.map { $0.id }.max() ?? 0) + 1
        let newSession = SessionInfo(id: nextId, mode: defaultMode)
        sessions.append(newSession)
        terminalCount = sessions.count
        persistSessions()
    }

    func launchClaudeInSession(_ sessionId: Int) {
        if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
            sessions[index].isClaudeRunning = true
        }
    }

    func markTerminalLaunched(_ sessionId: Int) {
        if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
            sessions[index].isTerminalLaunched = true
        }
    }

    func triggerTerminalLaunch(_ sessionId: Int) {
        if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
            sessions[index].shouldLaunchTerminal = true
        }
    }

    var visibleSessions: [SessionInfo] {
        sessions.filter { $0.isVisible }
    }

    // MARK: - Safe Session Access (ID-based)

    func session(byId id: Int) -> SessionInfo? {
        sessions.first { $0.id == id }
    }

    func updateSession(id: Int, _ update: (inout SessionInfo) -> Void) {
        if let index = sessions.firstIndex(where: { $0.id == id }) {
            update(&sessions[index])
        }
    }

    // MARK: - Direct Mode Setting (replaces cycling)

    func setMode(_ mode: TerminalMode, for sessionId: Int) {
        if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
            sessions[index].mode = mode
            persistSessions()
        }
    }

    // MARK: - Batch Operations

    func setModeForSelected(_ mode: TerminalMode) {
        for sessionId in selectionManager.selectedSessionIds {
            if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
                sessions[index].mode = mode
            }
        }
        persistSessions()
    }

    func assignBranchToSelected(_ branch: String?) {
        for sessionId in selectionManager.selectedSessionIds {
            if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
                sessions[index].assignedBranch = branch
            }
        }
        persistSessions()
    }

    // MARK: - Template Preset Operations

    func applyPreset(_ preset: TemplatePreset) {
        // Reset sessions to match preset configuration
        sessions = preset.sessionConfigurations.enumerated().map { index, config in
            var session = SessionInfo(id: index + 1, mode: config.mode)
            session.assignedBranch = config.branch
            return session
        }

        // Update terminal count (will trigger persistSessions via didSet)
        terminalCount = preset.terminalCount

        currentPresetId = preset.id

        // Update last used time for saved presets
        if let idx = savedPresets.firstIndex(where: { $0.id == preset.id }) {
            savedPresets[idx].lastUsed = Date()
            persistPresets()
        }
    }

    func saveCurrentAsPreset(name: String) -> TemplatePreset {
        let configs = sessions.map { session in
            SessionConfiguration(mode: session.mode, branch: session.assignedBranch)
        }

        let preset = TemplatePreset(
            name: name,
            sessionConfigurations: configs,
            lastUsed: Date()
        )

        savedPresets.append(preset)
        persistPresets()
        return preset
    }

    func deletePreset(_ preset: TemplatePreset) {
        savedPresets.removeAll { $0.id == preset.id }
        persistPresets()
    }

    // MARK: - Persistence

    private let sessionsKey = "claude-maestro-sessions"
    private let terminalCountKey = "claude-maestro-terminalCount"

    private func persistPresets() {
        if let encoded = try? JSONEncoder().encode(savedPresets) {
            UserDefaults.standard.set(encoded, forKey: "claude-maestro-savedPresets")
        }
    }

    func loadPresets() {
        if let data = UserDefaults.standard.data(forKey: "claude-maestro-savedPresets"),
           let decoded = try? JSONDecoder().decode([TemplatePreset].self, from: data) {
            savedPresets = decoded
        }
    }

    func persistSessions() {
        // Persist session configurations (mode, branch) - not runtime state
        let persistableData = sessions.map { PersistableSession(from: $0) }
        if let encoded = try? JSONEncoder().encode(persistableData) {
            UserDefaults.standard.set(encoded, forKey: sessionsKey)
        }
        UserDefaults.standard.set(terminalCount, forKey: terminalCountKey)
    }

    func loadSessions() {
        // Load terminal count
        let savedCount = UserDefaults.standard.integer(forKey: terminalCountKey)
        if savedCount > 0 {
            terminalCount = savedCount
        }

        // Load session configurations
        if let data = UserDefaults.standard.data(forKey: sessionsKey),
           let decoded = try? JSONDecoder().decode([PersistableSession].self, from: data) {
            // Rebuild sessions array with persisted configs
            sessions = decoded.enumerated().map { index, saved in
                var session = SessionInfo(id: index + 1)
                session.mode = saved.mode
                session.assignedBranch = saved.assignedBranch
                return session
            }
            terminalCount = sessions.count
        }
    }
}

// MARK: - Content View

struct ContentView: View {
    @StateObject private var manager = SessionManager()
    @State private var statusMessage: String = "Select a directory to launch Claude Code instances"
    @State private var showBranchSidebar: Bool = false
    @State private var columnVisibility: NavigationSplitViewVisibility = .all

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            SidebarView(manager: manager)
                .navigationSplitViewColumnWidth(min: 240, ideal: 240, max: 300)
        } detail: {
            MainContentView(
                manager: manager,
                statusMessage: $statusMessage,
                showBranchSidebar: $showBranchSidebar,
                columnVisibility: $columnVisibility
            )
        }
        .navigationSplitViewStyle(.balanced)
    }
}

// MARK: - Main Content View

struct MainContentView: View {
    @ObservedObject var manager: SessionManager
    @Binding var statusMessage: String
    @Binding var showBranchSidebar: Bool
    @Binding var columnVisibility: NavigationSplitViewVisibility
    @State private var showGitSettings: Bool = false

    var body: some View {
        HStack(spacing: 0) {
            // Main content area
            VStack(spacing: 12) {
                // Header
                HStack {
                    // Left sidebar toggle
                    Button {
                        withAnimation {
                            columnVisibility = columnVisibility == .all ? .detailOnly : .all
                        }
                    } label: {
                        Image(systemName: "sidebar.left")
                    }
                    .buttonStyle(.bordered)
                    .help(columnVisibility == .all ? "Hide sidebar" : "Show sidebar")

                    // Git status indicator
                    if manager.gitManager.isGitRepo {
                        GitStatusIndicator(gitManager: manager.gitManager)
                    }

                    Spacer()

                    // Legend
                    HStack(spacing: 12) {
                        LegendItem(status: .initializing)
                        LegendItem(status: .idle)
                        LegendItem(status: .working)
                        LegendItem(status: .waiting)
                        LegendItem(status: .done)
                        LegendItem(status: .error)
                    }
                    .font(.caption2)

                    // Git controls
                    if manager.gitManager.isGitRepo {
                        HStack(spacing: 8) {
                            // Git settings button
                            Button {
                                showGitSettings = true
                            } label: {
                                Image(systemName: "gearshape")
                            }
                            .buttonStyle(.bordered)
                            .help("Git Settings")

                            // Git tree sidebar toggle
                            Button {
                                withAnimation {
                                    showBranchSidebar.toggle()
                                }
                            } label: {
                                Image(systemName: "arrow.triangle.branch")
                            }
                            .buttonStyle(.bordered)
                            .tint(showBranchSidebar ? .accentColor : nil)
                            .help(showBranchSidebar ? "Hide git tree" : "Show git tree")
                        }
                    }
                }
                .padding(.horizontal)

                if manager.isRunning {
                    // Dynamic Terminal Grid
                    DynamicTerminalGridView(manager: manager)
                } else {
                    // Pre-launch view with status indicators
                    PreLaunchView(manager: manager, statusMessage: statusMessage)
                }

                // Controls
                ControlsView(
                    manager: manager,
                    statusMessage: $statusMessage,
                    onSelectDirectory: selectDirectory,
                    onLaunch: launchGrid,
                    onReset: resetAll
                )
            }
            .padding(.top, 8)
            .frame(minWidth: 900, minHeight: 600)

            // Git tree visualization sidebar
            if showBranchSidebar && manager.gitManager.isGitRepo {
                Divider()
                GitTreeView(
                    gitManager: manager.gitManager,
                    activeSessionBranches: manager.activeSessionBranches
                )
                .frame(minWidth: 350, idealWidth: 450)
            }
        }
        .sheet(isPresented: $showGitSettings) {
            GitSettingsView(gitManager: manager.gitManager)
        }
        .toolbar(.hidden)
    }

    func selectDirectory() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.message = "Select project directory for Claude Code"

        if panel.runModal() == .OK {
            let path = panel.url?.path ?? ""
            Task {
                await manager.setProjectPath(path)
                await MainActor.run {
                    statusMessage = manager.gitManager.isGitRepo
                        ? "Git repo detected - Ready to launch!"
                        : "Ready to launch!"
                    manager.resetSessions()
                }
            }
        }
    }

    func launchGrid() {
        guard !manager.projectPath.isEmpty else { return }

        manager.isRunning = true
        for i in 0..<manager.sessions.count {
            manager.sessions[i].status = .working
        }
        statusMessage = "Running..."
    }

    func resetAll() {
        manager.resetSessions()
        statusMessage = "Stopped. Select a directory to launch again."
    }
}

// MARK: - Dynamic Terminal Grid

struct DynamicTerminalGridView: View {
    @ObservedObject var manager: SessionManager
    @State private var isHoveringAdd = false

    var body: some View {
        let visibleSessions = manager.visibleSessions
        let config = GridConfiguration.optimal(for: visibleSessions.count)

        ZStack(alignment: .bottomTrailing) {
            VStack(spacing: 8) {
                ForEach(0..<config.rows, id: \.self) { row in
                    HStack(spacing: 8) {
                        ForEach(0..<config.columns, id: \.self) { col in
                            let index = row * config.columns + col

                            if index < visibleSessions.count {
                                let session = visibleSessions[index]
                                let sessionId = session.id  // Capture stable ID, not array index

                                TerminalSessionView(
                                    session: session,
                                    workingDirectory: manager.projectPath,
                                    shouldLaunch: manager.session(byId: sessionId)?.shouldLaunchTerminal ?? false,
                                    status: Binding(
                                        get: { manager.session(byId: sessionId)?.status ?? .idle },
                                        set: { newValue in manager.updateSession(id: sessionId) { $0.status = newValue } }
                                    ),
                                    mode: Binding(
                                        get: { manager.session(byId: sessionId)?.mode ?? .claudeCode },
                                        set: { newValue in manager.updateSession(id: sessionId) { $0.mode = newValue } }
                                    ),
                                    assignedBranch: Binding(
                                        get: { manager.session(byId: sessionId)?.assignedBranch },
                                        set: { manager.assignBranch($0, to: sessionId) }
                                    ),
                                    gitManager: manager.gitManager,
                                    isTerminalLaunched: manager.session(byId: sessionId)?.isTerminalLaunched ?? false,
                                    isClaudeRunning: manager.session(byId: sessionId)?.isClaudeRunning ?? false,
                                    onLaunchClaude: { manager.launchClaudeInSession(sessionId) },
                                    onClose: { manager.closeSession(sessionId) },
                                    onTerminalLaunched: { manager.markTerminalLaunched(sessionId) },
                                    onLaunchTerminal: { manager.triggerTerminalLaunch(sessionId) }
                                )
                            } else {
                                Color.clear
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 8)

            // Floating add button
            Button(action: { manager.addNewSession() }) {
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(.white, .blue)
                    .shadow(color: .black.opacity(0.3), radius: 4, x: 0, y: 2)
                    .scaleEffect(isHoveringAdd ? 1.1 : 1.0)
            }
            .buttonStyle(.plain)
            .padding(20)
            .onHover { hovering in
                withAnimation(.easeInOut(duration: 0.15)) {
                    isHoveringAdd = hovering
                }
            }
            .help("Add new terminal")
        }
    }
}

// MARK: - Pre-Launch View

struct PreLaunchView: View {
    @ObservedObject var manager: SessionManager
    let statusMessage: String

    var body: some View {
        let config = manager.gridConfig

        VStack(spacing: 16) {
            Spacer()

            VStack(spacing: 12) {
                ForEach(0..<config.rows, id: \.self) { row in
                    HStack(spacing: 12) {
                        ForEach(0..<config.columns, id: \.self) { col in
                            let index = row * config.columns + col

                            if index < manager.sessions.count {
                                SessionStatusView(session: manager.sessions[index])
                            } else {
                                Color.clear
                                    .frame(width: 100, height: 80)
                            }
                        }
                    }
                }
            }
            .padding()
            .background(Color(NSColor.windowBackgroundColor))
            .cornerRadius(12)

            // Path display
            if !manager.projectPath.isEmpty {
                HStack {
                    Image(systemName: "folder.fill")
                        .foregroundColor(.blue)
                    Text(manager.projectPath)
                        .font(.caption)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }

            Text(statusMessage)
                .foregroundColor(.secondary)
                .font(.caption)

            Spacer()
        }
    }
}

// MARK: - Controls View

struct ControlsView: View {
    @ObservedObject var manager: SessionManager
    @Binding var statusMessage: String
    let onSelectDirectory: () -> Void
    let onLaunch: () -> Void
    let onReset: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onSelectDirectory) {
                Label("Select Directory", systemImage: "folder")
            }
            .buttonStyle(.bordered)
            .disabled(manager.isRunning)

            if manager.isRunning {
                Button(action: onReset) {
                    Label("Stop All", systemImage: "stop.fill")
                }
                .buttonStyle(.bordered)
                .tint(.red)
            } else {
                Button(action: onLaunch) {
                    Label(launchButtonLabel, systemImage: "play.fill")
                }
                .buttonStyle(.borderedProminent)
                .disabled(manager.projectPath.isEmpty)
                .opacity(manager.projectPath.isEmpty ? 0.5 : 1.0)
            }
        }
        .padding(.bottom, 8)
    }

    private var launchButtonLabel: String {
        let aiCount = manager.aiToolCount
        let plainCount = manager.plainTerminalCount
        let totalCount = aiCount + plainCount

        if plainCount == 0 && aiCount > 0 {
            return "Launch \(aiCount) AI Session\(aiCount == 1 ? "" : "s")"
        } else if aiCount == 0 && plainCount > 0 {
            return "Launch \(plainCount) Terminal\(plainCount == 1 ? "" : "s")"
        } else {
            return "Launch \(totalCount) Sessions"
        }
    }
}

// MARK: - Session Status View

struct SessionStatusView: View {
    let session: SessionInfo

    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(session.status.color.opacity(0.2))
                    .frame(width: 100, height: 80)

                RoundedRectangle(cornerRadius: 12)
                    .stroke(session.status.color, lineWidth: 3)
                    .frame(width: 100, height: 80)

                VStack(spacing: 4) {
                    // Mode indicator
                    Image(systemName: session.mode.icon)
                        .font(.caption)
                        .foregroundColor(session.mode.color)

                    Image(systemName: session.status.icon)
                        .font(.title2)
                        .foregroundColor(session.status.color)
                        .symbolEffect(.pulse, isActive: session.status == .working)

                    Text("#\(session.id)")
                        .font(.headline)
                }
            }

            Text(session.status.label)
                .font(.caption)
                .foregroundColor(session.status.color)
        }
    }
}

struct LegendItem: View {
    let status: SessionStatus

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(status.color)
                .frame(width: 8, height: 8)
            Text(status.label)
                .foregroundColor(.secondary)
        }
    }
}

#Preview {
    ContentView()
}
