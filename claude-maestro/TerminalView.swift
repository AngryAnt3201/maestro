//
//  TerminalView.swift
//  claude-maestro
//
//  Created by Jack on 6/1/2026.
//

import SwiftUI
import AppKit
import SwiftTerm

// MARK: - Terminal Color Scheme

/// Defines a complete color scheme for terminal appearance
/// Supports both light and dark themes with full ANSI color palette
struct TerminalColorScheme {
    let foreground: NSColor
    let background: NSColor
    let cursorColor: NSColor
    let cursorTextColor: NSColor
    let selectionColor: NSColor
    let ansiColors: [SwiftTerm.Color]

    // MARK: - Catppuccin Mocha (Dark Theme)
    // Note: Using deviceRed/calibratedRed ensures proper color space conversion on all macOS versions
    // This fixes black text issues on macOS Tahoe (26.x) where generic RGB colors may not convert correctly
    static let mocha = TerminalColorScheme(
        foreground: NSColor(deviceRed: 205/255.0, green: 214/255.0, blue: 244/255.0, alpha: 1.0),  // Text
        background: NSColor(deviceRed: 30/255.0, green: 30/255.0, blue: 46/255.0, alpha: 1.0),     // Base
        cursorColor: NSColor(deviceRed: 245/255.0, green: 194/255.0, blue: 231/255.0, alpha: 1.0), // Pink
        cursorTextColor: NSColor(deviceRed: 30/255.0, green: 30/255.0, blue: 46/255.0, alpha: 1.0), // Base (for contrast)
        selectionColor: NSColor(deviceRed: 88/255.0, green: 91/255.0, blue: 112/255.0, alpha: 0.5), // Surface2 semi-transparent
        // Note: SwiftTerm.Color uses 16-bit values (0-65535), not 8-bit (0-255)
        // Multiply 8-bit values by 257 to convert: 255 * 257 = 65535
        ansiColors: [
            // Standard colors (0-7)
            SwiftTerm.Color(red: 40 * 257, green: 42 * 257, blue: 54 * 257),      // Black (darker for visibility)
            SwiftTerm.Color(red: 243 * 257, green: 139 * 257, blue: 168 * 257),   // Red
            SwiftTerm.Color(red: 166 * 257, green: 227 * 257, blue: 161 * 257),   // Green
            SwiftTerm.Color(red: 249 * 257, green: 226 * 257, blue: 175 * 257),   // Yellow
            SwiftTerm.Color(red: 137 * 257, green: 180 * 257, blue: 250 * 257),   // Blue
            SwiftTerm.Color(red: 245 * 257, green: 194 * 257, blue: 231 * 257),   // Magenta (Pink)
            SwiftTerm.Color(red: 148 * 257, green: 226 * 257, blue: 213 * 257),   // Cyan (Teal)
            SwiftTerm.Color(red: 186 * 257, green: 194 * 257, blue: 222 * 257),   // White (Subtext1)
            // Bright colors (8-15)
            SwiftTerm.Color(red: 108 * 257, green: 112 * 257, blue: 134 * 257),   // Bright Black (Overlay0)
            SwiftTerm.Color(red: 243 * 257, green: 139 * 257, blue: 168 * 257),   // Bright Red
            SwiftTerm.Color(red: 166 * 257, green: 227 * 257, blue: 161 * 257),   // Bright Green
            SwiftTerm.Color(red: 249 * 257, green: 226 * 257, blue: 175 * 257),   // Bright Yellow
            SwiftTerm.Color(red: 137 * 257, green: 180 * 257, blue: 250 * 257),   // Bright Blue
            SwiftTerm.Color(red: 245 * 257, green: 194 * 257, blue: 231 * 257),   // Bright Magenta
            SwiftTerm.Color(red: 148 * 257, green: 226 * 257, blue: 213 * 257),   // Bright Cyan
            SwiftTerm.Color(red: 205 * 257, green: 214 * 257, blue: 244 * 257),   // Bright White (Text)
        ]
    )

