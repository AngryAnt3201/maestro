//
//  WorktreeManager.swift
//  claude-maestro
//
//  Manages git worktrees for isolated terminal sessions
//

import Foundation
import Combine

// MARK: - Worktree Info

struct WorktreeInfo: Identifiable, Codable {
    var id: String { "\(sessionId)-\(branchName)" }
    let sessionId: Int
    let branchName: String
    let path: String
}

// MARK: - Worktree Manager

@MainActor
class WorktreeManager: ObservableObject {
    @Published var activeWorktrees: [Int: WorktreeInfo] = [:]  // sessionId -> info

    private let baseDirectory: URL

    init() {
        // ~/.claude-maestro/worktrees/
        baseDirectory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude-maestro/worktrees")
    }

    // MARK: - Public Methods

    /// Create a worktree for a session
    /// Returns the worktree path if created, nil if session should use main repo
    func createWorktree(
        for sessionId: Int,
        branch: String,
        repoPath: String,
        gitManager: GitManager
    ) async throws -> String {
        // Sanitize branch name for filesystem
        let sanitizedBranch = sanitizeBranchName(branch)

        // Generate unique path based on repo hash and branch
        let repoHash = stableHash(repoPath)
        let worktreePath = baseDirectory
            .appendingPathComponent(repoHash)
            .appendingPathComponent(sanitizedBranch)
            .path

        // Check if we already have a worktree for this session
        if let existing = activeWorktrees[sessionId] {
            if existing.branchName == branch && FileManager.default.fileExists(atPath: existing.path) {
                return existing.path  // Reuse existing
            }
            // Different branch - remove old worktree first
            try await removeWorktree(for: sessionId, repoPath: repoPath, gitManager: gitManager)
        }

        // Check if directory exists
        if FileManager.default.fileExists(atPath: worktreePath) {
            // Check if it's already a valid worktree
            let worktrees = try await listWorktrees(repoPath: repoPath, gitManager: gitManager)
            if worktrees.contains(where: { $0.path == worktreePath }) {
                // Already a valid worktree - just use it
                activeWorktrees[sessionId] = WorktreeInfo(
                    sessionId: sessionId,
                    branchName: branch,
                    path: worktreePath
                )
                return worktreePath
            }
            // Directory exists but not a worktree - remove it
            try FileManager.default.removeItem(atPath: worktreePath)
        }

        // Create parent directory
        let parentDir = URL(fileURLWithPath: worktreePath).deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: parentDir,
            withIntermediateDirectories: true
        )

        // Check if branch exists
        let branchExists = gitManager.localBranches.contains { $0.name == branch }

        // Before creating worktree, ensure main repo isn't on this branch
        // (git worktrees lock branches - can only be checked out in one place)
        if gitManager.currentBranch == branch {
            // Switch main repo to default branch to free up the target branch
            let safeBranch = gitManager.defaultBranch ?? "main"
            if safeBranch != branch {
                try await gitManager.checkoutBranch(safeBranch)
            } else {
                // Target branch IS the default - find any other branch
                if let otherBranch = gitManager.localBranches.first(where: { $0.name != branch }) {
                    try await gitManager.checkoutBranch(otherBranch.name)
                }
                // If no other branches exist, worktree creation will handle the error
            }
        }

        // Create the worktree
        try await gitManager.createWorktree(
            branch: branch,
            path: worktreePath,
            createBranch: !branchExists
        )

        // Track it
        activeWorktrees[sessionId] = WorktreeInfo(
            sessionId: sessionId,
            branchName: branch,
            path: worktreePath
        )

        return worktreePath
    }

    /// Remove worktree for a session
    func removeWorktree(
        for sessionId: Int,
        repoPath: String,
        gitManager: GitManager
    ) async throws {
        guard let info = activeWorktrees[sessionId] else { return }

        // Remove from git
        try await gitManager.removeWorktree(path: info.path)

        // Remove tracking
        activeWorktrees.removeValue(forKey: sessionId)

        // Clean up empty directories
        cleanupEmptyDirectories(for: repoPath)
    }

    /// Get worktree path for a session
    func worktreePath(for sessionId: Int) -> String? {
        activeWorktrees[sessionId]?.path
    }

    /// List all worktrees for a repository
    func listWorktrees(
        repoPath: String,
        gitManager: GitManager
    ) async throws -> [(path: String, branch: String)] {
        try await gitManager.listWorktrees()
    }

    /// Prune orphaned worktrees on startup
    func pruneOrphanedWorktrees(
        repoPath: String,
        gitManager: GitManager
    ) async throws {
        try await gitManager.pruneWorktrees()
    }

    /// Check if worktree has uncommitted changes
    func hasUncommittedChanges(at path: String) async -> Bool {
        let process = Process()
        let pipe = Pipe()

        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = ["status", "--porcelain"]
        process.currentDirectoryURL = URL(fileURLWithPath: path)
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            process.waitUntilExit()

            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let output = String(data: data, encoding: .utf8) ?? ""
            return !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        } catch {
            return false
        }
    }

    // MARK: - Private Methods

    private func sanitizeBranchName(_ name: String) -> String {
        // Replace characters invalid for filesystem
        name.replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: "\\", with: "-")
            .replacingOccurrences(of: ":", with: "-")
            .replacingOccurrences(of: "*", with: "-")
            .replacingOccurrences(of: "?", with: "-")
            .replacingOccurrences(of: "\"", with: "-")
            .replacingOccurrences(of: "<", with: "-")
            .replacingOccurrences(of: ">", with: "-")
            .replacingOccurrences(of: "|", with: "-")
    }

    private func stableHash(_ string: String) -> String {
        // Simple stable hash for directory naming
        var hasher = Hasher()
        hasher.combine(string)
        let hash = abs(hasher.finalize())
        return String(format: "%08x", hash)
    }

    private func cleanupEmptyDirectories(for repoPath: String) {
        let repoHash = stableHash(repoPath)
        let repoWorktreeDir = baseDirectory.appendingPathComponent(repoHash)

        // Remove repo directory if empty
        if let contents = try? FileManager.default.contentsOfDirectory(atPath: repoWorktreeDir.path),
           contents.isEmpty {
            try? FileManager.default.removeItem(at: repoWorktreeDir)
        }
    }
}
