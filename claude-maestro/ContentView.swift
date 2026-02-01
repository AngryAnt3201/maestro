//
//  ContentView.swift
//  claude-maestro
//
//  Created by Jack on 6/1/2026.
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

    /// The process name to look for when detecting the running CLI process
    var processName: String? {
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

    /// Check if the CLI tool is available in PATH
    func isToolAvailable() -> Bool {
        guard let cmd = command else { return true }
        let shell = Foundation.ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: shell)
        // Run shell as login (-l) and interactive (-i) to source all profile files
        // The -i flag ensures .zshrc is read, where NVM/Homebrew PATH additions typically live
        process.arguments = ["-l", "-i", "-c", "which \(cmd)"]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        // Use timeout to prevent hanging if shell initialization is slow
        let semaphore = DispatchSemaphore(value: 0)
        var exitStatus: Int32 = 1

        do {
            try process.run()

            // Run waitUntilExit on background queue with timeout
            DispatchQueue.global().async {
                process.waitUntilExit()
                exitStatus = process.terminationStatus
                semaphore.signal()
            }

            // Wait up to 5 seconds for the process to complete
            let result = semaphore.wait(timeout: .now() + 5.0)

            if result == .timedOut {
                process.terminate()
                // On timeout, assume tool might be available (better UX than false negative)
                return true
            }

            return exitStatus == 0
        } catch {
            return false
        }
    }

    var installationHint: String {
        switch self {
        case .claudeCode: return "npm install -g @anthropic-ai/claude-code"
        case .geminiCli: return "npm install -g @google/gemini-cli"
        case .openAiCodex: return "npm install -g @openai/codex"
        case .plainTerminal: return ""
        }
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

struct SessionInfo: Identifiable, Hashable {
    var id: Int
    var status: SessionStatus = .idle
    var mode: TerminalMode = .claudeCode
    var assignedBranch: String? = nil
    var currentBranch: String? = nil
    var workingDirectory: String? = nil     // worktree path (nil = use main repo)
    var shouldLaunchTerminal: Bool = false  // per-session launch trigger
    var isTerminalLaunched: Bool = false    // shell is running
    var isClaudeRunning: Bool = false       // claude command has been launched
    var isVisible: Bool = true              // terminal is open (not closed)

    // Process tracking
    var terminalPid: pid_t? = nil           // Shell PID for process activity monitoring

    // App running state
    var assignedPort: Int? = nil            // Auto-assigned port (hint for web projects)
    var customRunCommand: String? = nil     // Optional manual override command
    var isAppRunning: Bool = false          // App has been launched via "Run App"
    var serverURL: String? = nil            // Detected web server URL (nil for native apps)

    init(id: Int, mode: TerminalMode = .claudeCode) {
        self.id = id
        self.mode = mode
    }

    // MARK: - Hashable conformance (identity based on session ID only)
    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: SessionInfo, rhs: SessionInfo) -> Bool {
        lhs.id == rhs.id
    }
}

// MARK: - Persistable Session (for UserDefaults storage)

struct PersistableSession: Codable {
    let id: Int
    var mode: TerminalMode
    var assignedBranch: String?
    var customRunCommand: String?

