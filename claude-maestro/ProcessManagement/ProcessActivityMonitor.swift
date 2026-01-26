//
//  ProcessActivityMonitor.swift
//  claude-maestro
//
//  Uses Darwin's proc_pid_rusage API to detect real process activity
//  for accurate agent state detection (working vs idle)
//

import Foundation
import Darwin
import Combine

/// Activity level for a process
public enum ActivityLevel: String, Sendable {
    case active     // CPU or IO activity detected
    case inactive   // No significant activity
    case unknown    // Cannot determine (process not found or error)
}

/// Snapshot of process resource usage at a point in time
public struct ActivitySnapshot: Sendable {
    public let cpuTimeUser: UInt64      // User CPU time in nanoseconds
    public let cpuTimeSystem: UInt64    // System CPU time in nanoseconds
    public let diskIORead: UInt64       // Bytes read from disk
    public let diskIOWrite: UInt64      // Bytes written to disk
    public let timestamp: Date

    public init(
        cpuTimeUser: UInt64,
        cpuTimeSystem: UInt64,
        diskIORead: UInt64,
        diskIOWrite: UInt64,
        timestamp: Date = Date()
    ) {
        self.cpuTimeUser = cpuTimeUser
        self.cpuTimeSystem = cpuTimeSystem
        self.diskIORead = diskIORead
        self.diskIOWrite = diskIOWrite
        self.timestamp = timestamp
    }

    /// Total CPU time
    public var totalCPUTime: UInt64 {
        cpuTimeUser + cpuTimeSystem
    }

    /// Total disk IO
    public var totalDiskIO: UInt64 {
        diskIORead + diskIOWrite
    }
}

/// Monitors process activity using Darwin's resource usage APIs
/// Uses ObservableObject for SwiftUI integration
@MainActor
public class ProcessActivityMonitor: ObservableObject {

    // MARK: - Published State

    /// Current activity levels by PID
    @Published public private(set) var activityLevels: [pid_t: ActivityLevel] = [:]

    /// Last snapshots by PID (for delta calculation)
    @Published public private(set) var lastSnapshots: [pid_t: ActivitySnapshot] = [:]

    // MARK: - Configuration

    /// Minimum CPU time delta (nanoseconds) to consider as "active"
    /// 10ms of CPU time in the polling interval indicates activity
    public var cpuThresholdNanos: UInt64 = 10_000_000

    /// Minimum IO delta (bytes) to consider as "active"
    /// 1KB of IO in the polling interval indicates activity
    public var ioThresholdBytes: UInt64 = 1024

    /// Polling interval for activity checks
    public var pollingInterval: TimeInterval = 0.5

    // MARK: - Internal State

    private var monitoredPids: Set<pid_t> = []
    private var pollingTimer: Timer?
    private var processTree = ProcessTree()

    // MARK: - Initialization

    public init() {}

    deinit {
        // Timer must be invalidated on the main thread where it was scheduled.
        // Since deinit can be called from any thread, we capture the timer
        // and dispatch to main. The timer is a class, so this is safe.
        let timer = pollingTimer
        if Thread.isMainThread {
            timer?.invalidate()
        } else {
            DispatchQueue.main.async {
                timer?.invalidate()
            }
        }
    }

    // MARK: - Public API

    /// Start monitoring a process and its descendants
    /// - Parameter pid: Shell/terminal PID to monitor
    public func startMonitoring(pid: pid_t) {
        monitoredPids.insert(pid)

        // Take initial snapshot
        Task {
            await takeSnapshot(for: pid)
        }

        // Start polling if not already running
        startPollingIfNeeded()
    }

    /// Stop monitoring a process
    /// - Parameter pid: Process ID to stop monitoring
    public func stopMonitoring(pid: pid_t) {
        monitoredPids.remove(pid)
        activityLevels.removeValue(forKey: pid)
        lastSnapshots.removeValue(forKey: pid)

        // Stop polling if no more monitored PIDs
        if monitoredPids.isEmpty {
            stopPolling()
        }
    }

    /// Get the current activity level for a PID
    /// - Parameter pid: Process ID
    /// - Returns: Activity level or .unknown if not monitored
    public func getActivityLevel(for pid: pid_t) -> ActivityLevel {
        activityLevels[pid] ?? .unknown
    }

    /// Check if a process (or any of its descendants) is active
    /// - Parameter shellPid: Root shell PID
    /// - Returns: True if any descendant shows activity
    public func isProcessTreeActive(shellPid: pid_t) async -> Bool {
        // Get all descendants
        let descendants = await processTree.getDescendants(of: shellPid)

        // Check if shell itself or any descendant is active
        if activityLevels[shellPid] == .active {
            return true
        }

        for process in descendants {
            // Look for AI CLI processes specifically
            let name = process.name.lowercased()
            if name.contains("claude") || name.contains("gemini") || name.contains("codex") {
                // Check activity for this specific process
                if let snapshot = await getActivitySnapshot(for: process.pid),
                   let lastSnapshot = lastSnapshots[process.pid] {
                    if isActive(current: snapshot, previous: lastSnapshot) {
                        return true
                    }
                }
            }
        }

        return false
    }

