//
//  GraphLayoutEngine.swift
//  claude-maestro
//
//  Layout algorithm for git commit graph visualization
//

import SwiftUI

class GraphLayoutEngine {

    // GitKraken-style color palette
    static let railColors: [Color] = [
        Color(red: 0.35, green: 0.70, blue: 0.90),  // Cyan
        Color(red: 0.90, green: 0.45, blue: 0.45),  // Red
        Color(red: 0.55, green: 0.85, blue: 0.55),  // Green
        Color(red: 0.90, green: 0.70, blue: 0.35),  // Orange
        Color(red: 0.75, green: 0.55, blue: 0.90),  // Purple
        Color(red: 0.90, green: 0.55, blue: 0.75),  // Pink
        Color(red: 0.55, green: 0.75, blue: 0.55),  // Olive
        Color(red: 0.70, green: 0.70, blue: 0.90),  // Lavender
    ]

    /// Lays out commits into a visual graph structure
    /// - Parameter commits: Array of commits in topological order (newest first)
    /// - Returns: Tuple of graph nodes and rails
    func layoutGraph(commits: [Commit]) -> (nodes: [GraphNode], rails: [Rail]) {
        guard !commits.isEmpty else {
            return ([], [])
        }

        var nodes: [GraphNode] = []

        // Pre-compute set of all commit hashes for quick lookup
        let commitHashSet = Set(commits.map { $0.id })
        let totalRows = commits.count

        // Track which column each commit hash should use
        var commitToColumn: [String: Int] = [:]

        // Track which row each commit is at
        var commitToRow: [String: Int] = [:]

        // Track active columns: column index -> which commit hash is expected to continue there
        // When we see a commit, we check if any column is "waiting" for it
        var activeColumns: [Int: String] = [:]

        // First pass: assign columns to all commits
        for (row, commit) in commits.enumerated() {
            commitToRow[commit.id] = row

            // Find column for this commit
            let column = findColumn(for: commit, activeColumns: &activeColumns, commitToColumn: commitToColumn)
            commitToColumn[commit.id] = column

            // Update active columns based on this commit's parents (only for parents in our set)
            updateActiveColumns(for: commit, atColumn: column, activeColumns: &activeColumns, commitHashSet: commitHashSet)
        }

        // Second pass: create graph nodes with connections
        for (row, commit) in commits.enumerated() {
            let column = commitToColumn[commit.id] ?? 0

            let parentConnections: [ParentConnection] = commit.parentHashes.compactMap { parentHash in
                if let parentColumn = commitToColumn[parentHash],
                   let parentRow = commitToRow[parentHash] {
                    // Parent is in our loaded commits - normal connection
                    let connectionType = determineConnectionType(
                        fromColumn: column,
                        toColumn: parentColumn
                    )

                    return ParentConnection(
                        parentHash: parentHash,
                        parentColumn: parentColumn,
                        parentRow: parentRow,
                        connectionType: connectionType,
                        isOffScreen: false
                    )
                } else {
                    // Parent exists but is outside loaded range - create off-screen connection
                    // Draw line extending to bottom of visible area in the same column
                    return ParentConnection(
                        parentHash: parentHash,
                        parentColumn: column,  // Stay in same column
                        parentRow: totalRows,  // Extend to bottom
                        connectionType: .straight,
                        isOffScreen: true
                    )
                }
            }

            nodes.append(GraphNode(
                id: commit.id,
                commit: commit,
                column: column,
                row: row,
                parentConnections: parentConnections
            ))
        }

        // Create rails for the columns used
        let maxColumn = (commitToColumn.values.max() ?? 0) + 1
        let rails = (0..<maxColumn).map { index in
            Rail(
                id: index,
                color: Self.railColors[index % Self.railColors.count]
            )
        }

        return (nodes, rails)
    }

    // MARK: - Private Methods

    /// Find the appropriate column for a commit
    private func findColumn(
        for commit: Commit,
        activeColumns: inout [Int: String],
        commitToColumn: [String: Int]
    ) -> Int {
        // Check if any active column is waiting for this commit
        for (column, expectedHash) in activeColumns {
            if expectedHash == commit.id {
                return column
            }
        }

        // No column is waiting for us, find first available
        var column = 0
        while activeColumns[column] != nil {
            column += 1
        }

        return column
    }

    /// Update active columns after processing a commit
    private func updateActiveColumns(
        for commit: Commit,
        atColumn column: Int,
        activeColumns: inout [Int: String],
        commitHashSet: Set<String>
    ) {
        // Remove this commit from active columns (it's been consumed)
        activeColumns = activeColumns.filter { $0.value != commit.id }

        guard !commit.parentHashes.isEmpty else {
            // Root commit - nothing more to track
            return
        }

        // First parent continues in the same column (only if it's in our commit set)
        if let firstParent = commit.parentHashes.first,
           commitHashSet.contains(firstParent) {
            activeColumns[column] = firstParent
        }

        // Additional parents (merge commits) need their own columns
        for parentHash in commit.parentHashes.dropFirst() {
            // Only reserve column for parents that exist in our loaded commits
            guard commitHashSet.contains(parentHash) else {
                continue
            }
            // Find a free column for this merge parent
            // Try to place it adjacent to the current column
            var mergeColumn = column + 1
            while activeColumns[mergeColumn] != nil {
                mergeColumn += 1
            }
            activeColumns[mergeColumn] = parentHash
        }
    }

    /// Determine the type of connection line to draw
    private func determineConnectionType(
        fromColumn: Int,
        toColumn: Int
    ) -> ParentConnection.ConnectionType {
        if fromColumn == toColumn {
            return .straight
        } else if toColumn < fromColumn {
            return .mergeLeft
        } else {
            return .mergeRight
        }
    }
}