    init(from session: SessionInfo) {
        self.id = session.id
        self.mode = session.mode
        self.assignedBranch = session.assignedBranch
        self.customRunCommand = session.customRunCommand
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

// MARK: - Port Manager

class PortManager: ObservableObject {
    @Published private(set) var assignedPorts: [Int: Int] = [:]  // sessionId -> port
    private let basePort = 3000
    private let maxPort = 3099

    func assignPort(for sessionId: Int) -> Int {
        if let existing = assignedPorts[sessionId] {
            return existing
        }

        let usedPorts = Set(assignedPorts.values)
        for port in basePort...maxPort {
            if !usedPorts.contains(port) {
                assignedPorts[sessionId] = port
                return port
            }
        }
        return basePort // fallback
    }

    func releasePort(for sessionId: Int) {
        assignedPorts.removeValue(forKey: sessionId)
    }

    func port(for sessionId: Int) -> Int? {
        assignedPorts[sessionId]
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
    @Published var worktreeManager = WorktreeManager()
    @Published var claudeMDManager = ClaudeMDManager()

    // Selection management
    @Published var selectionManager = SelectionManager()

    // Template presets
    @Published var savedPresets: [TemplatePreset] = []
    @Published var currentPresetId: UUID? = nil

    // Port and terminal controller management for "Run App" feature
    @Published var portManager = PortManager()
    var terminalControllers: [Int: TerminalController] = [:]

    // Native process management (replaces Node.js MCP for process lifecycle)
    let processCoordinator = ManagedProcessCoordinator()
    let processRegistry = ProcessRegistry()
    let nativePortManager = NativePortManager()

    // Process activity monitoring for accurate agent state detection
    let activityMonitor = ProcessActivityMonitor()

    // Agent state monitoring via MCP-reported status files
    @Published var stateMonitor = MaestroStateMonitor()

    // Keyboard navigation
    @Published var focusedSessionId: Int? = nil

    // Agent state subscription for syncing to session status
    private var agentStateSubscription: AnyCancellable?

    // MCP server status watcher for auto-open and UI sync (legacy - can be removed after migration)
    private var mcpWatcher = MCPStatusWatcher()

    // Published system processes from MCP watcher
    @Published var systemProcesses: [MCPStatusWatcher.SystemProcess] = []

    private var cancellables = Set<AnyCancellable>()

    init() {
        // Forward selectionManager changes to trigger view updates
        selectionManager.objectWillChange
            .sink { [weak self] _ in
                self?.objectWillChange.send()
            }
            .store(in: &cancellables)

        // Watch for MCP server status changes
        mcpWatcher.$serverStatuses
            .receive(on: DispatchQueue.main)
            .sink { [weak self] statuses in
                self?.handleMCPStatusUpdate(statuses)
            }
            .store(in: &cancellables)

        // Watch for system process changes
        mcpWatcher.$systemProcesses
            .receive(on: DispatchQueue.main)
            .sink { [weak self] processes in
                self?.systemProcesses = processes
            }
            .store(in: &cancellables)

        loadPresets()
        loadSessions()

        // Start agent state monitoring and sync to session status
        Task { @MainActor in
            stateMonitor.start()
            startAgentStateSync()
        }
    }

    /// Start syncing agent state changes to session status
    private func startAgentStateSync() {
        agentStateSubscription = stateMonitor.$agents
            .receive(on: DispatchQueue.main)
            .sink { [weak self] agents in
                self?.syncAgentStatesToSessions(agents)
            }
    }

    /// Sync agent states from MaestroStateMonitor to corresponding SessionInfo.status
    private func syncAgentStatesToSessions(_ agents: [String: AgentState]) {
        for (agentId, agentState) in agents {
            // Parse session ID from agent ID (e.g., "agent-1" -> 1)
            if agentId.hasPrefix("agent-"),
               let sessionId = Int(agentId.dropFirst("agent-".count)) {
                let sessionStatus = mapAgentStateToSessionStatus(agentState.state)
                updateStatus(for: sessionId, status: sessionStatus)
            }
        }
    }

    /// Map AgentStatusState to SessionStatus for window border colors
    private func mapAgentStateToSessionStatus(_ state: AgentStatusState) -> SessionStatus {
        switch state {
        case .idle: return .idle
        case .working: return .working
        case .needsInput: return .waiting
        case .finished: return .done
        case .error: return .error
        }
    }

    var gridConfig: GridConfiguration {
        GridConfiguration.optimal(for: terminalCount)
    }

    func setProjectPath(_ path: String) async {
        let oldPath = projectPath

        // Reset all sessions if changing to a different directory
        if !oldPath.isEmpty && oldPath != path {
            await resetAllSessionsForDirectoryChange(oldPath: oldPath)
        }

        await MainActor.run {
            projectPath = path
            // Load the main project's CLAUDE.md content
            claudeMDManager.loadContent(from: path)
            // Set project path for state monitor to use project-scoped directories
            stateMonitor.setProjectPath(path)
        }
        await gitManager.setRepository(path: path)

        // Cleanup worktrees for the new repo
        if gitManager.isGitRepo {
            do {
                // First, prune stale worktree references (directories that no longer exist)
                try await worktreeManager.pruneOrphanedWorktrees(
                    repoPath: path,
                    gitManager: gitManager
                )

                // Then, sync in-memory activeWorktrees map with existing worktrees
                // This restores the mapping so closing sessions properly cleans up worktrees
                try await worktreeManager.syncWorktreesWithSessions(
                    sessions: sessions,
                    repoPath: path,
                    gitManager: gitManager
                )

                // Finally, remove actual orphaned worktree directories that aren't claimed by any session
                try await worktreeManager.cleanupOrphanedWorktrees(
                    activeSessions: sessions,
                    repoPath: path,
                    gitManager: gitManager
                )
            } catch {
                print("Failed to cleanup worktrees: \(error)")
            }
        }
    }

    /// Reset all sessions when changing to a different project directory
    /// This provides a clean slate and properly cleans up the old directory's resources
    func resetAllSessionsForDirectoryChange(oldPath: String?) async {
        // 1. Stop activity monitoring for all sessions
        for session in sessions {
            if let pid = session.terminalPid {
                activityMonitor.stopMonitoring(pid: pid)
            }
        }

        // 2. Remove all agent state files
        for session in sessions {
            stateMonitor.removeAgentForSession(session.id)
        }

        // 3. Terminate all terminal controllers
        for (_, controller) in terminalControllers {
            controller.terminate()
        }
        terminalControllers.removeAll()

        // 4. Clean up all process registrations and kill terminals
        for session in sessions {
            // Kill terminal process group if we have a PID
            if let pid = session.terminalPid {
                let pgid = getpgid(pid)
                if pgid > 0 {
                    // Send SIGTERM to entire process group
                    killpg(pgid, SIGTERM)
                }
            }

            await processRegistry.cleanupSession(session.id, killProcesses: true)
            await processCoordinator.cleanupSession(session.id)
            await nativePortManager.releasePortsForSession(session.id)
        }

        // 5. Release all ports from legacy port manager
        for session in sessions {
            portManager.releasePort(for: session.id)
        }

        // 6. Clean up old repo worktrees if we had a previous path
        if let oldPath = oldPath, !oldPath.isEmpty {
            await cleanupOldRepoWorktrees(oldRepoPath: oldPath)
        }

        // 6a. Clear CLAUDE.md manager state
        claudeMDManager.clear()

        // 7. Clear worktree manager state
        await worktreeManager.clearAllWorktrees()

        // 8. Reset session state (preserve count and modes)
        for i in sessions.indices {
            sessions[i].workingDirectory = nil
            sessions[i].assignedBranch = nil
            sessions[i].terminalPid = nil
            sessions[i].status = .idle
            sessions[i].assignedPort = nil
            sessions[i].isTerminalLaunched = false
            sessions[i].isClaudeRunning = false
            sessions[i].isVisible = true
            sessions[i].shouldLaunchTerminal = false
            sessions[i].isAppRunning = false
            sessions[i].serverURL = nil
        }

        // 9. Reset running state
        isRunning = false

        persistSessions()
    }

    /// Clean up worktrees from the old repository path
    private func cleanupOldRepoWorktrees(oldRepoPath: String) async {
        // Create a temporary GitManager for the old repo
        let oldGitManager = GitManager()
        await oldGitManager.setRepository(path: oldRepoPath)

        guard oldGitManager.isGitRepo else { return }

        do {
            // Remove all maestro-managed worktrees for the old repo
            try await worktreeManager.cleanupAllWorktreesForRepo(
                repoPath: oldRepoPath,
                gitManager: oldGitManager
            )
        } catch {
            print("Failed to cleanup old repo worktrees: \(error)")
            // Non-fatal - continue with directory change
        }
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
            // Use assigned branch, or fall back to current branch for active sessions
            let effectiveBranch = session.assignedBranch
                ?? ((session.isTerminalLaunched || session.isClaudeRunning) ? gitManager.currentBranch : nil)
            if let branch = effectiveBranch {
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
            sessions[i].assignedBranch = nil  // Clear stale branch assignments
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
        print("Closing session \(sessionId)")

        // Stop activity monitoring for this session's process
        var terminalPidToKill: pid_t? = nil
        if let session = sessions.first(where: { $0.id == sessionId }),
           let pid = session.terminalPid {
            activityMonitor.stopMonitoring(pid: pid)
            terminalPidToKill = pid
        }

        // Clean up agent state file from MaestroStateMonitor
        stateMonitor.removeAgentForSession(sessionId)

        // Release assigned port (both legacy and native)
        portManager.releasePort(for: sessionId)

        // Terminate the terminal process before removing
        terminalControllers[sessionId]?.terminate()

        // Remove terminal controller
        terminalControllers.removeValue(forKey: sessionId)

        // Clean up using native process management
        Task {
            // If we have a terminal PID, kill its process group directly
            // This ensures cleanup even if the process wasn't registered
            if let pid = terminalPidToKill {
                let pgid = getpgid(pid)
                if pgid > 0 {
                    // Send SIGTERM to entire process group
                    killpg(pgid, SIGTERM)

                    // Schedule SIGKILL after grace period
                    Task {
                        try? await Task.sleep(nanoseconds: 3_000_000_000) // 3 seconds
                        if killpg(pgid, 0) == 0 { // Check if still alive
                            killpg(pgid, SIGKILL)
                        }
                    }
                }
            }

            // Kill all processes in the session using native process groups
            await processRegistry.cleanupSession(sessionId, killProcesses: true)

            // Also cleanup via the coordinator (for dev servers)
            await processCoordinator.cleanupSession(sessionId)

            // Release native port allocation
            await nativePortManager.releasePortsForSession(sessionId)

            // Clean up worktree if this session had one
            do {
                try await worktreeManager.removeWorktree(
                    for: sessionId,
                    repoPath: projectPath,
                    gitManager: gitManager
                )
            } catch {
                print("Failed to remove worktree for session \(sessionId): \(error)")
            }
        }

        // Remove the session entirely
        sessions.removeAll { $0.id == sessionId }

        // Update terminal count to match (this also triggers persistSessions via didSet)
        terminalCount = sessions.count

        print("Session \(sessionId) closed, remaining: \(sessions.map { $0.id })")
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

    // MARK: - Run App Feature

    func runApp(for sessionId: Int) {
        // 1. Assign port (used as hint for web projects)
        let port = portManager.assignPort(for: sessionId)

        // 2. Update session with port and running state
        if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
            sessions[index].assignedPort = port
            sessions[index].isAppRunning = true
        }

        // 3. Build prompt for AI - it figures out project type
        let prompt: String
        if let index = sessions.firstIndex(where: { $0.id == sessionId }),
           let customCmd = sessions[index].customRunCommand {
            prompt = "Please run: \(customCmd)"
        } else {
            prompt = "Please run this application. If it's a web project that needs a port, use port \(port). For native apps (Swift, Rust, etc.), just run them normally - they'll open their own window."
        }

        // 4. Send to terminal via controller
        terminalControllers[sessionId]?.sendCommand(prompt)
    }

    func commitAndPush(for sessionId: Int) {
        let prompt = "Please commit all changes with an appropriate commit message, then push to the remote repository."
        terminalControllers[sessionId]?.sendCommand(prompt)
    }

    func executeCustomAction(prompt: String, for sessionId: Int) {
        terminalControllers[sessionId]?.sendCommand(prompt)
    }

    func setAppRunning(_ running: Bool, url: String?, for sessionId: Int) {
        if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
            sessions[index].isAppRunning = running
            sessions[index].serverURL = url
        }
    }

    func setServerURL(_ url: String?, for sessionId: Int) {
        if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
            sessions[index].serverURL = url
            // Auto-open browser when server URL is detected
            if let urlString = url, let browserURL = URL(string: urlString) {
                NSWorkspace.shared.open(browserURL)
            }
        }
    }

    func markTerminalLaunched(_ sessionId: Int) {
        if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
            sessions[index].isTerminalLaunched = true
        }
    }

    /// Register a terminal process PID for native process management
    func registerTerminalProcess(sessionId: Int, pid: pid_t) {
        // Store PID in session for activity monitoring
        if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
            sessions[index].terminalPid = pid
        }

        // Register with process registry
        Task {
            await processRegistry.register(
                pid: pid,
                pgid: pid,  // Terminal shells typically are their own process group
                sessionId: sessionId,
                source: .terminal,
                command: sessions.first { $0.id == sessionId }?.mode.command ?? "shell",
                workingDirectory: projectPath
            )
        }

        // Start activity monitoring for this process
        Task { @MainActor in
            activityMonitor.startMonitoring(pid: pid)
        }
    }

