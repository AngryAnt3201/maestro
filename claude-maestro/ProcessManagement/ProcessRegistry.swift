import Foundation
import Darwin

/// Source of a registered process
public enum ProcessSource: String, Sendable, CaseIterable {
    case terminal       // SwiftTerm terminal process
    case devServer      // Development server started via MCP
    case background     // Background task
    case system         // System/external process
}

/// Information about a registered process
public struct RegisteredProcess: Sendable, Identifiable {
    public let id: UUID
    public let pid: pid_t
    public let pgid: pid_t
    public let sessionId: Int
    public let source: ProcessSource
    public let command: String
    public let workingDirectory: String?
    public let registeredAt: Date

    public init(
        pid: pid_t,
        pgid: pid_t,
        sessionId: Int,
        source: ProcessSource,
        command: String,
        workingDirectory: String? = nil
    ) {
        self.id = UUID()
        self.pid = pid
        self.pgid = pgid
        self.sessionId = sessionId
        self.source = source
        self.command = command
        self.workingDirectory = workingDirectory
        self.registeredAt = Date()
    }
}

/// Unified tracking of ALL processes (terminals + dev servers)
/// Thread-safe via actor isolation
public actor ProcessRegistry {

    /// All registered processes by PID
    private var processesByPid: [pid_t: RegisteredProcess] = [:]

    /// Processes grouped by session
    private var processesBySession: [Int: Set<pid_t>] = [:]

    /// Process groups we manage
    private var managedGroups: Set<pid_t> = []

    /// Callbacks for process registration/removal
    public var onProcessRegistered: ((RegisteredProcess) -> Void)?
    public var onProcessRemoved: ((RegisteredProcess) -> Void)?

    public init() {}

    // MARK: - Registration

    /// Register a new process
    /// - Parameters:
    ///   - pid: Process ID
    ///   - pgid: Process group ID (defaults to pid)
    ///   - sessionId: Session this process belongs to
    ///   - source: Where the process came from
    ///   - command: Command that was run
    ///   - workingDirectory: Working directory
    /// - Returns: The registered process info
    @discardableResult
    public func register(
        pid: pid_t,
        pgid: pid_t? = nil,
        sessionId: Int,
        source: ProcessSource,
        command: String,
        workingDirectory: String? = nil
    ) -> RegisteredProcess {
        let actualPgid = pgid ?? pid

        let process = RegisteredProcess(
            pid: pid,
            pgid: actualPgid,
            sessionId: sessionId,
            source: source,
            command: command,
            workingDirectory: workingDirectory
        )

        processesByPid[pid] = process

        if processesBySession[sessionId] == nil {
            processesBySession[sessionId] = []
        }
        processesBySession[sessionId]?.insert(pid)

        managedGroups.insert(actualPgid)

        onProcessRegistered?(process)

        return process
    }

    /// Unregister a process
    /// - Parameter pid: Process ID to unregister
    /// - Returns: The removed process info, or nil if not found
    @discardableResult
    public func unregister(pid: pid_t) -> RegisteredProcess? {
        guard let process = processesByPid.removeValue(forKey: pid) else {
            return nil
        }

        processesBySession[process.sessionId]?.remove(pid)

        // Remove from managed groups if no other process uses this pgid
        let pgidStillUsed = processesByPid.values.contains { $0.pgid == process.pgid }
        if !pgidStillUsed {
            managedGroups.remove(process.pgid)
        }

        onProcessRemoved?(process)

        return process
    }

    // MARK: - Queries

    /// Get a registered process by PID
    public func getProcess(pid: pid_t) -> RegisteredProcess? {
        processesByPid[pid]
    }

    /// Get all processes for a session
    public func getProcesses(forSession sessionId: Int) -> [RegisteredProcess] {
        guard let pids = processesBySession[sessionId] else { return [] }
        return pids.compactMap { processesByPid[$0] }
    }

    /// Get all processes of a specific source type
    public func getProcesses(source: ProcessSource) -> [RegisteredProcess] {
        processesByPid.values.filter { $0.source == source }
    }

    /// Get all registered processes
    public var allProcesses: [RegisteredProcess] {
        Array(processesByPid.values)
    }

    /// Get all registered PIDs
    public var allPids: [pid_t] {
        Array(processesByPid.keys)
    }

    /// Get all session IDs with registered processes
    public var activeSessions: [Int] {
        Array(processesBySession.keys.filter { !($0 == 0 || (processesBySession[$0]?.isEmpty ?? true)) })
    }

    /// Check if a PID is registered
    public func isRegistered(pid: pid_t) -> Bool {
        processesByPid[pid] != nil
    }

    /// Check if a process group is managed by us
    public func isManagedGroup(pgid: pid_t) -> Bool {
        managedGroups.contains(pgid)
    }

    // MARK: - Session Cleanup

    /// Remove all processes for a session and optionally kill them
    /// - Parameters:
    ///   - sessionId: Session ID
    ///   - killProcesses: If true, sends SIGTERM/SIGKILL to process groups
    /// - Returns: List of removed processes
    @discardableResult
    public func cleanupSession(_ sessionId: Int, killProcesses: Bool = true) -> [RegisteredProcess] {
        guard let pids = processesBySession[sessionId] else { return [] }

        var removed: [RegisteredProcess] = []
        var groupsToKill: Set<pid_t> = []

        for pid in pids {
            if let process = processesByPid.removeValue(forKey: pid) {
                removed.append(process)
                groupsToKill.insert(process.pgid)
                onProcessRemoved?(process)
            }
        }

        processesBySession.removeValue(forKey: sessionId)

        // Kill process groups
        if killProcesses {
            for pgid in groupsToKill {
                // Send SIGTERM to process group
                killpg(pgid, SIGTERM)
            }

            // Schedule SIGKILL after delay if needed
            Task {
                try? await Task.sleep(nanoseconds: 3_000_000_000) // 3 seconds

                for pgid in groupsToKill {
                    // Check if any processes in group still exist
                    if killpg(pgid, 0) == 0 {
                        // Still alive, send SIGKILL
                        killpg(pgid, SIGKILL)
                    }
                }
            }
        }

        // Clean up managed groups
        for pgid in groupsToKill {
            let pgidStillUsed = processesByPid.values.contains { $0.pgid == pgid }
            if !pgidStillUsed {
                managedGroups.remove(pgid)
            }
        }

        return removed
    }

    /// Cleanup all sessions
    /// - Parameter killProcesses: If true, kills all managed processes
    public func cleanupAll(killProcesses: Bool = true) {
        for sessionId in processesBySession.keys {
            cleanupSession(sessionId, killProcesses: killProcesses)
        }
    }

    // MARK: - Orphan Detection (Registry-level)

    /// Find orphaned processes (processes we registered that no longer exist)
    public func findOrphans() -> [RegisteredProcess] {
        processesByPid.values.filter { process in
            // Check if process still exists
            kill(process.pid, 0) != 0 && errno == ESRCH
        }
    }

    /// Remove orphaned processes from registry
    /// - Returns: List of removed orphans
    @discardableResult
    public func cleanupOrphans() -> [RegisteredProcess] {
        let orphans = findOrphans()
        for orphan in orphans {
            _ = unregister(pid: orphan.pid)
        }
        return orphans
    }

    // MARK: - System-Wide Orphan Detection

    /// Find orphaned AI agent processes in the system (PPID=1, not managed by us)
    /// These are Claude/Gemini/Codex processes that have been reparented to launchd
    /// - Returns: Array of ProcessInfo for orphaned AI processes
    public func findOrphanedAgentProcesses() async -> [ProcessInfo] {
        let processTree = ProcessTree()
        let allProcesses = await processTree.getAllProcesses(includeSystem: false)

        // AI agent process names to look for
        let agentNames: Set<String> = ["claude", "gemini", "codex"]

        // Path patterns for AI agents with versioned binaries
        // Note: Claude Code binary is at ~/.local/share/claude/versions/X.X.X
        // so pbi_name returns the version number, not "claude"
        let agentPathPatterns = [
            "/.local/share/claude/",      // Claude Code installation
            "/.local/bin/claude",          // Claude symlink
            "/claude/versions/",           // Claude versioned binary
            "/gemini/",                     // Gemini CLI
            "/codex"                        // OpenAI Codex
        ]

        return allProcesses.filter { proc in
            // Check if orphaned (reparented to launchd/PID 1)
            guard proc.ppid == 1 else { return false }

            // Not managed by us
            guard !isRegistered(pid: proc.pid) else { return false }

            // Check 1: Direct name match (works for some agents)
            if agentNames.contains(proc.name.lowercased()) {
                return true
            }

            // Check 2: Path-based detection for versioned binaries
            if let path = proc.path?.lowercased() {
                for pattern in agentPathPatterns {
                    if path.contains(pattern.lowercased()) {
                        return true
                    }
                }
            }

            return false
        }
    }

    /// Get count of orphaned AI agent processes
    public func orphanedAgentCount() async -> Int {
        await findOrphanedAgentProcesses().count
    }

    /// Terminate orphaned AI agent processes gracefully
    /// - Returns: Number of processes terminated
    @discardableResult
    public func terminateOrphanedAgentProcesses() async -> Int {
        let orphans = await findOrphanedAgentProcesses()
        guard !orphans.isEmpty else { return 0 }

        var terminatedCount = 0

        // Send SIGTERM to each process group
        for orphan in orphans {
            let pgid = getpgid(orphan.pid)
            if pgid > 0 {
                // Kill the entire process group
                if killpg(pgid, SIGTERM) == 0 {
                    terminatedCount += 1
                }
            } else {
                // Fallback: kill just the process
                if kill(orphan.pid, SIGTERM) == 0 {
                    terminatedCount += 1
                }
            }
        }

        // Schedule SIGKILL after grace period for any stubborn processes
        if terminatedCount > 0 {
            Task {
                try? await Task.sleep(nanoseconds: 3_000_000_000) // 3 seconds

                for orphan in orphans {
                    let pgid = getpgid(orphan.pid)
                    if pgid > 0 {
                        // Check if process group still exists
                        if killpg(pgid, 0) == 0 {
                            killpg(pgid, SIGKILL)
                        }
                    } else {
                        // Check if process still exists
                        if kill(orphan.pid, 0) == 0 {
                            kill(orphan.pid, SIGKILL)
                        }
                    }
                }
            }
        }

        return terminatedCount
    }

    /// Terminate a specific orphaned process by PID
    /// - Parameter pid: Process ID to terminate
    /// - Returns: True if termination signal was sent
    public func terminateOrphanedProcess(pid: pid_t) -> Bool {
        let pgid = getpgid(pid)
        if pgid > 0 {
            if killpg(pgid, SIGTERM) == 0 {
                // Schedule SIGKILL after grace period
                Task {
                    try? await Task.sleep(nanoseconds: 3_000_000_000)
                    if killpg(pgid, 0) == 0 {
                        killpg(pgid, SIGKILL)
                    }
                }
                return true
            }
        } else {
            if kill(pid, SIGTERM) == 0 {
                Task {
                    try? await Task.sleep(nanoseconds: 3_000_000_000)
                    if kill(pid, 0) == 0 {
                        kill(pid, SIGKILL)
                    }
                }
                return true
            }
        }
        return false
    }

    // MARK: - Statistics

    /// Get count of processes per session
    public var sessionProcessCounts: [Int: Int] {
        var counts: [Int: Int] = [:]
        for (sessionId, pids) in processesBySession {
            counts[sessionId] = pids.count
        }
        return counts
    }

    /// Get count of processes per source type
    public var sourceProcessCounts: [ProcessSource: Int] {
        var counts: [ProcessSource: Int] = [:]
        for source in ProcessSource.allCases {
            counts[source] = 0
        }
        for process in processesByPid.values {
            counts[process.source, default: 0] += 1
        }
        return counts
    }
}