    // MARK: - Catppuccin Latte (Light Theme)
    static let latte = TerminalColorScheme(
        foreground: NSColor(deviceRed: 76/255.0, green: 79/255.0, blue: 105/255.0, alpha: 1.0),    // Text
        background: NSColor(deviceRed: 239/255.0, green: 241/255.0, blue: 245/255.0, alpha: 1.0),  // Base
        cursorColor: NSColor(deviceRed: 136/255.0, green: 57/255.0, blue: 239/255.0, alpha: 1.0),  // Mauve
        cursorTextColor: NSColor(deviceRed: 239/255.0, green: 241/255.0, blue: 245/255.0, alpha: 1.0), // Base (for contrast)
        selectionColor: NSColor(deviceRed: 172/255.0, green: 176/255.0, blue: 190/255.0, alpha: 0.5),  // Surface2 semi-transparent
        // Note: SwiftTerm.Color uses 16-bit values (0-65535), not 8-bit (0-255)
        // Multiply 8-bit values by 257 to convert: 255 * 257 = 65535
        ansiColors: [
            // Standard colors (0-7)
            SwiftTerm.Color(red: 92 * 257, green: 95 * 257, blue: 119 * 257),     // Black (Subtext1)
            SwiftTerm.Color(red: 210 * 257, green: 15 * 257, blue: 57 * 257),     // Red
            SwiftTerm.Color(red: 64 * 257, green: 160 * 257, blue: 43 * 257),     // Green
            SwiftTerm.Color(red: 223 * 257, green: 142 * 257, blue: 29 * 257),    // Yellow
            SwiftTerm.Color(red: 30 * 257, green: 102 * 257, blue: 245 * 257),    // Blue
            SwiftTerm.Color(red: 136 * 257, green: 57 * 257, blue: 239 * 257),    // Magenta (Mauve)
            SwiftTerm.Color(red: 23 * 257, green: 146 * 257, blue: 153 * 257),    // Cyan (Teal)
            SwiftTerm.Color(red: 188 * 257, green: 192 * 257, blue: 204 * 257),   // White (Surface1)
            // Bright colors (8-15)
            SwiftTerm.Color(red: 140 * 257, green: 143 * 257, blue: 161 * 257),   // Bright Black (Overlay0)
            SwiftTerm.Color(red: 210 * 257, green: 15 * 257, blue: 57 * 257),     // Bright Red
            SwiftTerm.Color(red: 64 * 257, green: 160 * 257, blue: 43 * 257),     // Bright Green
            SwiftTerm.Color(red: 223 * 257, green: 142 * 257, blue: 29 * 257),    // Bright Yellow
            SwiftTerm.Color(red: 30 * 257, green: 102 * 257, blue: 245 * 257),    // Bright Blue
            SwiftTerm.Color(red: 136 * 257, green: 57 * 257, blue: 239 * 257),    // Bright Magenta
            SwiftTerm.Color(red: 23 * 257, green: 146 * 257, blue: 153 * 257),    // Bright Cyan
            SwiftTerm.Color(red: 76 * 257, green: 79 * 257, blue: 105 * 257),     // Bright White (Text)
        ]
    )

    /// Returns the appropriate color scheme for the given appearance mode
    static func scheme(for mode: AppearanceMode) -> TerminalColorScheme {
        switch mode {
        case .dark:
            return .mocha
        case .light:
            return .latte
        }
    }
}

// MARK: - Custom Terminal View