    /// Prepare worktree for a session if it has an assigned branch
    /// Returns the working directory path (worktree path or main project path)
    func prepareWorktree(for sessionId: Int) async -> String {
        guard let index = sessions.firstIndex(where: { $0.id == sessionId }) else {
            return projectPath
        }

        let session = sessions[index]

        // If no branch assigned, use main repo
        guard let branch = session.assignedBranch else {
            return projectPath
        }

        // Create worktree for the assigned branch
        do {
            let worktreePath = try await worktreeManager.createWorktree(
                for: sessionId,
                branch: branch,
                repoPath: projectPath,
                gitManager: gitManager
            )
            // Store the worktree path in the session
            await MainActor.run {
                if let idx = sessions.firstIndex(where: { $0.id == sessionId }) {
                    sessions[idx].workingDirectory = worktreePath
                }
            }
            return worktreePath
        } catch {
            print("Failed to create worktree for session \(sessionId): \(error)")
            // Fall back to main repo
            return projectPath
        }
    }

    func triggerTerminalLaunch(_ sessionId: Int) {
        // Prepare worktree asynchronously, then trigger launch
        Task {
            let workingDir = await prepareWorktree(for: sessionId)
            await MainActor.run {
                if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
                    sessions[index].workingDirectory = workingDir
                    sessions[index].shouldLaunchTerminal = true
                }
            }
        }
    }

    // MARK: - MCP Status Sync

    private func handleMCPStatusUpdate(_ statuses: [MCPStatusWatcher.ServerStatus]) {
        for status in statuses {
            if let index = sessions.firstIndex(where: { $0.id == status.sessionId }) {
                let isRunning = (status.status == "running" || status.status == "starting")
                sessions[index].isAppRunning = isRunning
                sessions[index].serverURL = status.url
                if let port = status.port {
                    sessions[index].assignedPort = port
                }
            }
        }
    }

    // MARK: - Keyboard Navigation

    /// Focus the terminal at the given visible index (0-based)
    func focusTerminal(atVisibleIndex index: Int) {
        let visible = visibleSessions
        guard index >= 0 && index < visible.count else { return }
        let targetId = visible[index].id
        focusedSessionId = targetId

        // Make the terminal's NSView first responder if it's launched
        if let controller = terminalControllers[targetId],
           let terminal = controller.coordinator?.terminal,
           let window = terminal.window {
            window.makeFirstResponder(terminal)
        }
    }

    /// Focus the next terminal in the visible list (with wraparound)
    func focusNextTerminal() {
        let visible = visibleSessions
        guard !visible.isEmpty else { return }

        if let currentId = focusedSessionId,
           let currentIndex = visible.firstIndex(where: { $0.id == currentId }) {
            let nextIndex = (currentIndex + 1) % visible.count
            focusTerminal(atVisibleIndex: nextIndex)
        } else {
            focusTerminal(atVisibleIndex: 0)
        }
    }

    /// Focus the previous terminal in the visible list (with wraparound)
    func focusPreviousTerminal() {
        let visible = visibleSessions
        guard !visible.isEmpty else { return }

        if let currentId = focusedSessionId,
           let currentIndex = visible.firstIndex(where: { $0.id == currentId }) {
            let prevIndex = (currentIndex - 1 + visible.count) % visible.count
            focusTerminal(atVisibleIndex: prevIndex)
        } else {
            focusTerminal(atVisibleIndex: visible.count - 1)
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

/// Original ContentView that creates and owns its own SessionManager
/// Used when the app is running in single-project mode
struct ContentView: View {
    @StateObject private var manager = SessionManager()
    @StateObject private var appearanceManager = AppearanceManager()
    @State private var statusMessage: String = "Select a directory to launch Claude Code instances"
    @State private var showBranchSidebar: Bool = false
    @State private var columnVisibility: NavigationSplitViewVisibility = .all

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            SidebarView(manager: manager, appearanceManager: appearanceManager)
                .navigationSplitViewColumnWidth(min: 240, ideal: 240, max: 300)
        } detail: {
            MainContentView(
                manager: manager,
                appearanceManager: appearanceManager,
                statusMessage: $statusMessage,
                showBranchSidebar: $showBranchSidebar,
                columnVisibility: $columnVisibility
            )
        }
        .navigationSplitViewStyle(.balanced)
        .preferredColorScheme(appearanceManager.currentMode.colorScheme)
    }
}

