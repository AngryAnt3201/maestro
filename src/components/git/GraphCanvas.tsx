import { useMemo } from "react";
import type { GraphNode, ParentConnection } from "../../lib/graphLayout";

interface GraphCanvasProps {
  nodes: GraphNode[];
  rowHeight: number;
  visibleStartRow: number;
  visibleEndRow: number;
}

/** Dimensions for the graph canvas. */
const RAIL_WIDTH = 16;
const GRAPH_PADDING = 12;

/**
 * Calculates the X position for a given column.
 */
function columnToX(column: number): number {
  return GRAPH_PADDING + column * RAIL_WIDTH + RAIL_WIDTH / 2;
}

/**
 * Calculates the Y position for a given row.
 */
function rowToY(row: number, rowHeight: number): number {
  return row * rowHeight + rowHeight / 2;
}

/**
 * Generates SVG path for a connection between commits.
 */
function generateConnectionPath(
  fromColumn: number,
  fromRow: number,
  connection: ParentConnection,
  rowHeight: number,
): string {
  const startX = columnToX(fromColumn);
  const startY = rowToY(fromRow, rowHeight);
  const endX = columnToX(connection.parentColumn);
  const endY = rowToY(connection.parentRow, rowHeight);

  if (connection.connectionType === "straight") {
    // Simple vertical line
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  }

  // For merge lines, use a bezier curve
  // The curve starts going down, then curves to the target column
  const midY = startY + (endY - startY) * 0.3;

  if (connection.connectionType === "mergeLeft") {
    // Curve going left
    return `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
  } else {
    // Curve going right
    return `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
  }
}

/**
 * SVG canvas that renders connection lines between commits.
 *
 * This is a separate layer that sits behind the commit rows,
 * allowing the lines to span across multiple rows.
 */
export function GraphCanvas({
  nodes,
  rowHeight,
  visibleStartRow,
  visibleEndRow,
}: GraphCanvasProps) {
  // Calculate the maximum column to determine canvas width
  const maxColumn = useMemo(() => {
    let max = 0;
    for (const node of nodes) {
      max = Math.max(max, node.column);
      for (const conn of node.parentConnections) {
        max = Math.max(max, conn.parentColumn);
      }
    }
    return max;
  }, [nodes]);

  // Calculate canvas dimensions
  const canvasWidth = GRAPH_PADDING + (maxColumn + 1) * RAIL_WIDTH + GRAPH_PADDING;
  const canvasHeight = nodes.length * rowHeight;

  // Filter connections that are visible
  const visibleConnections = useMemo(() => {
    const connections: Array<{
      node: GraphNode;
      connection: ParentConnection;
    }> = [];

    for (const node of nodes) {
      // Only process nodes that might have visible connections
      const nodeRow = node.row;

      for (const connection of node.parentConnections) {
        const parentRow = connection.parentRow;
        const minRow = Math.min(nodeRow, parentRow);
        const maxRow = Math.max(nodeRow, parentRow);

        // Check if this connection is at least partially visible
        if (maxRow >= visibleStartRow && minRow <= visibleEndRow) {
          connections.push({ node, connection });
        }
      }
    }

    return connections;
  }, [nodes, visibleStartRow, visibleEndRow]);

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0"
      width={canvasWidth}
      height={canvasHeight}
      style={{ overflow: "visible" }}
      aria-hidden="true"
    >
      {/* Connection lines */}
      {visibleConnections.map(({ node, connection }) => {
        const path = generateConnectionPath(node.column, node.row, connection, rowHeight);

        return (
          <path
            key={`${node.commit.hash}-${connection.parentHash}`}
            d={path}
            fill="none"
            stroke={node.railColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={connection.isOffScreen ? "4 2" : undefined}
            opacity={connection.isOffScreen ? 0.5 : 1}
          />
        );
      })}
    </svg>
  );
}
