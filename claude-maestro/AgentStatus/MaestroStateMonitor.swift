import Foundation
import Combine
import AppKit
import CryptoKit

/// Monitors agent state files written by the maestro-status MCP server.
/// Polls /tmp/maestro/agents/ every 0.5 seconds and publishes agent states.
/// Supports project-scoped directories for multi-project isolation.
@MainActor
class MaestroStateMonitor: ObservableObject {
    /// Current agent states keyed by agent ID
    @Published private(set) var agents: [String: AgentState] = [:]

    /// Base directory where agent state files are written
    private let baseStateDir: String

    /// Project-specific subdirectory (nil for legacy single-project mode)
    private var projectHash: String?

    /// Polling timer
    private var timer: Timer?

    /// Polling interval in seconds
    private let pollInterval: TimeInterval

    /// File manager for directory operations
    private let fileManager = FileManager.default

    /// JSON decoder for parsing state files
    private let decoder = JSONDecoder()

    /// Maximum age for state files before cleanup (5 minutes)
    private let maxStateAge: TimeInterval = 300

    /// Previous agent states for detecting transitions
    private var previousStates: [String: AgentStatusState] = [:]

    /// Effective state directory (project-scoped or legacy)
    var stateDir: String {
        if let hash = projectHash {
            return (baseStateDir as NSString).appendingPathComponent(hash)
        }
        return baseStateDir
    }

    init(stateDir: String = "/tmp/maestro/agents", pollInterval: TimeInterval = 0.5) {
        self.baseStateDir = stateDir
        self.pollInterval = pollInterval
    }

    /// Initialize with project-scoped directory
    /// - Parameters:
    ///   - projectPath: Path to the project (used to generate unique hash)
    ///   - pollInterval: Polling interval in seconds
    convenience init(projectPath: String, pollInterval: TimeInterval = 0.5) {
        self.init(stateDir: "/tmp/maestro/agents", pollInterval: pollInterval)
        self.projectHash = Self.generateProjectHash(projectPath)
    }

    /// Generate a stable hash for a project path
    /// Uses first 12 characters of SHA256 for uniqueness with reasonable length
    static func generateProjectHash(_ projectPath: String) -> String {
        let data = Data(projectPath.utf8)
        let hash = SHA256.hash(data: data)
        let hashString = hash.compactMap { String(format: "%02x", $0) }.joined()
        return String(hashString.prefix(12))
    }

    /// Set the project path for scoped state directory
    func setProjectPath(_ projectPath: String) {
        self.projectHash = Self.generateProjectHash(projectPath)
        // Recreate state directory for new project
        ensureStateDir()
        // Clear old agents and poll new directory
        agents.removeAll()
        previousStates.removeAll()
        pollStateFiles()
    }

    /// Clear project scoping (use legacy single directory)
    func clearProjectScope() {
        self.projectHash = nil
        agents.removeAll()
        previousStates.removeAll()
    }

    deinit {
        timer?.invalidate()
    }

    /// Start monitoring agent state files
    func start() {
        guard timer == nil else { return }

        // Ensure state directory exists
        ensureStateDir()

        // Initial poll
        pollStateFiles()

        // Schedule timer for continuous polling
        timer = Timer.scheduledTimer(withTimeInterval: pollInterval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.pollStateFiles()
            }
        }
    }

    /// Stop monitoring
    func stop() {
        timer?.invalidate()
        timer = nil
    }

    /// Get agent state for a specific session ID
    func agentState(forSessionId sessionId: Int) -> AgentState? {
        let agentId = "agent-\(sessionId)"
        return agents[agentId]
    }

    /// Get all agents sorted by session ID
    var sortedAgents: [AgentState] {
        agents.values.sorted { ($0.sessionId ?? 0) < ($1.sessionId ?? 0) }
    }

    // MARK: - Private Methods

    private func ensureStateDir() {
        if !fileManager.fileExists(atPath: stateDir) {
            try? fileManager.createDirectory(atPath: stateDir, withIntermediateDirectories: true)
        }
    }

    private func pollStateFiles() {
        guard let files = try? fileManager.contentsOfDirectory(atPath: stateDir) else {
            return
        }

        var newAgents: [String: AgentState] = [:]
        let now = Date()

        for file in files where file.hasSuffix(".json") {
            let filePath = (stateDir as NSString).appendingPathComponent(file)

            // Check if file is stale and should be cleaned up
            if let attributes = try? fileManager.attributesOfItem(atPath: filePath),
               let modDate = attributes[.modificationDate] as? Date,
               now.timeIntervalSince(modDate) > maxStateAge {
                // Clean up stale file
                try? fileManager.removeItem(atPath: filePath)
                continue
            }

            // Parse agent state
            guard let data = fileManager.contents(atPath: filePath),
                  let state = try? decoder.decode(AgentState.self, from: data) else {
                continue
            }

            // Skip stale states
            if state.isStale {
                try? fileManager.removeItem(atPath: filePath)
                continue
            }

            newAgents[state.agentId] = state
        }

        // Detect finished transitions and play sound
        for (agentId, agentState) in newAgents {
            let previousState = previousStates[agentId]
            if agentState.state == .finished && previousState != .finished {
                playCompletionSound()
            }
        }
        previousStates = newAgents.mapValues { $0.state }

        // Only update if changed
        if newAgents != agents {
            agents = newAgents
        }
    }

    /// Play a sound when an agent finishes a task
    private func playCompletionSound() {
        NSSound(named: "Glass")?.play()
    }

    /// Manually refresh state (useful for testing)
    func refresh() {
        pollStateFiles()
    }

    /// Remove state file for an agent (called when session ends)
    func removeAgent(_ agentId: String) {
        let filePath = (stateDir as NSString).appendingPathComponent("\(agentId).json")
        try? fileManager.removeItem(atPath: filePath)
        agents.removeValue(forKey: agentId)
    }

    /// Remove state file for a session (called when session ends)
    func removeAgentForSession(_ sessionId: Int) {
        removeAgent("agent-\(sessionId)")
    }
}