/// Custom terminal view that accepts first mouse click for immediate interaction
/// This enables text selection and copy even when the window is not focused
class MaestroTerminalView: LocalProcessTerminalView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        return true  // Accept clicks even when window is inactive
    }

    // Intercept key equivalents so SwiftUI doesn't swallow Cmd+C/V
    // Only handle if THIS terminal is the first responder (fixes multi-split paste issue)
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard event.modifierFlags.contains(.command) else {
            return super.performKeyEquivalent(with: event)
        }

        // Only handle if this terminal is the first responder
        guard window?.firstResponder == self else {
            return super.performKeyEquivalent(with: event)
        }

        switch event.charactersIgnoringModifiers {
        case "c":
            copy(self)
            return true
        case "v":
            paste(self)
            return true
        case "a":
            selectAll(self)
            return true
        default:
            return super.performKeyEquivalent(with: event)
        }
    }

    // Ensure the terminal view receives mouse events by making it the hit test target
    // This is needed for SwiftUI/AppKit bridging to work properly
    override func hitTest(_ point: NSPoint) -> NSView? {
        // Check if point is within our bounds
        let result = super.hitTest(point)
        // If the hit test returns us or a subview, ensure we become first responder
        // so that subsequent mouse events are handled correctly
        if result != nil {
            window?.makeFirstResponder(self)
        }
        return result
    }

    // Right-click context menu for native experience
    override func menu(for event: NSEvent) -> NSMenu? {
        let menu = NSMenu()

        let copyItem = NSMenuItem(title: "Copy", action: #selector(copy(_:)), keyEquivalent: "c")
        copyItem.target = self  // Explicitly set target
        copyItem.keyEquivalentModifierMask = .command
        menu.addItem(copyItem)

        let pasteItem = NSMenuItem(title: "Paste", action: #selector(paste(_:)), keyEquivalent: "v")
        pasteItem.target = self  // Explicitly set target
        pasteItem.keyEquivalentModifierMask = .command
        menu.addItem(pasteItem)

        menu.addItem(NSMenuItem.separator())

        let selectAllItem = NSMenuItem(title: "Select All", action: #selector(selectAll(_:)), keyEquivalent: "a")
        selectAllItem.target = self  // Explicitly set target
        selectAllItem.keyEquivalentModifierMask = .command
        menu.addItem(selectAllItem)

        let clearItem = NSMenuItem(title: "Clear", action: #selector(clearTerminal(_:)), keyEquivalent: "k")
        clearItem.target = self  // Explicitly set target
        menu.addItem(clearItem)

        return menu
    }

    @objc func clearTerminal(_ sender: Any?) {
        send(txt: "clear\r")
    }
}

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

// MARK: - Color Scheme Helper

/// Applies a color scheme to a terminal view
private func applyColorScheme(_ scheme: TerminalColorScheme, to terminal: MaestroTerminalView) {
    // Install ANSI color palette first - this clears the color cache
    terminal.installColors(scheme.ansiColors)

    // Set default foreground/background colors
    terminal.nativeForegroundColor = scheme.foreground
    terminal.nativeBackgroundColor = scheme.background

    // Set caret (cursor) colors
    terminal.caretColor = scheme.cursorColor
    terminal.caretTextColor = scheme.cursorTextColor
    terminal.selectedTextBackgroundColor = scheme.selectionColor

    // Force a display refresh to ensure all colors are applied
    terminal.needsDisplay = true
}

// MARK: - Embedded Terminal View

struct EmbeddedTerminalView: NSViewRepresentable {
    let sessionId: Int
    let workingDirectory: String
    @Binding var status: SessionStatus
    let shouldLaunch: Bool
    let assignedBranch: String?
    let mode: TerminalMode
    let appearanceMode: AppearanceMode
    var activityMonitor: ProcessActivityMonitor?  // For process-level activity detection
    var onLaunched: () -> Void
    var onCLILaunched: () -> Void
    var onServerReady: ((String) -> Void)?  // Called with detected server URL
    var onOutputReceived: ((String) -> Void)?  // Called with terminal output for output pane
    var onProcessStarted: ((pid_t) -> Void)?  // Called with shell PID for process registration
    var controller: TerminalController?

    func makeNSView(context: Context) -> MaestroTerminalView {
        let terminal = MaestroTerminalView(frame: .zero)
        terminal.processDelegate = context.coordinator

        // Configure terminal font with Nerd Font support for oh-my-zsh icons
        terminal.font = Self.getTerminalFont()

        // Apply color scheme based on current appearance mode
        let scheme = TerminalColorScheme.scheme(for: appearanceMode)
        applyColorScheme(scheme, to: terminal)

        context.coordinator.terminal = terminal
        controller?.coordinator = context.coordinator
        return terminal
    }

    func updateNSView(_ terminal: MaestroTerminalView, context: Context) {
        // Apply color scheme for dynamic theme switching
        let scheme = TerminalColorScheme.scheme(for: appearanceMode)
        applyColorScheme(scheme, to: terminal)

        if shouldLaunch && !context.coordinator.hasLaunched {
            context.coordinator.hasLaunched = true
            launchTerminal(in: terminal)
            onLaunched()

            // Make terminal first responder to receive keyboard input
            // Use retry mechanism since window may not be attached immediately
            makeFirstResponderWithRetry(terminal: terminal, attempts: 5)
        }
    }

    /// Attempts to make the terminal first responder, retrying if window is not available
    private func makeFirstResponderWithRetry(terminal: MaestroTerminalView, attempts: Int, delay: TimeInterval = 0.1) {
        guard attempts > 0 else { return }

        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            if let window = terminal.window {
                window.makeFirstResponder(terminal)
                // Don't force makeKeyAndOrderFront - let SwiftUI manage window state
                // This prevents stealing focus and interfering with mouse event delivery
            } else {
                // Window not yet available, retry with exponential backoff
                self.makeFirstResponderWithRetry(
                    terminal: terminal,
                    attempts: attempts - 1,
                    delay: delay * 1.5
                )
            }
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

    /// Get the terminal font, preferring Nerd Fonts for oh-my-zsh icon support
    /// Priority: User preference > Any installed Nerd Font > System monospace font
    private static func getTerminalFont() -> NSFont {
        let fontSize: CGFloat = 13

        // Check user preference first
        if let savedFontName = UserDefaults.standard.string(forKey: "terminal-font-name"),
           let customFont = NSFont(name: savedFontName, size: fontSize) {
            return customFont
        }

        // Dynamically find any installed Nerd Font
        if let nerdFont = findInstalledNerdFont(size: fontSize) {
            return nerdFont
        }

        // Fallback to system monospace font
        return NSFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
    }

    /// Dynamically searches for any installed Nerd Font
    /// Prefers monospace variants and popular fonts (Meslo, FiraCode, JetBrains)
    private static func findInstalledNerdFont(size: CGFloat) -> NSFont? {
        let fontManager = NSFontManager.shared
        let allFonts = fontManager.availableFontFamilies

        // Filter for Nerd Font families (contain "Nerd Font" or end with "NF")
        let nerdFontFamilies = allFonts.filter { family in
            family.contains("Nerd Font") || family.hasSuffix(" NF")
        }

        // Preferred font families in order (popular terminal fonts first)
        let preferredPrefixes = ["Meslo", "FiraCode", "Fira Code", "JetBrains", "Cascadia", "Hack", "Source Code", "Inconsolata"]

        // Sort: preferred fonts first, then prefer Mono variants
        let sortedFamilies = nerdFontFamilies.sorted { a, b in
            let aPreferredIndex = preferredPrefixes.firstIndex { a.hasPrefix($0) } ?? Int.max
            let bPreferredIndex = preferredPrefixes.firstIndex { b.hasPrefix($0) } ?? Int.max
            if aPreferredIndex != bPreferredIndex {
                return aPreferredIndex < bPreferredIndex
            }
            // Prefer Mono variants for terminal use
            let aMono = a.contains("Mono")
            let bMono = b.contains("Mono")
            if aMono != bMono { return aMono }
            return a < b
        }

        // Try to get a Regular weight font from the first available family
        for family in sortedFamilies {
            if let members = fontManager.availableMembers(ofFontFamily: family) {
                // Look for Regular weight first
                for member in members {
                    if let fontName = member[0] as? String,
                       let weight = member[2] as? Int,
                       weight >= 4 && weight <= 6 {  // Regular weight range
                        if let font = NSFont(name: fontName, size: size) {
                            return font
                        }
                    }
                }
                // Fallback to first available member
                if let fontName = members.first?[0] as? String,
                   let font = NSFont(name: fontName, size: size) {
                    return font
                }
            }
        }

        return nil
    }

    private func launchTerminal(in terminal: MaestroTerminalView) {
        let shell = Foundation.ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"

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

        // Note: Branch checkout is handled by worktree isolation
        // Each session with an assigned branch gets its own worktree directory

        if mode == .plainTerminal {
            // Plain terminal - launch interactive login shell directly
            // Using -l (login) and -i (interactive) ensures the shell stays open
            // and sources profile files automatically
            terminal.startProcess(
                executable: shell,
                args: ["-l", "-i"],
                environment: nil,
                execName: nil
            )
            // Send cd command after shell starts to change to working directory
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                terminal.send(txt: "cd '\(self.workingDirectory)'\r")
            }
        } else {
            // AI CLI mode - launch interactive login shell then send CLI command
            // This allows the shell to persist after the AI CLI exits, enabling the user to:
            // - run additional shell commands
            // - re-launch the AI CLI if needed
            // - inspect files or run build commands
            terminal.startProcess(
                executable: shell,
                args: ["-l", "-i"],
                environment: nil,
                execName: nil
            )

            // Send setup and CLI launch commands after shell starts
            // Source user's shell profile to get full environment (PATH, NVM, etc.)
            // This is necessary because macOS apps launched from Finder have a limited environment
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                // Build command sequence that sources profiles, changes directory, and launches CLI
                let setupCommands = """
                    if [ -f ~/.zprofile ]; then source ~/.zprofile 2>/dev/null; fi
                    if [ -f ~/.zshrc ]; then source ~/.zshrc 2>/dev/null; fi
                    if [ -f ~/.bash_profile ]; then source ~/.bash_profile 2>/dev/null; fi
                    if [ -f ~/.bashrc ]; then source ~/.bashrc 2>/dev/null; fi
                    clear
                    cd '\(self.workingDirectory)'
                    \(self.mode.command ?? "echo 'No CLI configured'")
                    """

                // Send each command line separately for better compatibility
                for line in setupCommands.split(separator: "\n") {
                    let trimmed = line.trimmingCharacters(in: .whitespaces)
                    if !trimmed.isEmpty {
                        terminal.send(txt: "\(trimmed)\r")
                    }
                }

                // Mark CLI as launched after sending commands
                self.onCLILaunched()
            }
        }

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
        weak var terminal: MaestroTerminalView?

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
                // Plain terminals should stay idle when shell exits (not "done" since there's no task)
                if self.mode == .plainTerminal {
                    self.status = .idle
                } else if exitCode == 0 {
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
    let appearanceMode: AppearanceMode
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
    @State private var showMissingToolAlert = false
    @State private var missingToolName: String = ""

    var body: some View {
        VStack(spacing: 0) {
            // Status bar with controls
            HStack(spacing: 6) {
                // Status indicator
                Group {
                    if #available(macOS 14.0, *) {
                        Image(systemName: status.icon)
                            .foregroundColor(status.color)
                            .symbolEffect(.pulse, isActive: status == .working)
                            .font(.caption)
                    } else {
                        Image(systemName: status.icon)
                            .foregroundColor(status.color)
                            .font(.caption)
                    }
                }

                // Direct mode picker (replaces cycling toggle)
                CompactModePicker(selectedMode: $mode, isDisabled: shouldLaunch)

                // Session label
                Text("\(mode.rawValue) #\(session.id)")
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundColor(mode.color)

                // MCP server selector (AI modes only)
                if mode.isAIMode {
                    MCPSelector(
                        sessionId: session.id,
                        mcpManager: MCPServerManager.shared,
                        isDisabled: shouldLaunch
                    )

                    // Skills & Commands selector
                    CapabilitySelector(
                        sessionId: session.id,
                        skillManager: SkillManager.shared,
                        commandManager: CommandManager.shared,
                        isDisabled: shouldLaunch
                    )
                }

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
                    Button(action: {
                        // Check if CLI tool is available before launching
                        if mode.isAIMode && !mode.isToolAvailable() {
                            missingToolName = mode.command ?? "unknown"
                            showMissingToolAlert = true
                        } else {
                            onLaunchTerminal()
                        }
                    }) {
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
                    appearanceMode: appearanceMode,
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
                // Pending state placeholder - centered with fitted backdrop
                ZStack {
                    // Terminal-like background (matches system theme)
                    Color(NSColor.controlBackgroundColor)

                    // Content with fitted backdrop
                    VStack(spacing: 12) {
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
                    }
                    .padding(.horizontal, 24)
                    .padding(.vertical, 20)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color(NSColor.textBackgroundColor).opacity(0.85))
                    )
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
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
        .alert("CLI Tool Not Found", isPresented: $showMissingToolAlert) {
            Button("Copy Install Command") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(mode.installationHint, forType: .string)
            }
            Button("Launch Plain Terminal") {
                mode = .plainTerminal
                onLaunchTerminal()
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("'\(missingToolName)' command not found.\n\nInstall with:\n\(mode.installationHint)")
        }
    }

    private func openInBrowser(_ urlString: String) {
        if let url = URL(string: urlString) {
            NSWorkspace.shared.open(url)
        }
    }
}
