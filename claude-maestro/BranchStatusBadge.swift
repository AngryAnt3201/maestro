//
//  BranchStatusBadge.swift
//  claude-maestro
//
//  Compact branch status indicator component
//

import SwiftUI

struct BranchStatusBadge: View {
    let branch: String?
    let gitStatus: GitStatus?
    let isCompact: Bool

    init(branch: String?, gitStatus: GitStatus?, isCompact: Bool = false) {
        self.branch = branch
        self.gitStatus = gitStatus
        self.isCompact = isCompact
    }

    var body: some View {
        HStack(spacing: 4) {
            // Branch name
            HStack(spacing: 2) {
                Image(systemName: "arrow.triangle.branch")
                    .font(.caption2)
                Text(branch ?? "detached")
                    .font(.caption)
                    .lineLimit(1)
            }
            .foregroundColor(.primary)

            // Status indicators
            if let status = gitStatus, !isCompact {
                if status.hasUncommittedChanges {
                    Circle()
                        .fill(Color.orange)
                        .frame(width: 6, height: 6)
                        .help("Uncommitted changes")
                }

                if status.stagedChanges > 0 {
                    Text("+\(status.stagedChanges)")
                        .font(.caption2)
                        .foregroundColor(.green)
                }

                if status.unstagedChanges > 0 {
                    Text("~\(status.unstagedChanges)")
                        .font(.caption2)
                        .foregroundColor(.orange)
                }
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(Color.secondary.opacity(0.1))
        .cornerRadius(4)
    }
}

// MARK: - Detailed Branch Status

struct DetailedBranchStatus: View {
    let branch: Branch?
    let gitStatus: GitStatus

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // Branch name with icon
            HStack {
                Image(systemName: "arrow.triangle.branch")
                Text(branch?.name ?? gitStatus.currentBranch ?? "Unknown")
                    .fontWeight(.medium)
            }

            // Change indicators
            HStack(spacing: 12) {
                if gitStatus.stagedChanges > 0 {
                    Label("\(gitStatus.stagedChanges) staged", systemImage: "plus.circle.fill")
                        .foregroundColor(.green)
                }

                if gitStatus.unstagedChanges > 0 {
                    Label("\(gitStatus.unstagedChanges) modified", systemImage: "pencil.circle.fill")
                        .foregroundColor(.orange)
                }

                if gitStatus.untrackedFiles > 0 {
                    Label("\(gitStatus.untrackedFiles) untracked", systemImage: "questionmark.circle.fill")
                        .foregroundColor(.gray)
                }
            }
            .font(.caption)

            // Ahead/behind
            if let branch = branch {
                HStack(spacing: 8) {
                    if branch.aheadCount > 0 {
                        Label("\(branch.aheadCount) ahead", systemImage: "arrow.up.circle")
                            .foregroundColor(.blue)
                    }
                    if branch.behindCount > 0 {
                        Label("\(branch.behindCount) behind", systemImage: "arrow.down.circle")
                            .foregroundColor(.purple)
                    }
                }
                .font(.caption)
            }
        }
    }
}

// MARK: - Git Status Indicator

struct GitStatusIndicator: View {
    @ObservedObject var gitManager: GitManager

    var body: some View {
        if gitManager.isGitRepo {
            Menu {
                // Current branch indicator
                Section {
                    Label("Current: \(gitManager.currentBranch ?? "detached")",
                          systemImage: "checkmark.circle.fill")
                }

                // Local branches for quick switching
                if !gitManager.localBranches.isEmpty {
                    Section("Switch to Branch") {
                        ForEach(gitManager.localBranches) { branch in
                            Button {
                                Task {
                                    try? await gitManager.checkoutBranch(branch.name)
                                }
                            } label: {
                                HStack {
                                    if branch.isHead {
                                        Image(systemName: "checkmark")
                                    }
                                    Text(branch.name)
                                }
                            }
                        }
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    BranchStatusBadge(
                        branch: gitManager.currentBranch,
                        gitStatus: gitManager.gitStatus,
                        isCompact: false
                    )
                    Image(systemName: "chevron.down")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            .menuStyle(.borderlessButton)
        } else {
            HStack(spacing: 4) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.caption2)
                Text("Not a git repo")
                    .font(.caption)
            }
            .foregroundColor(.secondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.secondary.opacity(0.1))
            .cornerRadius(4)
        }
    }
}

#Preview {
    VStack(spacing: 20) {
        BranchStatusBadge(
            branch: "main",
            gitStatus: GitStatus(
                isGitRepo: true,
                currentBranch: "main",
                hasUncommittedChanges: true,
                untrackedFiles: 2,
                stagedChanges: 1,
                unstagedChanges: 3
            )
        )

        BranchStatusBadge(
            branch: "feature/test",
            gitStatus: nil,
            isCompact: true
        )
    }
    .padding()
}
