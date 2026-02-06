import { GitBranch, GitMerge, Tag } from "lucide-react";
import { useMemo } from "react";
import type { GraphNode } from "../../lib/graphLayout";
import { ROW_HEIGHT } from "./CommitGraph";

interface CommitRowProps {
  node: GraphNode;
  isSelected: boolean;
  isHead: boolean;
  refs: string[];
  onClick: () => void;
  graphAreaWidth?: number;
}

/** Dimensions for the graph canvas on the left side. */
const RAIL_WIDTH = 16;
const DOT_RADIUS = 5;
const GRAPH_PADDING = 12;

export function CommitRow({ node, isSelected, isHead, refs, onClick, graphAreaWidth }: CommitRowProps) {
  const { commit, column, railColor } = node;
  const isMerge = commit.parent_hashes.length > 1;

  // Parse refs into branches and tags
  const { branches, tags, remoteBranches } = useMemo(() => {
    const branches: string[] = [];
    const tags: string[] = [];
    const remoteBranches: string[] = [];

    for (const ref of refs) {
      if (ref.startsWith("tag:")) {
        tags.push(ref.slice(4));
      } else if (ref.includes("/")) {
        remoteBranches.push(ref);
      } else {
        branches.push(ref);
      }
    }

    return { branches, tags, remoteBranches };
  }, [refs]);

  // Format relative time
  const relativeTime = useMemo(() => {
    const now = Date.now();
    const commitTime = commit.timestamp * 1000;
    const diff = now - commitTime;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (years > 0) return `${years}y`;
    if (months > 0) return `${months}mo`;
    if (weeks > 0) return `${weeks}w`;
    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return "now";
  }, [commit.timestamp]);

  // Use provided graphAreaWidth or calculate based on column position
  const graphWidth = graphAreaWidth ?? GRAPH_PADDING + (column + 1) * RAIL_WIDTH + GRAPH_PADDING;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 border-b border-maestro-border/30 pr-2 text-left transition-colors h-7 ${
        isSelected
          ? "bg-maestro-accent/20 hover:bg-maestro-accent/25"
          : "hover:bg-maestro-card/50"
      }`}
    >
      {/* Graph dot area */}
      <div
        className="relative flex shrink-0 items-center justify-center"
        style={{ width: graphWidth, height: ROW_HEIGHT }}
      >
        <svg
          width={graphWidth}
          height={ROW_HEIGHT}
          className="absolute left-0 top-0"
        >
          {/* Commit dot */}
          <circle
            cx={GRAPH_PADDING + column * RAIL_WIDTH + RAIL_WIDTH / 2}
            cy={ROW_HEIGHT / 2}
            r={isMerge ? DOT_RADIUS + 1 : DOT_RADIUS}
            fill={railColor}
            stroke={isHead ? "#fff" : "none"}
            strokeWidth={isHead ? 2 : 0}
          />
          {/* Merge indicator - inner dot */}
          {isMerge && (
            <circle
              cx={GRAPH_PADDING + column * RAIL_WIDTH + RAIL_WIDTH / 2}
              cy={ROW_HEIGHT / 2}
              r={DOT_RADIUS - 2}
              fill="#1a1a1a"
            />
          )}
        </svg>
      </div>

      {/* Refs (branches, tags) */}
      <div className="flex shrink-0 items-center gap-1">
        {branches.map((branch) => (
          <span
            key={branch}
            className="flex items-center gap-1 rounded bg-maestro-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-maestro-accent"
          >
            <GitBranch size={10} />
            {branch}
          </span>
        ))}
        {remoteBranches.slice(0, 1).map((branch) => (
          <span
            key={branch}
            className="flex items-center gap-1 rounded bg-maestro-muted/20 px-1.5 py-0.5 text-[10px] font-medium text-maestro-muted"
          >
            <GitBranch size={10} />
            {branch.split("/").pop()}
          </span>
        ))}
        {remoteBranches.length > 1 && (
          <span className="text-[10px] text-maestro-muted">
            +{remoteBranches.length - 1}
          </span>
        )}
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded bg-maestro-yellow/20 px-1.5 py-0.5 text-[10px] font-medium text-maestro-yellow"
          >
            <Tag size={10} />
            {tag}
          </span>
        ))}
      </div>

      {/* Commit message */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {isMerge && (
          <GitMerge size={12} className="shrink-0 text-maestro-muted" />
        )}
        <span className="truncate text-xs text-maestro-text">
          {commit.summary}
        </span>
      </div>

      {/* Short hash */}
      <span className="shrink-0 font-mono text-[10px] text-maestro-muted">
        {commit.short_hash}
      </span>

      {/* Relative time */}
      <span className="w-8 shrink-0 text-right text-[10px] text-maestro-muted/60">
        {relativeTime}
      </span>
    </button>
  );
}
