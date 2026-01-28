//
//  CommitRowView.swift
//  claude-maestro
//
//  Individual commit row with node circle and message
//

import SwiftUI

struct CommitRowView: View {
    let node: GraphNode
    let rails: [Rail]
    let isSelected: Bool
    let isHovered: Bool
    let activeSession: Int?
    let columnWidth: CGFloat
    let graphPadding: CGFloat
    let commitCircleSize: CGFloat

    private var graphAreaWidth: CGFloat {
        CGFloat(max(rails.count, 1)) * columnWidth + graphPadding * 2
    }

    private var railColor: Color {
        rails[safe: node.column]?.color ?? .gray
    }

    var body: some View {
        HStack(spacing: 0) {
            // Graph area with commit circle
            ZStack {
                // Commit circle
                CommitNodeView(
                    isHead: node.commit.isHead,
                    isMerge: node.commit.isMergeCommit,
                    isSelected: isSelected,
                    railColor: railColor,
                    size: commitCircleSize
                )
                .position(
                    x: graphPadding + CGFloat(node.column) * columnWidth + columnWidth / 2,
                    y: GitTreeView.rowHeight / 2
                )
            }
            .frame(width: graphAreaWidth, height: GitTreeView.rowHeight)

            // Message area
            HStack(spacing: 6) {
                // Ref labels (branches, tags)
                ForEach(node.commit.refs.prefix(3)) { ref in
                    RefLabel(ref: ref)
                }

                if node.commit.refs.count > 3 {
                    Text("+\(node.commit.refs.count - 3)")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 2)
                        .background(Color.secondary.opacity(0.15))
                        .cornerRadius(3)
                }

                // Commit message
                Text(node.commit.message)
                    .font(.system(.caption, design: .default))
                    .lineLimit(1)
                    .foregroundColor(isSelected ? .primary : .secondary)

                Spacer()

                // Active session indicator
                if let session = activeSession {
                    HStack(spacing: 2) {
                        Image(systemName: "cpu")
                            .font(.caption2)
                        Text("#\(session)")
                            .font(.caption2)
                    }
                    .foregroundColor(.purple)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(Color.purple.opacity(0.2))
                    .cornerRadius(4)
                }

                // Short hash
                Text(node.commit.shortHash)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundColor(.secondary)

                // Diff stats
                if let ins = node.commit.insertions, let del = node.commit.deletions {
                    HStack(spacing: 2) {
                        Text("+\(ins)")
                            .foregroundColor(.green)
                        Text("-\(del)")
                            .foregroundColor(.red)
                    }
                    .font(.system(.caption2, design: .monospaced))
                }

                // Relative date
                Text(node.commit.date.relativeDescription)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .frame(minWidth: 50, alignment: .trailing)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
        }
        .background(rowBackground)
    }

    private var rowBackground: some View {
        Group {
            if isSelected {
                Color.accentColor.opacity(0.15)
            } else if isHovered {
                Color.secondary.opacity(0.08)
            } else {
                Color.clear
            }
        }
    }
}

// MARK: - Commit Node View

struct CommitNodeView: View {
    let isHead: Bool
    let isMerge: Bool
    let isSelected: Bool
    let railColor: Color
    let size: CGFloat

    var body: some View {
        ZStack {
            // Main circle
            Circle()
                .fill(railColor)
                .frame(width: size, height: size)

            // Merge commit indicator (hollow center)
            if isMerge {
                Circle()
                    .fill(Color(NSColor.controlBackgroundColor))
                    .frame(width: size * 0.4, height: size * 0.4)
            }

            // HEAD indicator (outer ring)
            if isHead {
                Circle()
                    .stroke(Color.white, lineWidth: 2)
                    .frame(width: size + 4, height: size + 4)

                Circle()
                    .stroke(railColor, lineWidth: 1)
                    .frame(width: size + 6, height: size + 6)
            }

            // Selection indicator
            if isSelected {
                Circle()
                    .stroke(Color.accentColor, lineWidth: 2)
                    .frame(width: size + 8, height: size + 8)
            }
        }
        .frame(width: size + 12, height: size + 12)
    }
}

// MARK: - Ref Label View

struct RefLabel: View {
    let ref: GitRef

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: iconName)
                .font(.system(size: 8))
            Text(ref.displayName)
                .font(.system(size: 10, weight: .medium))
                .lineLimit(1)
        }
        .padding(.horizontal, 5)
        .padding(.vertical, 2)
        .background(backgroundColor)
        .foregroundColor(foregroundColor)
        .cornerRadius(4)
    }

    private var iconName: String {
        switch ref.type {
        case .localBranch:
            return ref.isHead ? "star.fill" : "arrow.triangle.branch"
        case .remoteBranch:
            return "cloud"
        case .tag:
            return "tag"
        }
    }

    private var backgroundColor: Color {
        switch ref.type {
        case .localBranch:
            return ref.isHead ? Color.green.opacity(0.2) : Color.blue.opacity(0.2)
        case .remoteBranch:
            return Color.purple.opacity(0.2)
        case .tag:
            return Color.orange.opacity(0.2)
        }
    }

    private var foregroundColor: Color {
        switch ref.type {
        case .localBranch:
            return ref.isHead ? .green : .blue
        case .remoteBranch:
            return .purple
        case .tag:
            return .orange
        }
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: 0) {
        CommitRowView(
            node: GraphNode(
                id: "abc1234",
                commit: Commit(
                    id: "abc1234567890",
                    shortHash: "abc1234",
                    message: "Initial commit with some long message that should truncate",
                    author: "John Doe",
                    authorEmail: "john@example.com",
                    date: Date(),
                    parentHashes: [],
                    isHead: true,
                    refs: [
                        GitRef(id: "main", name: "main", type: .localBranch, isHead: true),
                        GitRef(id: "origin/main", name: "origin/main", type: .remoteBranch, isHead: false)
                    ],
                    insertions: 42,
                    deletions: 15
                ),
                column: 0,
                row: 0,
                parentConnections: []
            ),
            rails: [Rail(id: 0, color: GraphLayoutEngine.railColors[0])],
            isSelected: false,
            isHovered: false,
            activeSession: 1,
            columnWidth: 16,
            graphPadding: 12,
            commitCircleSize: 10
        )

        CommitRowView(
            node: GraphNode(
                id: "def5678",
                commit: Commit(
                    id: "def5678901234",
                    shortHash: "def5678",
                    message: "Merge branch 'feature' into main",
                    author: "Jane Smith",
                    authorEmail: "jane@example.com",
                    date: Date().addingTimeInterval(-3600),
                    parentHashes: ["abc1234", "xyz9999"],
                    isHead: false,
                    refs: [],
                    insertions: 128,
                    deletions: 32
                ),
                column: 0,
                row: 1,
                parentConnections: []
            ),
            rails: [Rail(id: 0, color: GraphLayoutEngine.railColors[0])],
            isSelected: true,
            isHovered: false,
            activeSession: nil,
            columnWidth: 16,
            graphPadding: 12,
            commitCircleSize: 10
        )
    }
    .frame(width: 500)
    .background(Color(NSColor.controlBackgroundColor))
}
