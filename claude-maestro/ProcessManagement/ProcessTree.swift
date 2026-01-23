import Foundation
import Darwin

// libproc constants not exposed to Swift
private let PROC_PIDPATHINFO_MAXSIZE: Int = 4096

/// Information about a running process
public struct ProcessInfo: Identifiable, Sendable, Hashable {
    public let id: pid_t
    public let pid: pid_t
    public let ppid: pid_t
    public let pgid: pid_t
    public let uid: uid_t
    public let name: String
    public let path: String?
    public let startTime: Date?

    public init(pid: pid_t, ppid: pid_t, pgid: pid_t, uid: uid_t, name: String, path: String? = nil, startTime: Date? = nil) {
        self.id = pid
        self.pid = pid
        self.ppid = ppid
        self.pgid = pgid
        self.uid = uid
        self.name = name
        self.path = path
        self.startTime = startTime
    }

    /// Human-friendly display name, extracted from path for versioned binaries
    public var displayName: String {
        guard let path = path else { return name }

        let url = URL(fileURLWithPath: path)

        // Check if filename looks like a version number (e.g., "2.1.17")
        // If parent is "versions", use grandparent directory name
        if url.pathComponents.count >= 3 {
            let parentName = url.deletingLastPathComponent().lastPathComponent
            if parentName == "versions" {
                // Return the app name (e.g., "claude" from ".../claude/versions/2.1.17")
                return url.deletingLastPathComponent()
                    .deletingLastPathComponent()
                    .lastPathComponent
            }
        }

        return name
    }
}

