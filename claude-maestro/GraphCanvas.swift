//
//  GraphCanvas.swift
//  claude-maestro
//
//  Canvas-based drawing for git graph connection lines
//

import SwiftUI

struct GraphCanvas: View {
    let nodes: [GraphNode]
    let rails: [Rail]
    let rowHeight: CGFloat
    let columnWidth: CGFloat
    let graphPadding: CGFloat

    private let lineWidth: CGFloat = 2

    var body: some View {
        Canvas { context, size in
            // Draw all connection lines
            for node in nodes {
                drawConnections(context: &context, node: node)
            }
        }
        .frame(
            width: CGFloat(max(rails.count, 1)) * columnWidth + graphPadding * 2,
            height: CGFloat(nodes.count) * rowHeight
        )
    }

    // MARK: - Drawing Methods

    private func drawConnections(context: inout GraphicsContext, node: GraphNode) {
        for connection in node.parentConnections {
            drawConnection(context: &context, from: node, connection: connection)
        }

        // Draw vertical line segment if this node continues to a parent below
        if let firstConnection = node.parentConnections.first,
           firstConnection.connectionType == .straight {
            drawStraightLine(context: &context, node: node, connection: firstConnection)
        }
    }

    private func drawConnection(
        context: inout GraphicsContext,
        from node: GraphNode,
        connection: ParentConnection
    ) {
        let startPoint = pointForNode(column: node.column, row: node.row)
        let endPoint = pointForNode(column: connection.parentColumn, row: connection.parentRow)
        let color = rails[safe: node.column]?.color ?? .gray

        var path = Path()
        path.move(to: startPoint)

        switch connection.connectionType {
        case .straight:
            // Simple vertical line
            path.addLine(to: endPoint)

        case .mergeLeft, .mergeRight:
            // Bezier curve for merge lines
            let midY = startPoint.y + (endPoint.y - startPoint.y) * 0.3

            // First, go down a bit in the same column
            let dropPoint = CGPoint(x: startPoint.x, y: midY)
            path.addLine(to: dropPoint)

            // Then curve to the target column
            path.addCurve(
                to: endPoint,
                control1: CGPoint(x: startPoint.x, y: midY + (endPoint.y - midY) * 0.5),
                control2: CGPoint(x: endPoint.x, y: midY + (endPoint.y - midY) * 0.5)
            )
        }

        // Use dashed stroke for off-screen connections
        if connection.isOffScreen {
            context.stroke(
                path,
                with: .color(color.opacity(0.6)),
                style: StrokeStyle(lineWidth: lineWidth, dash: [4, 4])
            )
        } else {
            context.stroke(
                path,
                with: .color(color),
                lineWidth: lineWidth
            )
        }
    }

    private func drawStraightLine(
        context: inout GraphicsContext,
        node: GraphNode,
        connection: ParentConnection
    ) {
        let startPoint = pointForNode(column: node.column, row: node.row)
        let endPoint = pointForNode(column: connection.parentColumn, row: connection.parentRow)
        let color = rails[safe: node.column]?.color ?? .gray

        var path = Path()
        path.move(to: startPoint)
        path.addLine(to: endPoint)

        context.stroke(
            path,
            with: .color(color),
            lineWidth: lineWidth
        )
    }

    // MARK: - Helper Methods

    private func pointForNode(column: Int, row: Int) -> CGPoint {
        CGPoint(
            x: graphPadding + CGFloat(column) * columnWidth + columnWidth / 2,
            y: CGFloat(row) * rowHeight + rowHeight / 2
        )
    }
}

// MARK: - Preview

#Preview {
    let sampleNodes = [
        GraphNode(
            id: "1",
            commit: Commit(
                id: "1", shortHash: "abc1234", message: "Commit 1",
                author: "Test", authorEmail: "test@test.com",
                date: Date(), parentHashes: ["2"], isHead: true, refs: []
            ),
            column: 0, row: 0,
            parentConnections: [
                ParentConnection(parentHash: "2", parentColumn: 0, parentRow: 1, connectionType: .straight, isOffScreen: false)
            ]
        ),
        GraphNode(
            id: "2",
            commit: Commit(
                id: "2", shortHash: "def5678", message: "Commit 2",
                author: "Test", authorEmail: "test@test.com",
                date: Date(), parentHashes: ["3", "4"], isHead: false, refs: []
            ),
            column: 0, row: 1,
            parentConnections: [
                ParentConnection(parentHash: "3", parentColumn: 0, parentRow: 2, connectionType: .straight, isOffScreen: false),
                ParentConnection(parentHash: "4", parentColumn: 1, parentRow: 3, connectionType: .mergeRight, isOffScreen: false)
            ]
        ),
        GraphNode(
            id: "3",
            commit: Commit(
                id: "3", shortHash: "ghi9012", message: "Commit 3",
                author: "Test", authorEmail: "test@test.com",
                date: Date(), parentHashes: ["5"], isHead: false, refs: []
            ),
            column: 0, row: 2,
            parentConnections: [
                ParentConnection(parentHash: "5", parentColumn: 0, parentRow: 4, connectionType: .straight, isOffScreen: false)
            ]
        ),
        GraphNode(
            id: "4",
            commit: Commit(
                id: "4", shortHash: "jkl3456", message: "Commit 4 (feature)",
                author: "Test", authorEmail: "test@test.com",
                date: Date(), parentHashes: ["5"], isHead: false, refs: []
            ),
            column: 1, row: 3,
            parentConnections: [
                ParentConnection(parentHash: "5", parentColumn: 0, parentRow: 4, connectionType: .mergeLeft, isOffScreen: false)
            ]
        ),
        GraphNode(
            id: "5",
            commit: Commit(
                id: "5", shortHash: "mno7890", message: "Commit 5 (root)",
                author: "Test", authorEmail: "test@test.com",
                date: Date(), parentHashes: [], isHead: false, refs: []
            ),
            column: 0, row: 4,
            parentConnections: []
        )
    ]

    let sampleRails = [
        Rail(id: 0, color: GraphLayoutEngine.railColors[0]),
        Rail(id: 1, color: GraphLayoutEngine.railColors[1])
    ]

    return ZStack(alignment: .topLeading) {
        GraphCanvas(
            nodes: sampleNodes,
            rails: sampleRails,
            rowHeight: 32,
            columnWidth: 16,
            graphPadding: 12
        )

        // Overlay circles for visualization
        ForEach(sampleNodes) { node in
            Circle()
                .fill(sampleRails[safe: node.column]?.color ?? .gray)
                .frame(width: 10, height: 10)
                .position(
                    x: 12 + CGFloat(node.column) * 16 + 8,
                    y: CGFloat(node.row) * 32 + 16
                )
        }
    }
    .frame(width: 200, height: 200)
    .background(Color(NSColor.controlBackgroundColor))
}
