//
//  GitManager.swift
//  claude-maestro
//
//  Git operations service using Process API
//

import Foundation
import Combine
import SwiftUI

// MARK: - Remote Connection Status

enum RemoteConnectionStatus: Equatable {
    case unknown
    case checking
    case connected
    case disconnected

    var color: Color {
        switch self {
        case .unknown: return .gray
        case .checking: return .orange
        case .connected: return .green
        case .disconnected: return .red
        }
    }

    var icon: String {
        switch self {
        case .unknown: return "questionmark.circle"
        case .checking: return "arrow.clockwise"
        case .connected: return "checkmark.circle.fill"
        case .disconnected: return "xmark.circle.fill"
        }
    }

    var label: String {
        switch self {
        case .unknown: return "Unknown"
        case .checking: return "Checking..."
        case .connected: return "Connected"
        case .disconnected: return "Offline"
        }
    }
}

@MainActor
class GitManager: ObservableObject {
    @Published var isGitRepo: Bool = false
    @Published var currentBranch: String?
    @Published var branches: [Branch] = []
    @Published var localBranches: [Branch] = []
    @Published var remoteBranches: [Branch] = []
    @Published var gitStatus: GitStatus = .notARepo
    @Published var isLoading: Bool = false
    @Published var lastError: GitError?
    @Published var remoteURLs: [String: String] = [:]  // remote name -> URL
    @Published var userName: String?
    @Published var userEmail: String?
    @Published var remoteStatuses: [String: RemoteConnectionStatus] = [:]
    @Published var defaultBranch: String?
    @Published var repoPath: String = ""

    // MARK: - Public Methods

    func setRepository(path: String) async {
        repoPath = path
        await refresh()
    }

    func refresh() async {
        isLoading = true
        defer { isLoading = false }

        // Check if git repo
        isGitRepo = await checkIsGitRepo()
        guard isGitRepo else {
            gitStatus = .notARepo
            branches = []
            localBranches = []
            remoteBranches = []
            currentBranch = nil
            remoteURLs = [:]
            userName = nil
            userEmail = nil
            return
        }

        // First, get remote URLs to know if we have remotes configured
        do {
            remoteURLs = try await fetchRemoteURLs()
        } catch {
            remoteURLs = [:]
        }

        // Fetch from remotes if configured (updates remote branch cache)
        await fetchFromRemotes()

        // Fetch remaining data in parallel
        do {
            async let branchesTask = fetchBranches()
            async let statusTask = fetchStatus()
            async let currentTask = fetchCurrentBranch()
            async let userConfigTask = fetchUserConfig()
            async let defaultBranchTask = fetchDefaultBranch()

            branches = try await branchesTask
            gitStatus = try await statusTask
            currentBranch = try await currentTask
            let userConfig = try await userConfigTask
            userName = userConfig.name
            userEmail = userConfig.email
            defaultBranch = try await defaultBranchTask

            // Separate local and remote branches
            localBranches = branches.filter { !$0.isRemote }
            remoteBranches = branches.filter { $0.isRemote }

            // Check remote connectivity in background
            Task {
                await checkAllRemotesConnectivity()
            }
        } catch {
            lastError = error as? GitError ?? .commandFailed(error.localizedDescription)
        }
    }

    func initRepository() async throws {
        _ = try await runGitCommand(["init"])
        await refresh()
    }

    func createBranch(name: String, from source: String? = nil) async throws {
        let sanitizedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sanitizedName.isEmpty else {
            throw GitError.commandFailed("Branch name cannot be empty")
        }

        if branches.contains(where: { $0.name == sanitizedName }) {
            throw GitError.branchAlreadyExists(sanitizedName)
        }

        var args = ["branch", sanitizedName]
        if let source = source {
            args.append(source)
        }

        _ = try await runGitCommand(args)
        await refresh()
    }

    // MARK: - Commit History Methods