/// Project-specific ContentView that accepts an external SessionManager
/// Used in multi-project mode where each project owns its SessionManager
struct ProjectContentView: View {
    @ObservedObject var manager: SessionManager
    @ObservedObject var appearanceManager: AppearanceManager
    @State private var statusMessage: String = "Select a directory to launch Claude Code instances"
    @State private var showBranchSidebar: Bool = false
    @State private var columnVisibility: NavigationSplitViewVisibility = .all

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            SidebarView(manager: manager, appearanceManager: appearanceManager)
                .navigationSplitViewColumnWidth(min: 240, ideal: 240, max: 300)
        } detail: {
            MainContentView(
                manager: manager,
                appearanceManager: appearanceManager,
                statusMessage: $statusMessage,
                showBranchSidebar: $showBranchSidebar,
                columnVisibility: $columnVisibility
            )
        }
        .navigationSplitViewStyle(.balanced)
        .preferredColorScheme(appearanceManager.currentMode.colorScheme)
        .onAppear {
            // Update status message based on project state
            if !manager.projectPath.isEmpty {
                statusMessage = manager.gitManager.isGitRepo
                    ? "Git repo detected - Ready to launch!"
                    : "Ready to launch!"
            }
        }
    }
}

// MARK: - Main Content View

struct MainContentView: View {
    @ObservedObject var manager: SessionManager
    @ObservedObject var appearanceManager: AppearanceManager
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
                    DynamicTerminalGridView(manager: manager, appearanceManager: appearanceManager)
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

// MARK: - Array Chunking Extension

extension Array {
    /// Splits the array into chunks of the specified size
    func chunked(into size: Int) -> [[Element]] {
        guard size > 0 else { return [] }
        return stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}

// MARK: - Dynamic Terminal Grid

struct DynamicTerminalGridView: View {
    @ObservedObject var manager: SessionManager
    @ObservedObject var appearanceManager: AppearanceManager
    @State private var isHoveringAdd = false

