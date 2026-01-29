//
//  GitTreeView.swift
//  claude-maestro
//
//  GitKraken-style commit graph visualization
//

import SwiftUI

struct GitTreeView: View {
    @ObservedObject var gitManager: GitManager
    @StateObject private var graphData = CommitGraphData()
    @State private var selectedCommit: Commit?
    @State private var hoveredCommit: Commit?
    @State private var isInitializing: Bool = false

    let activeSessionBranches: [String: Int]
    private let batchSize: Int = 50

    // Layout constants
    static let rowHeight: CGFloat = 32
    static let columnWidth: CGFloat = 16
    static let graphPadding: CGFloat = 12
    static let commitCircleSize: CGFloat = 10

    var body: some View {
        // Main graph area
        VStack(spacing: 0) {
            // Header
            GitTreeHeader(
                gitManager: gitManager,
                commitCount: graphData.commits.count,
                isLoading: graphData.isLoading,
                onRefresh: { Task { await loadGraph() } }
            )

            Divider()

            // Graph content
            if graphData.isLoading {
                loadingView
            } else if !gitManager.isGitRepo {
                notGitRepoView
            } else if graphData.commits.isEmpty {
                emptyView
            } else {
                graphScrollView
            }
        }
        .frame(minWidth: 300)
        .overlay(alignment: .trailing) {
            if let commit = selectedCommit {
                CommitDetailPanel(
                    commit: commit,
                    gitManager: gitManager,
                    onClose: { withAnimation(.easeInOut(duration: 0.2)) { selectedCommit = nil } },
                    onRefresh: { Task { await loadGraph() } }
                )
                .frame(width: 280)
                .background(Color(NSColor.controlBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .shadow(color: .black.opacity(0.2), radius: 8, x: -2, y: 0)
                .padding(.trailing, 8)
                .padding(.vertical, 8)
                .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .background(Color(NSColor.controlBackgroundColor))
        .task {
            await loadGraph()
        }
        .onChange(of: gitManager.currentBranch) { _, _ in
            Task { await loadGraph() }
        }
        .onChange(of: gitManager.repoPath) { _, _ in
            graphData.clear()
            Task { await loadGraph() }
        }
    }

    // MARK: - Subviews

    private var loadingView: some View {
        VStack(spacing: 12) {
            ProgressView()
                .scaleEffect(0.8)
            Text("Loading commits...")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var notGitRepoView: some View {
        VStack(spacing: 12) {
            Image(systemName: "folder.badge.questionmark")
                .font(.title)
                .foregroundColor(.secondary)
            Text("Not a git repository")
                .foregroundColor(.secondary)
                .font(.caption)

            Button(action: {
                Task {
                    isInitializing = true
                    defer { isInitializing = false }
                    do {
                        try await gitManager.initRepository()
                        await loadGraph()
                    } catch {
                        graphData.error = error as? GitError ?? .commandFailed(error.localizedDescription)
                    }
                }
            }) {
                HStack(spacing: 6) {
                    if isInitializing {
                        ProgressView()
                            .scaleEffect(0.6)
                    } else {
                        Image(systemName: "plus.circle.fill")
                    }
                    Text("Initialize Git")
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .disabled(isInitializing || gitManager.repoPath.isEmpty)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyView: some View {
        VStack(spacing: 8) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.title2)
                .foregroundColor(.secondary)
            Text("No commits found")
                .foregroundColor(.secondary)
                .font(.caption)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var graphScrollView: some View {
        ScrollView([.vertical, .horizontal]) {
            ZStack(alignment: .topLeading) {
                // Connection lines layer (behind everything)
                GraphCanvas(
                    nodes: graphData.nodes,
                    rails: graphData.rails,
                    rowHeight: Self.rowHeight,
                    columnWidth: Self.columnWidth,
                    graphPadding: Self.graphPadding
                )

                // Commit rows
                VStack(spacing: 0) {
                    ForEach(graphData.nodes) { node in
                        CommitRowView(
                            node: node,
                            rails: graphData.rails,
                            isSelected: selectedCommit?.id == node.id,
                            isHovered: hoveredCommit?.id == node.id,
                            activeSession: findActiveSession(for: node.commit),
                            columnWidth: Self.columnWidth,
                            graphPadding: Self.graphPadding,
                            commitCircleSize: Self.commitCircleSize
                        )
                        .frame(height: Self.rowHeight)
                        .contentShape(Rectangle())
                        .onTapGesture {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                selectedCommit = node.commit
                            }
                        }
                        .onHover { isHovered in
                            hoveredCommit = isHovered ? node.commit : nil
                        }
                    }

                    // Load more button
                    if graphData.hasMoreCommits && !graphData.commits.isEmpty {
                        loadMoreView
                    }
                }
            }
            .frame(
                minWidth: totalWidth,
                minHeight: CGFloat(graphData.nodes.count) * Self.rowHeight + (graphData.hasMoreCommits ? Self.rowHeight : 0)
            )
            .padding(.vertical, 4)
        }
    }

    private var loadMoreView: some View {
        HStack {
            Spacer()
            if graphData.isLoadingMore {
                ProgressView()
                    .scaleEffect(0.7)
                Text("Loading more commits...")
                    .font(.caption)
                    .foregroundColor(.secondary)
            } else {
                Button(action: {
                    Task { await loadMoreCommits() }
                }) {
                    Text("Load More Commits")
                        .font(.caption)
                }
                .buttonStyle(.bordered)
            }
            Spacer()
        }
        .frame(height: Self.rowHeight)
        .padding(.leading, Self.graphPadding + CGFloat(graphData.rails.count) * Self.columnWidth)
    }

    // MARK: - Helper Properties

    private var totalWidth: CGFloat {
        let graphWidth = CGFloat(max(graphData.rails.count, 1)) * Self.columnWidth + Self.graphPadding * 2
        let messageWidth: CGFloat = 400
        return graphWidth + messageWidth
    }

    // MARK: - Helper Methods

    private func findActiveSession(for commit: Commit) -> Int? {
        for ref in commit.refs {
            if let session = activeSessionBranches[ref.name] {
                return session
            }
        }
        return nil
    }

    private func loadGraph() async {
        graphData.isLoading = true
        defer { graphData.isLoading = false }

        do {
            let commits = try await gitManager.fetchCommitHistory(limit: batchSize)
            let engine = GraphLayoutEngine()
            let (nodes, rails) = engine.layoutGraph(commits: commits)

            await MainActor.run {
                graphData.update(commits: commits, nodes: nodes, rails: rails)
                graphData.hasMoreCommits = commits.count >= batchSize
            }
        } catch {
            await MainActor.run {
                graphData.error = error as? GitError ?? .commandFailed(error.localizedDescription)
            }
        }
    }

    private func loadMoreCommits() async {
        guard !graphData.isLoadingMore && graphData.hasMoreCommits else { return }

        graphData.isLoadingMore = true
        defer { graphData.isLoadingMore = false }

        do {
            let skip = graphData.commits.count
            let newCommits = try await gitManager.fetchCommitHistory(limit: batchSize, skip: skip)

            // If we got fewer commits than requested, we've reached the end
            if newCommits.count < batchSize {
                await MainActor.run {
                    graphData.hasMoreCommits = false
                }
            }

            // Only process if we actually got new commits
            guard !newCommits.isEmpty else { return }

            // Combine existing and new commits, then re-layout entire graph
            let allCommits = graphData.commits + newCommits
            let engine = GraphLayoutEngine()
            let (nodes, rails) = engine.layoutGraph(commits: allCommits)

            await MainActor.run {
                graphData.appendCommits(newCommits, nodes: nodes, rails: rails)
            }
        } catch {
            await MainActor.run {
                graphData.error = error as? GitError ?? .commandFailed(error.localizedDescription)
            }
        }
    }
}

// MARK: - Header View

struct GitTreeHeader: View {
    @ObservedObject var gitManager: GitManager
    let commitCount: Int
    let isLoading: Bool
    let onRefresh: () -> Void

    var body: some View {
        HStack {
            Image(systemName: "point.3.connected.trianglepath.dotted")
            Text("Commits")
                .font(.headline)

            if commitCount > 0 {
                Text("(\(commitCount))")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            // Current branch badge
            if let branch = gitManager.currentBranch {
                HStack(spacing: 4) {
                    Image(systemName: "star.fill")
                        .font(.caption2)
                        .foregroundColor(.yellow)
                    Text(branch)
                        .font(.caption)
                        .fontWeight(.medium)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Color.yellow.opacity(0.15))
                .cornerRadius(6)
            }

            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.borderless)
            .disabled(isLoading)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
}

// MARK: - Preview

#Preview {
    GitTreeView(
        gitManager: GitManager(),
        activeSessionBranches: ["main": 1, "feature/test": 3]
    )
    .frame(width: 600, height: 400)
}
