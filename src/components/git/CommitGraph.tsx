import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { layoutGraph, type GraphNode } from "../../lib/graphLayout";
import { useGitStore } from "../../stores/useGitStore";
import { CommitRow } from "./CommitRow";
import { GraphCanvas } from "./GraphCanvas";

interface CommitGraphProps {
  repoPath: string;
  onSelectCommit: (node: GraphNode) => void;
  selectedCommitHash: string | null;
  currentBranch: string | null;
}

export const ROW_HEIGHT = 28;
const RAIL_WIDTH = 16;
const GRAPH_PADDING = 12;
const MIN_MESSAGE_WIDTH = 200;
const METADATA_WIDTH = 120;

export function CommitGraph({
  repoPath,
  onSelectCommit,
  selectedCommitHash,
  currentBranch,
}: CommitGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });

  // Git store
  const {
    commits,
    isLoading,
    isLoadingMore,
    hasMoreCommits,
    error,
    fetchCommits,
    loadMoreCommits,
    getRefsForCommit,
  } = useGitStore();

  // Refs cache - lazily loaded per commit
  const [refsCache, setRefsCache] = useState<Map<string, string[]>>(new Map());

  // Compute graph layout
  const { nodes, rails } = useMemo(() => layoutGraph(commits), [commits]);

  // Head commit hash (first commit on current branch)
  const headCommitHash = useMemo(() => {
    if (!currentBranch) return null;
    // The head is typically the first commit in topological order
    return commits.length > 0 ? commits[0].hash : null;
  }, [commits, currentBranch]);

  // Fetch commits on mount
  useEffect(() => {
    if (repoPath) {
      fetchCommits(repoPath);
    }
  }, [repoPath, fetchCommits]);

  // Fetch refs for visible commits
  useEffect(() => {
    if (!repoPath || nodes.length === 0) return;

    const fetchVisibleRefs = async () => {
      const visibleNodes = nodes.slice(visibleRange.start, visibleRange.end + 10);
      const newRefs = new Map(refsCache);
      let updated = false;

      for (const node of visibleNodes) {
        if (!newRefs.has(node.commit.hash)) {
          const refs = await getRefsForCommit(repoPath, node.commit.hash);
          newRefs.set(node.commit.hash, refs);
          updated = true;
        }
      }

      if (updated) {
        setRefsCache(newRefs);
      }
    };

    fetchVisibleRefs();
  }, [repoPath, nodes, visibleRange, refsCache, getRefsForCommit]);

  // Handle scroll for infinite loading and visibility tracking
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const { scrollTop, clientHeight, scrollHeight } = container;

    // Update visible range for canvas optimization
    const start = Math.floor(scrollTop / ROW_HEIGHT);
    const end = Math.ceil((scrollTop + clientHeight) / ROW_HEIGHT);
    setVisibleRange({ start, end });

    // Load more when near bottom
    if (
      scrollHeight - scrollTop - clientHeight < 200 &&
      hasMoreCommits &&
      !isLoadingMore
    ) {
      loadMoreCommits(repoPath);
    }
  }, [hasMoreCommits, isLoadingMore, loadMoreCommits, repoPath]);

  // Add scroll listener with passive option for performance
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onScroll = () => handleScroll();
    container.addEventListener("scroll", onScroll, { passive: true });

    // Trigger initial check
    handleScroll();

    return () => container.removeEventListener("scroll", onScroll);
  }, [handleScroll]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="text-center text-sm text-maestro-red">
          <p>Failed to load commits</p>
          <p className="mt-1 text-xs text-maestro-muted">{error}</p>
          <button
            type="button"
            onClick={() => fetchCommits(repoPath)}
            className="mt-3 rounded border border-maestro-border px-3 py-1 text-xs text-maestro-text hover:bg-maestro-card"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (isLoading && commits.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-maestro-muted">Loading commits...</div>
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-maestro-muted">No commits found</div>
      </div>
    );
  }

  // Calculate canvas width for positioning
  const maxColumn = rails.length > 0 ? rails.length - 1 : 0;
  const graphAreaWidth = GRAPH_PADDING + (maxColumn + 1) * RAIL_WIDTH + GRAPH_PADDING;

  // Calculate total content width for horizontal scrolling
  // Only enable horizontal scroll when graph area is wide enough to overlap content
  const minTotalWidth = graphAreaWidth + MIN_MESSAGE_WIDTH + METADATA_WIDTH;

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-auto"
      style={{ scrollbarWidth: "thin" }}
    >
      {/* Scrollable content wrapper */}
      <div className="relative" style={{ minWidth: minTotalWidth }}>
        {/* Graph lines layer */}
        <div className="absolute left-0 top-0" style={{ width: graphAreaWidth }}>
          <GraphCanvas
            nodes={nodes}
            rowHeight={ROW_HEIGHT}
            visibleStartRow={visibleRange.start}
            visibleEndRow={visibleRange.end}
          />
        </div>

        {/* Commit rows layer */}
        <div className="relative">
          {nodes.map((node) => (
            <CommitRow
              key={node.commit.hash}
              node={node}
              isSelected={node.commit.hash === selectedCommitHash}
              isHead={node.commit.hash === headCommitHash}
              refs={refsCache.get(node.commit.hash) ?? []}
              onClick={() => onSelectCommit(node)}
              graphAreaWidth={graphAreaWidth}
            />
          ))}

          {/* Load more indicator */}
          {isLoadingMore && (
            <div className="flex items-center justify-center py-2">
              <span className="text-xs text-maestro-muted">Loading more...</span>
            </div>
          )}

          {/* End of history indicator */}
          {!hasMoreCommits && commits.length > 0 && (
            <div className="flex items-center justify-center py-2">
              <span className="text-[10px] text-maestro-muted/50">
                End of history
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