    var body: some View {
        let visibleSessions = manager.visibleSessions
        let config = GridConfiguration.optimal(for: visibleSessions.count)
        let sessionRows = visibleSessions.chunked(into: config.columns)

        ZStack(alignment: .bottomTrailing) {
            VStack(spacing: 8) {
                ForEach(Array(sessionRows.enumerated()), id: \.offset) { _, rowSessions in
                    HStack(spacing: 8) {
                        // Iterate by session ID for stable view identity
                        ForEach(rowSessions, id: \.id) { session in
                            TerminalSessionView(
                                session: session,
                                workingDirectory: session.workingDirectory ?? manager.projectPath,
                                shouldLaunch: manager.session(byId: session.id)?.shouldLaunchTerminal ?? false,
                                status: Binding(
                                    get: { manager.session(byId: session.id)?.status ?? .idle },
                                    set: { newValue in manager.updateSession(id: session.id) { $0.status = newValue } }
                                ),
                                mode: Binding(
                                    get: { manager.session(byId: session.id)?.mode ?? .claudeCode },
                                    set: { newValue in manager.updateSession(id: session.id) { $0.mode = newValue } }
                                ),
                                assignedBranch: Binding(
                                    get: { manager.session(byId: session.id)?.assignedBranch },
                                    set: { manager.assignBranch($0, to: session.id) }
                                ),
                                gitManager: manager.gitManager,
                                isTerminalLaunched: manager.session(byId: session.id)?.isTerminalLaunched ?? false,
                                isClaudeRunning: manager.session(byId: session.id)?.isClaudeRunning ?? false,
                                appearanceMode: appearanceManager.currentMode,
                                onLaunchClaude: { manager.launchClaudeInSession(session.id) },
                                onClose: { manager.closeSession(session.id) },
                                onTerminalLaunched: { manager.markTerminalLaunched(session.id) },
                                onLaunchTerminal: { manager.triggerTerminalLaunch(session.id) },
                                // Run App feature props
                                assignedPort: manager.session(byId: session.id)?.assignedPort,
                                isAppRunning: manager.session(byId: session.id)?.isAppRunning ?? false,
                                serverURL: manager.session(byId: session.id)?.serverURL,
                                onRunApp: { manager.runApp(for: session.id) },
                                onCommitAndPush: { manager.commitAndPush(for: session.id) },
                                onServerReady: { url in manager.setServerURL(url, for: session.id) },
                                onControllerReady: { controller in manager.terminalControllers[session.id] = controller },
                                onCustomAction: { prompt in manager.executeCustomAction(prompt: prompt, for: session.id) },
                                onProcessStarted: { pid in manager.registerTerminalProcess(sessionId: session.id, pid: pid) },
                                agentState: manager.stateMonitor.agentState(forSessionId: session.id),
                                onNavigationShortcut: { char in
                                    if let digit = Int(char) {
                                        let index = digit == 0 ? 9 : digit - 1
                                        manager.focusTerminal(atVisibleIndex: index)
                                        return true
                                    }
                                    if char == "]" { manager.focusNextTerminal(); return true }
                                    if char == "[" { manager.focusPreviousTerminal(); return true }
                                    return false
                                },
                                onBecameFirstResponder: { manager.focusedSessionId = session.id },
                                isFocused: manager.focusedSessionId == session.id
                            )
                            .id(session.id)  // Explicit session ID for view identity
                        }
                        // Spacers for incomplete rows to maintain equal sizing
                        ForEach(0..<(config.columns - rowSessions.count), id: \.self) { _ in
                            Color.clear
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
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onReceive(NotificationCenter.default.publisher(for: .navigateToTerminal)) { notification in
            if let index = notification.userInfo?["index"] as? Int {
                manager.focusTerminal(atVisibleIndex: index)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .navigateNextTerminal)) { _ in
            manager.focusNextTerminal()
        }
        .onReceive(NotificationCenter.default.publisher(for: .navigatePreviousTerminal)) { _ in
            manager.focusPreviousTerminal()
        }
    }
}

// MARK: - Pre-Launch View

struct PreLaunchView: View {
    @ObservedObject var manager: SessionManager
    let statusMessage: String

    var body: some View {
        let columnCount = manager.gridConfig.columns
        let columns = Array(repeating: GridItem(.fixed(100), spacing: 12), count: columnCount)

        VStack(spacing: 16) {
            Spacer()

            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(manager.sessions, id: \.id) { session in
                    SessionStatusView(session: session)
                        .id(session.id)  // Force view identity based on session ID
                }
            }
            .padding(24)
            .background {
                RoundedRectangle(cornerRadius: 16)
                    .fill(.ultraThinMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(Color.white.opacity(0.1), lineWidth: 1)
                    )
                    .shadow(color: .black.opacity(0.2), radius: 12, x: 0, y: 4)
            }
            .fixedSize(horizontal: true, vertical: false)

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

                    Group {
                        if #available(macOS 14.0, *) {
                            Image(systemName: session.status.icon)
                                .font(.title2)
                                .foregroundColor(session.status.color)
                                .symbolEffect(.pulse, isActive: session.status == .working)
                        } else {
                            Image(systemName: session.status.icon)
                                .font(.title2)
                                .foregroundColor(session.status.color)
                        }
                    }

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
