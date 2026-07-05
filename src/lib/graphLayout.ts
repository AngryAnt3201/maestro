import type { CommitInfo } from "../stores/useGitStore";

/**
 * GitKraken-style color palette for rails.
 * Each rail gets a unique color based on its column index.
 */
export const RAIL_COLORS = [
  "rgb(89, 179, 230)", // Cyan
  "rgb(230, 115, 115)", // Red
  "rgb(140, 217, 140)", // Green
  "rgb(230, 179, 89)", // Orange
  "rgb(191, 140, 230)", // Purple
  "rgb(230, 140, 191)", // Pink
  "rgb(140, 191, 140)", // Olive
  "rgb(179, 179, 230)", // Lavender
] as const;

/** Type of line connection between commits. */
export type ConnectionType = "straight" | "mergeLeft" | "mergeRight";

/** Connection to a parent commit. */
export interface ParentConnection {
  parentHash: string;
  parentColumn: number;
  parentRow: number;
  connectionType: ConnectionType;
  /** Parent exists but is outside the loaded commit range. */
  isOffScreen: boolean;
}

/** A commit positioned in the graph with connection metadata. */
export interface GraphNode {
  commit: CommitInfo;
  column: number;
  row: number;
  parentConnections: ParentConnection[];
  railColor: string;
}

/** A rail (column) in the graph with its assigned color. */
export interface Rail {
  id: number;
  color: string;
}

/**
 * Lays out commits into a visual graph structure.
 *
 * Uses a two-pass algorithm:
 * 1. First pass: Assign columns to all commits based on parent relationships
 * 2. Second pass: Create graph nodes with connection information
 *
 * @param commits - Array of commits in topological order (newest first)
 * @returns Tuple of graph nodes and rails
 */
export function layoutGraph(commits: CommitInfo[]): { nodes: GraphNode[]; rails: Rail[] } {
  if (commits.length === 0) {
    return { nodes: [], rails: [] };
  }

  // Pre-compute set of all commit hashes for quick lookup
  const commitHashSet = new Set(commits.map((c) => c.hash));
  const totalRows = commits.length;

  // Track which column each commit hash should use
  const commitToColumn = new Map<string, number>();

  // Track which row each commit is at
  const commitToRow = new Map<string, number>();

  // Track active columns: column index -> which commit hash is expected to continue there
  // When we see a commit, we check if any column is "waiting" for it
  const activeColumns = new Map<number, string>();

  // First pass: assign columns to all commits
  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row];
    commitToRow.set(commit.hash, row);

    // Find column for this commit
    const column = findColumn(commit, activeColumns, commitToColumn);
    commitToColumn.set(commit.hash, column);

    // Update active columns based on this commit's parents (only for parents in our set)
    updateActiveColumns(commit, column, activeColumns, commitHashSet);
  }

  // Second pass: create graph nodes with connections
  const nodes: GraphNode[] = [];

  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row];
    const column = commitToColumn.get(commit.hash) ?? 0;

    const parentConnections: ParentConnection[] = commit.parent_hashes.map((parentHash) => {
      const parentColumn = commitToColumn.get(parentHash);
      const parentRow = commitToRow.get(parentHash);

      if (parentColumn !== undefined && parentRow !== undefined) {
        // Parent is in our loaded commits - normal connection
        const connectionType = determineConnectionType(column, parentColumn);

        return {
          parentHash,
          parentColumn,
          parentRow,
          connectionType,
          isOffScreen: false,
        };
      } else {
        // Parent exists but is outside loaded range - create off-screen connection
        // Draw line extending to bottom of visible area in the same column
        return {
          parentHash,
          parentColumn: column, // Stay in same column
          parentRow: totalRows, // Extend to bottom
          connectionType: "straight" as ConnectionType,
          isOffScreen: true,
        };
      }
    });

    nodes.push({
      commit,
      column,
      row,
      parentConnections,
      railColor: RAIL_COLORS[column % RAIL_COLORS.length],
    });
  }

  // Create rails for the columns used
  const maxColumn = Math.max(...Array.from(commitToColumn.values()), 0) + 1;
  const rails: Rail[] = Array.from({ length: maxColumn }, (_, index) => ({
    id: index,
    color: RAIL_COLORS[index % RAIL_COLORS.length],
  }));

  return { nodes, rails };
}

/**
 * Find the appropriate column for a commit.
 */
function findColumn(
  commit: CommitInfo,
  activeColumns: Map<number, string>,
  _commitToColumn: Map<string, number>,
): number {
  // Check if any active column is waiting for this commit
  for (const [column, expectedHash] of activeColumns) {
    if (expectedHash === commit.hash) {
      return column;
    }
  }

  // No column is waiting for us, find first available
  let column = 0;
  while (activeColumns.has(column)) {
    column++;
  }

  return column;
}

/**
 * Update active columns after processing a commit.
 */
function updateActiveColumns(
  commit: CommitInfo,
  column: number,
  activeColumns: Map<number, string>,
  commitHashSet: Set<string>,
): void {
  // Remove this commit from active columns (it's been consumed)
  for (const [col, hash] of activeColumns) {
    if (hash === commit.hash) {
      activeColumns.delete(col);
    }
  }

  if (commit.parent_hashes.length === 0) {
    // Root commit - nothing more to track
    return;
  }

  // First parent continues in the same column (only if it's in our commit set)
  const firstParent = commit.parent_hashes[0];
  if (firstParent && commitHashSet.has(firstParent)) {
    activeColumns.set(column, firstParent);
  }

  // Additional parents (merge commits) need their own columns
  for (let i = 1; i < commit.parent_hashes.length; i++) {
    const parentHash = commit.parent_hashes[i];
    // Only reserve column for parents that exist in our loaded commits
    if (!commitHashSet.has(parentHash)) {
      continue;
    }

    // Find a free column for this merge parent
    // Try to place it adjacent to the current column
    let mergeColumn = column + 1;
    while (activeColumns.has(mergeColumn)) {
      mergeColumn++;
    }
    activeColumns.set(mergeColumn, parentHash);
  }
}

/**
 * Determine the type of connection line to draw.
 */
function determineConnectionType(fromColumn: number, toColumn: number): ConnectionType {
  if (fromColumn === toColumn) {
    return "straight";
  } else if (toColumn < fromColumn) {
    return "mergeLeft";
  } else {
    return "mergeRight";
  }
}

/**
 * Gets the rail color for a given column index.
 */
export function getRailColor(column: number): string {
  return RAIL_COLORS[column % RAIL_COLORS.length];
}

/**
 * Creates lookup maps for quick access to nodes by hash.
 */
export function createNodeLookup(nodes: GraphNode[]): Map<string, GraphNode> {
  return new Map(nodes.map((node) => [node.commit.hash, node]));
}
