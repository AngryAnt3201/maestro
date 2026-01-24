//
//  TerminalView.swift
//  claude-maestro
//
//  Created by Jack Wakem on 6/1/2026.
//

import SwiftUI
import AppKit
import SwiftTerm

// MARK: - Terminal Controller

class TerminalController {
    weak var coordinator: EmbeddedTerminalView.Coordinator?

    func sendCommand(_ command: String) {
        coordinator?.sendCommand(command)
    }

    func terminate() {
        coordinator?.terminateProcess()
    }
}

// MARK: - Embedded Terminal View

struct EmbeddedTerminalView: NSViewRepresentable {
    let sessionId: Int
    let workingDirectory: String
    @Binding var status: SessionStatus
    let shouldLaunch: Bool
    let assignedBranch: String?
    let mode: TerminalMode
    var activityMonitor: ProcessActivityMonitor?  // For process-level activity detection
    var onLaunched: () -> Void
    var onCLILaunched: () -> Void
    var onServerReady: ((String) -> Void)?  // Called with detected server URL
    var onOutputReceived: ((String) -> Void)?  // Called with terminal output for output pane
    var onProcessStarted: ((pid_t) -> Void)?  // Called with shell PID for process registration
    var controller: TerminalController?

    func makeNSView(context: Context) -> LocalProcessTerminalView {
        let terminal = LocalProcessTerminalView(frame: .zero)
        terminal.processDelegate = context.coordinator
        terminal.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)

        // Configure dark terminal color scheme
        terminal.nativeBackgroundColor = NSColor(red: 0.1, green: 0.1, blue: 0.12, alpha: 1.0)
        terminal.nativeForegroundColor = NSColor(red: 0.9, green: 0.9, blue: 0.9, alpha: 1.0)

        // Install a rich ANSI color palette (16 colors)
        let colors: [SwiftTerm.Color] = [
            // Standard colors (0-7)
            SwiftTerm.Color(red: 38, green: 38, blue: 43),      // Black
            SwiftTerm.Color(red: 242, green: 89, blue: 89),     // Red
            SwiftTerm.Color(red: 89, green: 217, blue: 115),    // Green
            SwiftTerm.Color(red: 242, green: 204, blue: 89),    // Yellow
            SwiftTerm.Color(red: 115, green: 153, blue: 242),   // Blue
            SwiftTerm.Color(red: 217, green: 127, blue: 217),   // Magenta
            SwiftTerm.Color(red: 115, green: 217, blue: 217),   // Cyan
            SwiftTerm.Color(red: 217, green: 217, blue: 217),   // White
            // Bright colors (8-15)
            SwiftTerm.Color(red: 115, green: 115, blue: 128),   // Bright Black
            SwiftTerm.Color(red: 255, green: 115, blue: 115),   // Bright Red
            SwiftTerm.Color(red: 115, green: 242, blue: 140),   // Bright Green
            SwiftTerm.Color(red: 255, green: 230, blue: 115),   // Bright Yellow
            SwiftTerm.Color(red: 140, green: 179, blue: 255),   // Bright Blue
            SwiftTerm.Color(red: 242, green: 153, blue: 242),   // Bright Magenta
            SwiftTerm.Color(red: 140, green: 242, blue: 242),   // Bright Cyan
            SwiftTerm.Color(red: 255, green: 255, blue: 255),   // Bright White
        ]
        terminal.installColors(colors)