    func fetchCommitHistory(limit: Int = 50, skip: Int = 0) async throws -> [Commit] {
        // Format: fullHash|shortHash|subject|authorName|authorEmail|isoDate|parentHashes|refs
        let format = "%H|%h|%s|%an|%ae|%aI|%P|%D"
        var args = ["log", "--all", "--topo-order", "--format=\(format)", "-n", "\(limit)"]
        if skip > 0 {
            args.append("--skip=\(skip)")
        }
        let output = try await runGitCommand(args)

        // Get current HEAD hash
        let headHash = try? await runGitCommand(["rev-parse", "HEAD"])
        let currentHead = headHash?.trimmingCharacters(in: .whitespacesAndNewlines)

        let dateFormatter = ISO8601DateFormatter()
        dateFormatter.formatOptions = [.withInternetDateTime]

        return output.split(separator: "\n").compactMap { line -> Commit? in
            // Split by | but preserve empty fields
            let parts = String(line).components(separatedBy: "|")
            guard parts.count >= 6 else { return nil }

            let hash = parts[0]
            let shortHash = parts[1]
            let message = parts[2]
            let author = parts[3]
            let email = parts[4]
            let dateStr = parts[5]
            let parentStr = parts.count > 6 ? parts[6] : ""
            let refStr = parts.count > 7 ? parts[7] : ""

            let parents = parentStr.isEmpty ? [] : parentStr.split(separator: " ").map(String.init)
            let refs = parseRefs(refStr, currentHead: currentHead)
            let date = dateFormatter.date(from: dateStr) ?? Date()

            return Commit(
                id: hash,
                shortHash: shortHash,
                message: message,
                author: author,
                authorEmail: email,
                date: date,
                parentHashes: parents,
                isHead: hash == currentHead,
                refs: refs
            )
        }
    }

    private func parseRefs(_ refString: String, currentHead: String?) -> [GitRef] {
        guard !refString.isEmpty else { return [] }

        return refString.split(separator: ",").compactMap { refPart -> GitRef? in
            let trimmed = refPart.trimmingCharacters(in: .whitespaces)

            if trimmed.hasPrefix("HEAD -> ") {
                let name = String(trimmed.dropFirst(8))
                return GitRef(id: "head-\(name)", name: name, type: .localBranch, isHead: true)
            } else if trimmed.hasPrefix("tag: ") {
                let name = String(trimmed.dropFirst(5))
                return GitRef(id: "tag-\(name)", name: name, type: .tag, isHead: false)
            } else if trimmed.hasPrefix("origin/") {
                return GitRef(id: trimmed, name: trimmed, type: .remoteBranch, isHead: false)
            } else if trimmed != "HEAD" && !trimmed.isEmpty {
                return GitRef(id: trimmed, name: trimmed, type: .localBranch, isHead: false)
            }
            return nil
        }
    }

    func checkoutCommit(_ hash: String) async throws {
        _ = try await runGitCommand(["checkout", hash])
        await refresh()
    }

    func checkoutBranch(_ name: String) async throws {
        _ = try await runGitCommand(["checkout", name])
        await refresh()
    }

    func createBranchAtCommit(name: String, commitHash: String) async throws {
        let sanitizedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sanitizedName.isEmpty else {
            throw GitError.commandFailed("Branch name cannot be empty")
        }

        if branches.contains(where: { $0.name == sanitizedName }) {
            throw GitError.branchAlreadyExists(sanitizedName)
        }

        _ = try await runGitCommand(["branch", sanitizedName, commitHash])
        await refresh()
    }

    // MARK: - Remote Connectivity

    func checkRemoteConnectivity(remoteName: String) async -> RemoteConnectionStatus {
        do {
            // Use ls-remote --heads to test connectivity (no --exit-code which can fail even on valid remotes)
            _ = try await runGitCommand(["ls-remote", "--heads", remoteName])
            return .connected
        } catch {
            return .disconnected
        }
    }

    func checkAllRemotesConnectivity() async {
        for remoteName in remoteURLs.keys {
            remoteStatuses[remoteName] = .checking
        }

        for remoteName in remoteURLs.keys {
            let status = await checkRemoteConnectivity(remoteName: remoteName)
            remoteStatuses[remoteName] = status
        }
    }

    // MARK: - Git Config SET Methods