/// Complete process tree visibility using libproc
public actor ProcessTree {

    /// Errors that can occur during process tree operations
    public enum TreeError: Error, LocalizedError {
        case listProcessesFailed
        case processNotFound(pid: pid_t)
        case infoRetrievalFailed(pid: pid_t)

        public var errorDescription: String? {
            switch self {
            case .listProcessesFailed:
                return "Failed to list processes"
            case .processNotFound(let pid):
                return "Process \(pid) not found"
            case .infoRetrievalFailed(let pid):
                return "Failed to retrieve info for process \(pid)"
            }
        }
    }

    public init() {}

    /// Get all processes for the current user
    /// - Parameter includeSystem: If true, includes system processes (uid != current user)
    /// - Returns: Array of ProcessInfo for all matching processes
    public func getAllProcesses(includeSystem: Bool = false) -> [ProcessInfo] {
        let currentUid = getuid()

        // Get number of processes
        var numPids = proc_listpids(UInt32(PROC_ALL_PIDS), 0, nil, 0)
        guard numPids > 0 else { return [] }

        // Allocate buffer for PIDs
        let pidCount = Int(numPids) / MemoryLayout<pid_t>.size + 16
        var pids = [pid_t](repeating: 0, count: pidCount)

        // Get all PIDs
        numPids = proc_listpids(UInt32(PROC_ALL_PIDS), 0, &pids, Int32(pidCount * MemoryLayout<pid_t>.size))
        guard numPids > 0 else { return [] }

        let actualCount = Int(numPids) / MemoryLayout<pid_t>.size

        // Get info for each PID
        var processes: [ProcessInfo] = []
        for i in 0..<actualCount {
            let pid = pids[i]
            guard pid > 0 else { continue }

            if let info = getProcessInfo(pid: pid) {
                if includeSystem || info.uid == currentUid {
                    processes.append(info)
                }
            }
        }

        return processes
    }

    /// Get information about a specific process
    /// - Parameter pid: Process ID
    /// - Returns: ProcessInfo or nil if process doesn't exist
    public func getProcessInfo(pid: pid_t) -> ProcessInfo? {
        var info = proc_bsdinfo()
        let size = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout<proc_bsdinfo>.size))

        guard size > 0 else { return nil }

        // Get process name
        let name = withUnsafePointer(to: info.pbi_name) { ptr in
            ptr.withMemoryRebound(to: CChar.self, capacity: Int(MAXCOMLEN)) { charPtr in
                String(cString: charPtr)
            }
        }

        // Get process path
        var pathBuffer = [CChar](repeating: 0, count: Int(PROC_PIDPATHINFO_MAXSIZE))
        let pathLength = proc_pidpath(pid, &pathBuffer, UInt32(pathBuffer.count))
        let path = pathLength > 0 ? String(cString: pathBuffer) : nil

        // Calculate start time
        let startTime: Date?
        if info.pbi_start_tvsec > 0 {
            startTime = Date(timeIntervalSince1970: TimeInterval(info.pbi_start_tvsec))
        } else {
            startTime = nil
        }

        return ProcessInfo(
            pid: pid,
            ppid: pid_t(info.pbi_ppid),
            pgid: pid_t(info.pbi_pgid),
            uid: uid_t(info.pbi_uid),
            name: name.isEmpty ? "unknown" : name,
            path: path,
            startTime: startTime
        )
    }

    /// Get all child processes of a given parent
    /// - Parameter pid: Parent process ID
    /// - Returns: Array of child ProcessInfo
    public func getChildren(of pid: pid_t) -> [ProcessInfo] {
        getAllProcesses(includeSystem: true).filter { $0.ppid == pid }
    }

    /// Get all descendants of a process (children, grandchildren, etc.)
    /// - Parameter pid: Root process ID
    /// - Returns: Array of all descendant ProcessInfo
    public func getDescendants(of pid: pid_t) -> [ProcessInfo] {
        var descendants: [ProcessInfo] = []
        var toVisit = [pid]

        let allProcesses = getAllProcesses(includeSystem: true)
        let byPpid = Dictionary(grouping: allProcesses) { $0.ppid }

        while !toVisit.isEmpty {
            let current = toVisit.removeFirst()
            if let children = byPpid[current] {
                descendants.append(contentsOf: children)
                toVisit.append(contentsOf: children.map { $0.pid })
            }
        }

        return descendants
    }

    /// Get all processes in a process group
    /// - Parameter pgid: Process group ID
    /// - Returns: Array of ProcessInfo in the group
    public func getProcessGroup(pgid: pid_t) -> [ProcessInfo] {
        getAllProcesses(includeSystem: true).filter { $0.pgid == pgid }
    }

    /// Build a hierarchical tree structure from flat process list
    /// - Parameter rootPid: PID of the root process (or nil for all roots)
    /// - Returns: Array of ProcessNode trees
    public func buildTree(rootPid: pid_t? = nil) -> [ProcessNode] {
        let allProcesses = getAllProcesses(includeSystem: true)

        // Build lookup dictionaries
        let byPid = Dictionary(uniqueKeysWithValues: allProcesses.map { ($0.pid, $0) })
        let byPpid = Dictionary(grouping: allProcesses) { $0.ppid }

        // Find root processes
        let rootPids: [pid_t]
        if let root = rootPid {
            rootPids = [root]
        } else {
            // Roots are processes whose parent doesn't exist in our list
            rootPids = allProcesses
                .filter { byPid[$0.ppid] == nil }
                .map { $0.pid }
        }

        // Build tree recursively
        func buildNode(pid: pid_t) -> ProcessNode? {
            guard let info = byPid[pid] else { return nil }
            let children = (byPpid[pid] ?? []).compactMap { buildNode(pid: $0.pid) }
            return ProcessNode(info: info, children: children)
        }

        return rootPids.compactMap { buildNode(pid: $0) }
    }

    /// Check if a process is still running
    /// - Parameter pid: Process ID
    /// - Returns: True if process exists
    public func isRunning(pid: pid_t) -> Bool {
        getProcessInfo(pid: pid) != nil
    }

    /// Get the process group leader for a given process
    /// - Parameter pid: Process ID
    /// - Returns: ProcessInfo of the group leader, or nil
    public func getGroupLeader(for pid: pid_t) -> ProcessInfo? {
        guard let info = getProcessInfo(pid: pid) else { return nil }
        return getProcessInfo(pid: info.pgid)
    }
}

/// Node in a process tree hierarchy
public struct ProcessNode: Identifiable {
    public let id: pid_t
    public let info: ProcessInfo
    public var children: [ProcessNode]

    public init(info: ProcessInfo, children: [ProcessNode] = []) {
        self.id = info.pid
        self.info = info
        self.children = children
    }

    /// Total count of this node plus all descendants
    public var totalCount: Int {
        1 + children.reduce(0) { $0 + $1.totalCount }
    }

    /// Flat list of this node and all descendants
    public var flattened: [ProcessInfo] {
        [info] + children.flatMap { $0.flattened }
    }
}

// MARK: - Process Tree Utilities

public extension ProcessTree {
    /// Find processes by name (case-insensitive substring match)
    func findProcesses(named name: String) -> [ProcessInfo] {
        let lowercased = name.lowercased()
        return getAllProcesses(includeSystem: true).filter {
            $0.name.lowercased().contains(lowercased) ||
            ($0.path?.lowercased().contains(lowercased) ?? false)
        }
    }

    /// Find processes matching a path pattern
    func findProcesses(pathContaining pattern: String) -> [ProcessInfo] {
        getAllProcesses(includeSystem: true).filter {
            $0.path?.contains(pattern) ?? false
        }
    }

    /// Get session leader processes (processes that are their own session leader)
    func getSessionLeaders() -> [ProcessInfo] {
        getAllProcesses(includeSystem: true).filter { $0.pid == $0.pgid }
    }
}