        context.coordinator.terminal = terminal
        controller?.coordinator = context.coordinator
        return terminal
    }

    func updateNSView(_ terminal: LocalProcessTerminalView, context: Context) {
        if shouldLaunch && !context.coordinator.hasLaunched {
            context.coordinator.hasLaunched = true
            launchTerminal(in: terminal)
            onLaunched()
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(
            sessionId: sessionId,
            mode: mode,
            status: $status,
            activityMonitor: activityMonitor,
            onServerReady: onServerReady,
            onOutputReceived: onOutputReceived
        )
    }

    private func launchTerminal(in terminal: LocalProcessTerminalView) {
        let shell = Foundation.ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"

        // Source user's shell profile to get full environment (PATH, NVM, etc.)
        // This is necessary because macOS apps launched from Finder have a limited environment
        var command = """
            if [ -f ~/.zprofile ]; then source ~/.zprofile 2>/dev/null; fi; \
            if [ -f ~/.zshrc ]; then source ~/.zshrc 2>/dev/null; fi; \
            if [ -f ~/.bash_profile ]; then source ~/.bash_profile 2>/dev/null; fi; \
            if [ -f ~/.bashrc ]; then source ~/.bashrc 2>/dev/null; fi; \
            cd '\(workingDirectory)'
            """

        // Note: Branch checkout is handled by worktree isolation
        // Each session with an assigned branch gets its own worktree directory

        // Auto-launch CLI tool if in AI mode, otherwise just open shell
        if let cliCommand = mode.command {
            // Launch the CLI tool directly (it will take over the terminal)
            command += " && \(cliCommand)"
            // Mark CLI as launched
            DispatchQueue.main.async {
                self.onCLILaunched()
            }
        } else {
            // Plain terminal - just exec shell
            command += " && exec $SHELL"
        }

        // Generate session configs (CLAUDE.md + CLI-specific MCP config)
        ClaudeDocManager.writeSessionConfigs(
            to: workingDirectory,
            projectPath: workingDirectory,
            runCommand: nil,  // Will be auto-detected from project files
            branch: assignedBranch,
            sessionId: sessionId,
            port: nil,
            mode: mode
        )

        terminal.startProcess(
            executable: shell,
            args: ["-l", "-i", "-c", command],
            environment: nil,  // Let shell inherit and source profiles for full environment
            execName: nil
        )

        // Capture the shell PID for native process management
        // We need to wait a moment for the shell to spawn, then find it
        let capturedSessionId = sessionId
        let capturedOnProcessStarted = onProcessStarted
        let capturedMode = mode

        Task {
            // Small delay to let the shell process spawn
            try? await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds

            // Find the shell process by looking for children of our app
            // that match the shell or the AI CLI process
            let processTree = ProcessTree()
            let appPid = getpid()
            let children = await processTree.getDescendants(of: appPid)

            // Look for the CLI process (claude, gemini, codex) or shell
            let targetName = capturedMode.processName ?? "zsh"
            if let shellProcess = children.first(where: { proc in
                proc.name.lowercased().contains(targetName.lowercased()) ||
                proc.name == "zsh" || proc.name == "bash"
            }) {
                await MainActor.run {
                    capturedOnProcessStarted?(shellProcess.pid)
                }
            }
        }
    }

    class Coordinator: NSObject, LocalProcessTerminalViewDelegate {
        let sessionId: Int
        let mode: TerminalMode
        @Binding var status: SessionStatus
        var hasLaunched = false
        private var outputBuffer = ""
        weak var terminal: LocalProcessTerminalView?

        // Activity-based state tracking
        private var lastOutputTime: Date?
        private var idleCheckTimer: Timer?
        private var initializingTimer: Timer?
        private var shellPid: pid_t?

        // Process activity monitor for accurate state detection
        weak var activityMonitor: ProcessActivityMonitor?

        // Server detection callback
        var onServerReady: ((String) -> Void)?
        private var hasDetectedServer = false  // Prevent duplicate callbacks

        // Output callback for output pane
        var onOutputReceived: ((String) -> Void)?

        // Configurable timeouts
        private let initializingTimeout: TimeInterval = 3.0  // Time after launch before assuming idle
        private let idleTimeout: TimeInterval = 2.0          // Time without output = idle

        init(sessionId: Int, mode: TerminalMode, status: Binding<SessionStatus>, activityMonitor: ProcessActivityMonitor?, onServerReady: ((String) -> Void)?, onOutputReceived: ((String) -> Void)?) {
            self.sessionId = sessionId
            self.mode = mode
            self._status = status
            self.activityMonitor = activityMonitor
            self.onServerReady = onServerReady
            self.onOutputReceived = onOutputReceived
            super.init()

            // Set initial state to initializing
            DispatchQueue.main.async {
                status.wrappedValue = .initializing
            }
            scheduleInitializingCheck()
        }

        func sendCommand(_ command: String) {
            guard let terminal = terminal else { return }
            // Use carriage return (\r) instead of newline (\n) for proper "Enter" key behavior
            // Terminal applications in raw mode expect CR (byte 13) to submit input
            let commandWithCR = command + "\r"
            terminal.send(txt: commandWithCR)
        }

        func terminateProcess() {
            // Clean up timers
            idleCheckTimer?.invalidate()
            initializingTimer?.invalidate()

            // Clean up Codex MCP config if this was a Codex session
            if mode == .openAiCodex {
                Task { @MainActor in
                    ClaudeDocManager.cleanupCodexMCPConfig(sessionId: sessionId)
                }
            }

            // Send exit command to terminate shell gracefully
            terminal?.send(txt: "exit\r")
            terminal = nil
        }

        func processTerminated(source: SwiftTerm.TerminalView, exitCode: Int32?) {
            // Clean up timers
            idleCheckTimer?.invalidate()
            initializingTimer?.invalidate()

            DispatchQueue.main.async {
                if exitCode == 0 {
                    self.status = .done
                } else {
                    self.status = .error
                }
            }
        }

        func dataReceived(slice: ArraySlice<UInt8>) {
            if let str = String(bytes: slice, encoding: .utf8) {
                outputBuffer += str
                lastOutputTime = Date()

                // Forward output to output pane callback
                DispatchQueue.main.async {
                    self.onOutputReceived?(str)
                }

                // Output received = we're working (unless in special state)
                DispatchQueue.main.async {
                    if self.status != .waiting && self.status != .error {
                        self.status = .working
                    }
                }

                // Check for special patterns (confirmation prompts, errors)
                checkSpecialPatterns(str)

                // Check for server URLs (for "Run App" feature)
                checkForServerReady(str)

                // Reset idle timer
                scheduleIdleCheck()

                // Keep buffer manageable
                if outputBuffer.count > 10000 {
                    outputBuffer = String(outputBuffer.suffix(5000))
                }
            }
        }

        private func checkSpecialPatterns(_ text: String) {
            let lowercased = text.lowercased()

            DispatchQueue.main.async {
                // Waiting patterns (confirmation prompts) - be more specific to avoid false positives
                let waitingPatterns = ["(y/n)", "[y/n]", "(yes/no)", "[yes/no]",
                                       "confirm?", "permission", "allow this", "approve"]
                if waitingPatterns.contains(where: { lowercased.contains($0) }) {
                    self.status = .waiting
                    return
                }

                // Error patterns - only match clear error indicators
                let errorPatterns = ["error:", "failed:", "exception:", "fatal:",
                                     "command not found", "permission denied", "not recognized"]
                if errorPatterns.contains(where: { lowercased.contains($0) }) {
                    self.status = .error
                }
            }
        }

        private func checkForServerReady(_ text: String) {
            // Don't detect multiple times
            guard !hasDetectedServer else { return }
            guard let onServerReady = onServerReady else { return }

            // Patterns to detect server URLs (common dev server outputs)
            let serverPatterns = [
                "(https?://localhost:\\d+[^\\s]*)",           // http://localhost:3000/...
                "(https?://127\\.0\\.0\\.1:\\d+[^\\s]*)",     // http://127.0.0.1:3000/...
                "(https?://0\\.0\\.0\\.0:\\d+[^\\s]*)",       // http://0.0.0.0:3000/...
                "Local:\\s*(https?://[^\\s]+)",               // Vite: Local: http://...
                "ready on (https?://[^\\s]+)",                // Next.js: ready on http://...
                "Listening on (https?://[^\\s]+)",            // Express variants
                "Server running at (https?://[^\\s]+)",       // Generic
                "Available on:\\s*\n?\\s*(https?://[^\\s]+)"  // Some frameworks
            ]

            for pattern in serverPatterns {
                if let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
                   let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) {
                    // Get the captured URL group
                    let captureRange = match.numberOfRanges > 1 ? match.range(at: 1) : match.range(at: 0)
                    if let urlRange = Range(captureRange, in: text) {
                        var url = String(text[urlRange])
                        // Clean up any trailing punctuation or control chars
                        url = url.trimmingCharacters(in: CharacterSet.alphanumerics.inverted.subtracting(CharacterSet(charactersIn: ":/")))

                        hasDetectedServer = true
                        DispatchQueue.main.async {
                            onServerReady(url)
                        }
                        return
                    }
                }
            }
        }

        private func scheduleInitializingCheck() {
            initializingTimer?.invalidate()
            initializingTimer = Timer.scheduledTimer(withTimeInterval: initializingTimeout, repeats: false) { [weak self] _ in
                guard let self = self else { return }
                DispatchQueue.main.async {
                    // If still initializing after timeout, assume we're now idle
                    if self.status == .initializing {
                        self.status = .idle
                    }
                }
            }
        }

        private func scheduleIdleCheck() {
            idleCheckTimer?.invalidate()
            idleCheckTimer = Timer.scheduledTimer(withTimeInterval: idleTimeout, repeats: false) { [weak self] _ in
                guard let self = self else { return }

                // If no new output since timer was set, check process activity before going idle
                if let lastOutput = self.lastOutputTime,
                   Date().timeIntervalSince(lastOutput) >= self.idleTimeout {

                    // Check process activity using the monitor
                    Task { @MainActor in
                        var shouldTransitionToIdle = true

                        // If we have a shell PID and activity monitor, check actual process activity
                        if let pid = self.shellPid, let monitor = self.activityMonitor {
                            let activityLevel = monitor.getActivityLevel(for: pid)

                            // If process is still active (CPU/IO), stay in working state
                            if activityLevel == .active {
                                shouldTransitionToIdle = false
                                // Reschedule check since process is still active
                                self.scheduleIdleCheck()
                            }
                        }

                        // Only transition to idle from working state if no activity
                        if shouldTransitionToIdle && self.status == .working {
                            self.status = .idle
                        }
                    }
                }
            }
        }

        /// Store the shell PID for activity monitoring
        func setShellPid(_ pid: pid_t) {
            self.shellPid = pid
        }

        func sizeChanged(source: LocalProcessTerminalView, newCols: Int, newRows: Int) {
            // Handle terminal resize
        }

        func setTerminalTitle(source: LocalProcessTerminalView, title: String) {
            // Handle title changes
        }

        func hostCurrentDirectoryUpdate(source: SwiftTerm.TerminalView, directory: String?) {
            // Handle directory changes
        }

        func requestOpenLink(source: SwiftTerm.TerminalView, link: String, params: [String : String]) {
            if let url = URL(string: link) {
                NSWorkspace.shared.open(url)
            }
        }
    }
}