    func setUserName(_ name: String, global: Bool = false) async throws {
        var args = ["config"]
        if global { args.append("--global") }
        args += ["user.name", name]
        _ = try await runGitCommand(args)
        userName = name
    }

    func setUserEmail(_ email: String, global: Bool = false) async throws {
        var args = ["config"]
        if global { args.append("--global") }
        args += ["user.email", email]
        _ = try await runGitCommand(args)
        userEmail = email
    }

    func setDefaultBranch(_ branch: String, global: Bool = false) async throws {
        var args = ["config"]
        if global { args.append("--global") }
        args += ["init.defaultBranch", branch]
        _ = try await runGitCommand(args)
        defaultBranch = branch
    }

    // MARK: - Remote Management

    func addRemote(name: String, url: String) async throws {
        _ = try await runGitCommand(["remote", "add", name, url])
        await refresh()
    }

    func setRemoteURL(name: String, url: String) async throws {
        _ = try await runGitCommand(["remote", "set-url", name, url])
        await refresh()
    }

    func removeRemote(name: String) async throws {
        _ = try await runGitCommand(["remote", "remove", name])
        remoteURLs.removeValue(forKey: name)
        remoteStatuses.removeValue(forKey: name)
    }

    // MARK: - Worktree Operations

    /// Create a worktree for the given branch at the specified path
    func createWorktree(branch: String, path: String, createBranch: Bool = false) async throws {
        var args = ["worktree", "add"]
        if createBranch {
            args.append(contentsOf: ["-b", branch, path])
        } else {
            args.append(contentsOf: [path, branch])
        }
        _ = try await runGitCommand(args)
    }

    /// Remove a worktree at the specified path
    func removeWorktree(path: String, force: Bool = true) async throws {
        var args = ["worktree", "remove", path]
        if force {
            args.append("--force")
        }
        do {
            _ = try await runGitCommand(args)
        } catch {
            // If removal fails, try pruning
            try await pruneWorktrees()
        }
    }

    /// List all worktrees for this repository
    func listWorktrees() async throws -> [(path: String, branch: String)] {
        let output = try await runGitCommand(["worktree", "list", "--porcelain"])

        var worktrees: [(path: String, branch: String)] = []
        var currentPath: String?
        var currentBranch: String?

        for line in output.split(separator: "\n", omittingEmptySubsequences: false) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.hasPrefix("worktree ") {
                // Save previous worktree if complete
                if let path = currentPath, let branch = currentBranch {
                    worktrees.append((path: path, branch: branch))
                }
                currentPath = String(trimmed.dropFirst(9))  // Remove "worktree "
                currentBranch = nil
            } else if trimmed.hasPrefix("branch refs/heads/") {
                currentBranch = String(trimmed.dropFirst(18))  // Remove "branch refs/heads/"
            } else if trimmed.isEmpty {
                // End of current worktree entry
                if let path = currentPath, let branch = currentBranch {
                    worktrees.append((path: path, branch: branch))
                }
                currentPath = nil
                currentBranch = nil
            }
        }

        // Handle last entry if not followed by empty line
        if let path = currentPath, let branch = currentBranch {
            worktrees.append((path: path, branch: branch))
        }

