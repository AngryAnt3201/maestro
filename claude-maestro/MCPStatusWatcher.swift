import Foundation
import Combine

/// Watches the MCP server status file for changes and publishes server statuses.
/// This enables the Swift app to react to servers started via MCP tools.
class MCPStatusWatcher: ObservableObject {
    @Published var serverStatuses: [ServerStatus] = []

    private var fileDescriptor: Int32 = -1
    private var dispatchSource: DispatchSourceFileSystemObject?
    private var retryTimer: Timer?

    // Debouncing to prevent missed updates from rapid file changes
    private var lastReadTime: Date = .distantPast
    private let debounceInterval: TimeInterval = 0.1
    private var pendingReadWorkItem: DispatchWorkItem?

    struct ServerStatus: Codable {
        let sessionId: Int
        let status: String
        let port: Int?
        let url: String?
    }

    private struct StatusFile: Codable {
        let servers: [ServerStatus]
        let updatedAt: String
    }

    private var statusFilePath: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("Claude Maestro/server-status.json")
    }

    init() {
        readStatusFile()
        startWatching()
    }

    deinit {
        stopWatching()
        retryTimer?.invalidate()
        pendingReadWorkItem?.cancel()
    }

    func startWatching() {
        let path = statusFilePath.path

        // If file doesn't exist yet, retry periodically
        guard FileManager.default.fileExists(atPath: path) else {
            scheduleRetry()
            return
        }

        fileDescriptor = open(path, O_EVTONLY)
        guard fileDescriptor >= 0 else {
            scheduleRetry()
            return
        }

        dispatchSource = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fileDescriptor,
            eventMask: [.write, .extend, .rename, .delete, .attrib],
            queue: .main
        )

        dispatchSource?.setEventHandler { [weak self] in
            self?.debouncedReadStatusFile()
        }

        dispatchSource?.setCancelHandler { [weak self] in
            if let fd = self?.fileDescriptor, fd >= 0 {
                close(fd)
                self?.fileDescriptor = -1
            }
        }

        dispatchSource?.resume()

        // Cancel retry timer since we're now watching
        retryTimer?.invalidate()
        retryTimer = nil
    }

    func stopWatching() {
        dispatchSource?.cancel()
        dispatchSource = nil
    }

    /// Debounced read to handle rapid file updates without missing changes
    private func debouncedReadStatusFile() {
        // Cancel any pending read
        pendingReadWorkItem?.cancel()

        // Schedule a new read after debounce interval
        let workItem = DispatchWorkItem { [weak self] in
            self?.readStatusFile()
        }
        pendingReadWorkItem = workItem

        DispatchQueue.main.asyncAfter(deadline: .now() + debounceInterval, execute: workItem)
    }

    func readStatusFile() {
        // Debounce rapid reads
        let now = Date()
        guard now.timeIntervalSince(lastReadTime) >= debounceInterval else { return }
        lastReadTime = now

        guard FileManager.default.fileExists(atPath: statusFilePath.path) else {
            return
        }

        // Read file with retry for atomic file operations
        var attempts = 0
        let maxAttempts = 3

        while attempts < maxAttempts {
            do {
                let data = try Data(contentsOf: statusFilePath)
                let statusFile = try JSONDecoder().decode(StatusFile.self, from: data)
                serverStatuses = statusFile.servers
                return
            } catch {
                // File might be in the middle of being written (atomic rename)
                attempts += 1
                if attempts < maxAttempts {
                    Thread.sleep(forTimeInterval: 0.05) // 50ms retry delay
                }
            }
        }
    }

    private func scheduleRetry() {
        retryTimer?.invalidate()
        retryTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            self?.startWatching()
        }
    }
}