// MARK: - Terminal Session View

struct TerminalSessionView: View {
    let session: SessionInfo
    let workingDirectory: String
    let shouldLaunch: Bool
    @Binding var status: SessionStatus
    @Binding var mode: TerminalMode
    @Binding var assignedBranch: String?
    @ObservedObject var gitManager: GitManager
    let isTerminalLaunched: Bool
    let isClaudeRunning: Bool
    var onLaunchClaude: () -> Void
    var onClose: () -> Void
    var onTerminalLaunched: () -> Void
    var onLaunchTerminal: () -> Void

    // Run App feature props
    var assignedPort: Int?
    var isAppRunning: Bool
    var serverURL: String?
    var onRunApp: () -> Void
    var onCommitAndPush: () -> Void
    var onServerReady: ((String) -> Void)?
    var onControllerReady: ((TerminalController) -> Void)?  // Register controller with SessionManager
    var onCustomAction: ((String) -> Void)?  // Custom quick action callback
    var onProcessStarted: ((pid_t) -> Void)?  // Register PID for native process management
    var activityMonitor: ProcessActivityMonitor?  // For accurate state detection
    var agentState: AgentState?  // MCP-reported agent status

    @State private var terminalController = TerminalController()
    @StateObject private var quickActionManager = QuickActionManager.shared
    @State private var hasRegisteredController = false