        return worktrees
    }

    /// Prune stale worktree references
    func pruneWorktrees() async throws {
        _ = try await runGitCommand(["worktree", "prune"])
    }

    // MARK: - Private Methods

    private func checkIsGitRepo() async -> Bool {
        do {
            _ = try await runGitCommand(["rev-parse", "--git-dir"])
            return true
        } catch {
            return false
        }
    }

    private func fetchCurrentBranch() async throws -> String {
        try await runGitCommand(["branch", "--show-current"])
    }

    private func fetchRemoteURLs() async throws -> [String: String] {
        let output = try await runGitCommand(["remote", "-v"])
        var remotes: [String: String] = [:]

        for line in output.split(separator: "\n") {
            let parts = line.split(separator: "\t")
            guard parts.count >= 2 else { continue }
            let remoteName = String(parts[0])
            // Extract URL (remove " (fetch)" or " (push)" suffix)
            let urlPart = String(parts[1]).split(separator: " ").first ?? Substring("")
            remotes[remoteName] = String(urlPart)
        }
        return remotes
    }

    private func fetchUserConfig() async throws -> (name: String?, email: String?) {
        let name = try? await runGitCommand(["config", "user.name"])
        let email = try? await runGitCommand(["config", "user.email"])
        return (name, email)
    }

    private func fetchDefaultBranch() async throws -> String? {
        let output = try? await runGitCommand(["config", "--get", "init.defaultBranch"])
        return output?.isEmpty == false ? output : nil
    }

    private func fetchFromRemotes() async {
        // Only fetch if we have remotes configured
        guard !remoteURLs.isEmpty else { return }

        do {
            // Fetch from all remotes, pruning deleted remote branches
            _ = try await runGitCommand(["fetch", "--all", "--prune"])
        } catch {
            // Silently fail - network issues shouldn't block local refresh
        }
    }

    private func fetchBranches() async throws -> [Branch] {
        let output = try await runGitCommand([
            "for-each-ref",
            "--format=%(refname:short)|%(objectname:short)|%(subject)|%(upstream:track)",
            "refs/heads/",
            "refs/remotes/"
        ])

        let current = try? await fetchCurrentBranch()

        return output.split(separator: "\n").compactMap { line -> Branch? in
            let parts = line.split(separator: "|", omittingEmptySubsequences: false)
            guard parts.count >= 3 else { return nil }

            let name = String(parts[0])
            let hash = String(parts[1])
            let message = String(parts[2])
            let trackInfo = parts.count > 3 ? String(parts[3]) : ""

            let (ahead, behind) = parseTrackInfo(trackInfo)

            return Branch(
                name: name,
                isRemote: name.hasPrefix("origin/"),
                isHead: name == current,
                commitHash: hash,
                commitMessage: message,
                aheadCount: ahead,
                behindCount: behind
            )
        }
    }

    private func parseTrackInfo(_ info: String) -> (ahead: Int, behind: Int) {
        var ahead = 0
        var behind = 0

        if let range = info.range(of: #"ahead (\d+)"#, options: .regularExpression) {
            let match = info[range]
            if let number = Int(match.replacingOccurrences(of: "ahead ", with: "")) {
                ahead = number
            }
        }
        if let range = info.range(of: #"behind (\d+)"#, options: .regularExpression) {
            let match = info[range]
            if let number = Int(match.replacingOccurrences(of: "behind ", with: "")) {
                behind = number
            }
        }

        return (ahead, behind)
    }

    private func fetchStatus() async throws -> GitStatus {
        let statusOutput = try await runGitCommand(["status", "--porcelain"])
        let currentBranch = try? await fetchCurrentBranch()

        var untracked = 0
        var staged = 0
        var unstaged = 0

        for line in statusOutput.split(separator: "\n") {
            guard line.count >= 2 else { continue }
            let chars = Array(line)

            if chars[0] == "?" { untracked += 1 }
            if chars[0] != " " && chars[0] != "?" { staged += 1 }
            if chars[1] != " " && chars[1] != "?" { unstaged += 1 }
        }

        return GitStatus(
            isGitRepo: true,
            currentBranch: currentBranch,
            hasUncommittedChanges: staged > 0 || unstaged > 0,
            untrackedFiles: untracked,
            stagedChanges: staged,
            unstagedChanges: unstaged
        )
    }

    private func runGitCommand(_ args: [String]) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            let pipe = Pipe()
            let errorPipe = Pipe()

            process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
            process.arguments = args
            process.currentDirectoryURL = URL(fileURLWithPath: repoPath)
            process.standardOutput = pipe
            process.standardError = errorPipe

            do {
                try process.run()
                process.waitUntilExit()

                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                let output = String(data: data, encoding: .utf8) ?? ""

                if process.terminationStatus != 0 {
                    let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
                    let errorOutput = String(data: errorData, encoding: .utf8) ?? ""
                    continuation.resume(throwing: GitError.commandFailed(errorOutput))
                } else {
                    continuation.resume(returning: output.trimmingCharacters(in: .whitespacesAndNewlines))
                }
            } catch {
                continuation.resume(throwing: GitError.commandFailed(error.localizedDescription))
            }
        }
    }
}