    /// Take a resource usage snapshot for a process
    /// - Parameter pid: Process ID
    /// - Returns: ActivitySnapshot or nil if process not found
    public func getActivitySnapshot(for pid: pid_t) async -> ActivitySnapshot? {
        var rusage = rusage_info_v4()
        let result = withUnsafeMutablePointer(to: &rusage) { ptr in
            ptr.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { rusagePtr in
                proc_pid_rusage(pid, RUSAGE_INFO_V4, rusagePtr)
            }
        }

        guard result == 0 else { return nil }

        return ActivitySnapshot(
            cpuTimeUser: rusage.ri_user_time,
            cpuTimeSystem: rusage.ri_system_time,
            diskIORead: rusage.ri_diskio_bytesread,
            diskIOWrite: rusage.ri_diskio_byteswritten
        )
    }

    // MARK: - Private Methods

    private func startPollingIfNeeded() {
        guard pollingTimer == nil else { return }

        pollingTimer = Timer.scheduledTimer(withTimeInterval: pollingInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.pollActivity()
            }
        }
    }

    private func stopPolling() {
        pollingTimer?.invalidate()
        pollingTimer = nil
    }

    private func pollActivity() async {
        for pid in monitoredPids {
            await updateActivity(for: pid)
        }
    }

    private func takeSnapshot(for pid: pid_t) async {
        if let snapshot = await getActivitySnapshot(for: pid) {
            lastSnapshots[pid] = snapshot
        }
    }

    private func updateActivity(for pid: pid_t) async {
        guard let currentSnapshot = await getActivitySnapshot(for: pid) else {
            activityLevels[pid] = .unknown
            return
        }

        // Compare with last snapshot
        if let lastSnapshot = lastSnapshots[pid] {
            let isActive = isActive(current: currentSnapshot, previous: lastSnapshot)
            activityLevels[pid] = isActive ? .active : .inactive
        } else {
            activityLevels[pid] = .unknown
        }

        // Update snapshot for next comparison
        lastSnapshots[pid] = currentSnapshot

        // Also check descendants for AI CLI processes
        await checkDescendantsForActivity(shellPid: pid)
    }

    private func checkDescendantsForActivity(shellPid: pid_t) async {
        let descendants = await processTree.getDescendants(of: shellPid)

        for process in descendants {
            let name = process.name.lowercased()
            // Focus on AI CLI processes
            if name.contains("claude") || name.contains("gemini") || name.contains("codex") || name.contains("node") {
                if let currentSnapshot = await getActivitySnapshot(for: process.pid) {
                    if let lastSnapshot = lastSnapshots[process.pid] {
                        if isActive(current: currentSnapshot, previous: lastSnapshot) {
                            // If any child is active, mark the shell as active
                            activityLevels[shellPid] = .active
                        }
                    }
                    // Store snapshot for this child process
                    lastSnapshots[process.pid] = currentSnapshot
                }
            }
        }
    }

    private func isActive(current: ActivitySnapshot, previous: ActivitySnapshot) -> Bool {
        // Calculate deltas
        let cpuDelta = current.totalCPUTime - previous.totalCPUTime
        let ioDelta = current.totalDiskIO - previous.totalDiskIO

        // Check thresholds
        return cpuDelta >= cpuThresholdNanos || ioDelta >= ioThresholdBytes
    }
}

// MARK: - Activity Detection Helpers

extension ProcessActivityMonitor {

    /// Determine session state based on activity and terminal output patterns
    /// - Parameters:
    ///   - activity: Detected activity level
    ///   - outputPattern: Optional pattern detected in terminal output
    /// - Returns: Recommended SessionStatus
    internal func determineState(
        activity: ActivityLevel,
        outputPattern: OutputPattern?
    ) -> SessionStatus {
        // Pattern overrides (waiting prompts, errors)
        if let pattern = outputPattern {
            switch pattern {
            case .waiting:
                return .waiting  // (y/n) prompts
            case .error:
                return .error    // error:, failed:
            case .working:
                return .working  // explicit working indicator
            case .idle:
                break  // fall through to activity check
            }
        }

        // Activity-based
        switch activity {
        case .active:
            return .working
        case .inactive:
            return .idle
        case .unknown:
            return .idle  // Default to idle when unknown
        }
    }
}

/// Detected output patterns from terminal
public enum OutputPattern: Sendable {
    case waiting   // Confirmation prompts (y/n, yes/no)
    case error     // Error indicators (error:, failed:)
    case working   // Explicit working indicator
    case idle      // No special pattern
}