    var body: some View {
        VStack(spacing: 0) {
            // Status bar with controls
            HStack(spacing: 6) {
                // Status indicator
                Image(systemName: status.icon)
                    .foregroundColor(status.color)
                    .symbolEffect(.pulse, isActive: status == .working)
                    .font(.caption)

                // Direct mode picker (replaces cycling toggle)
                CompactModePicker(selectedMode: $mode, isDisabled: shouldLaunch)

                // Session label
                Text("\(mode.rawValue) #\(session.id)")
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundColor(mode.color)

                // MCP server selector
                MCPSelector(
                    sessionId: session.id,
                    mcpManager: MCPServerManager.shared,
                    isDisabled: shouldLaunch
                )

                // Skills selector
                SkillSelector(
                    sessionId: session.id,
                    skillManager: SkillManager.shared,
                    isDisabled: shouldLaunch
                )

                // Agent status (only when terminal launched)
                if shouldLaunch, let state = agentState {
                    HStack(spacing: 4) {
                        StatusPill(state: state.state)
                        Text(state.message)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                }

                Spacer()

                // Branch selector (only when terminal not launched)
                if gitManager.isGitRepo && !shouldLaunch {
                    BranchSelector(
                        gitManager: gitManager,
                        selectedBranch: $assignedBranch
                    )
                }

                // Branch label (after terminal launched)
                if gitManager.isGitRepo && shouldLaunch {
                    HStack(spacing: 2) {
                        Image(systemName: "arrow.triangle.branch")
                            .font(.caption2)
                        Text(assignedBranch ?? "Current")
                            .font(.caption2)
                    }
                    .foregroundColor(.secondary)
                }

                // Launch Terminal button (before terminal launched)
                if !shouldLaunch {
                    Button(action: onLaunchTerminal) {
                        HStack(spacing: 2) {
                            Image(systemName: "play.fill")
                            Text("Launch")
                        }
                        .font(.caption2)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .tint(mode.color)
                }

                // Status label
                Text(status.label)
                    .font(.caption2)
                    .foregroundColor(status.color)

                // Close button
                Button(action: onClose) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.secondary)
                        .font(.caption)
                }
                .buttonStyle(.plain)
                .help("Close terminal")
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(status.color.opacity(0.15))

            // Terminal content area
            if shouldLaunch {
                EmbeddedTerminalView(
                    sessionId: session.id,
                    workingDirectory: workingDirectory,
                    status: $status,
                    shouldLaunch: shouldLaunch,
                    assignedBranch: assignedBranch,
                    mode: mode,
                    activityMonitor: activityMonitor,
                    onLaunched: {
                        onTerminalLaunched()
                        // Register controller with SessionManager for Run App feature
                        if !hasRegisteredController {
                            hasRegisteredController = true
                            onControllerReady?(terminalController)
                        }
                    },
                    onCLILaunched: {
                        onLaunchClaude()
                    },
                    onServerReady: onServerReady,
                    onOutputReceived: nil,
                    onProcessStarted: onProcessStarted,
                    controller: terminalController
                )
            } else {
                // Pending state placeholder
                VStack(spacing: 12) {
                    Spacer()

                    Image(systemName: mode.icon)
                        .font(.system(size: 32))
                        .foregroundColor(mode.color.opacity(0.5))

                    Text("Select branch and click Launch")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    if let branch = assignedBranch {
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.triangle.branch")
                            Text(branch)
                        }
                        .font(.caption2)
                        .foregroundColor(.blue)
                    } else {
                        Text("Using current branch")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }

                    Spacer()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(NSColor.textBackgroundColor).opacity(0.5))
            }

            // Footer bar with quick actions (only when terminal is launched)
            if shouldLaunch {
                HStack(spacing: 6) {
                    // Quick Actions (when AI CLI is running)
                    if isClaudeRunning {
                        ForEach(quickActionManager.sortedActions) { action in
                            Button {
                                onCustomAction?(action.prompt)
                            } label: {
                                HStack(spacing: 2) {
                                    Image(systemName: action.icon)
                                    Text(action.name)
                                }
                                .font(.caption2)
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .tint(action.color)
                        }
                    }

                    // Port badge (when app is running)
                    if isAppRunning, let port = assignedPort {
                        Text(":\(port)")
                            .font(.caption2)
                            .fontWeight(.medium)
                            .foregroundColor(.green)
                            .padding(.horizontal, 4)
                            .background(Color.green.opacity(0.15))
                            .cornerRadius(4)
                    }

                    // Open in Browser button (when server URL detected)
                    if let url = serverURL {
                        Button(action: { openInBrowser(url) }) {
                            HStack(spacing: 2) {
                                Image(systemName: "safari")
                                Text("Open")
                            }
                            .font(.caption2)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                        .tint(.blue)
                    }

                    // Running indicator (for native apps without URL)
                    if isAppRunning && serverURL == nil {
                        HStack(spacing: 2) {
                            Image(systemName: "app.badge.checkmark")
                            Text("Running")
                        }
                        .font(.caption2)
                        .foregroundColor(.green)
                    }

                    Spacer()
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(status.color.opacity(0.15))
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(shouldLaunch ? status.color : Color.gray.opacity(0.5), lineWidth: 2)
        )
    }

    private func openInBrowser(_ urlString: String) {
        if let url = URL(string: urlString) {
            NSWorkspace.shared.open(url)
        }
    }
}
