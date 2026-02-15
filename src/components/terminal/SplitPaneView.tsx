import { useCallback, useRef, type ReactNode } from "react";

import type { TreeNode } from "./splitTree";

interface SplitPaneViewProps {
  node: TreeNode;
  renderLeaf: (slotId: string) => ReactNode;
  onRatioChange: (nodeId: string, ratio: number) => void;
  onDragStateChange: (dragging: boolean) => void;
}

const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;

function clampRatio(ratio: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

/**
 * Recursive renderer for the binary split tree.
 *
 * - SplitNode → flex container with a draggable divider between two children
 * - LeafNode → calls `renderLeaf(slotId)`
 */
export function SplitPaneView({ node, renderLeaf, onRatioChange, onDragStateChange }: SplitPaneViewProps) {
  if (node.type === "leaf") {
    return (
      <div className="h-full w-full min-w-0 min-h-0 relative" data-slot-id={node.slotId}>
        {renderLeaf(node.slotId)}
      </div>
    );
  }

  const isVertical = node.direction === "vertical";

  // Use flexGrow proportional sharing so the 4px divider is naturally
  // subtracted from available space before children divide the remainder.
  return (
    <div
      className={`flex ${isVertical ? "flex-row" : "flex-col"} h-full w-full min-w-0 min-h-0`}
    >
      <div
        style={{ flexGrow: node.ratio, flexShrink: 1, flexBasis: 0 }}
        className="min-w-0 min-h-0 overflow-hidden"
      >
        <SplitPaneView
          node={node.children[0]}
          renderLeaf={renderLeaf}
          onRatioChange={onRatioChange}
          onDragStateChange={onDragStateChange}
        />
      </div>

      <Divider
        direction={node.direction}
        nodeId={node.id}
        onRatioChange={onRatioChange}
        onDragStateChange={onDragStateChange}
      />

      <div
        style={{ flexGrow: 1 - node.ratio, flexShrink: 1, flexBasis: 0 }}
        className="min-w-0 min-h-0 overflow-hidden"
      >
        <SplitPaneView
          node={node.children[1]}
          renderLeaf={renderLeaf}
          onRatioChange={onRatioChange}
          onDragStateChange={onDragStateChange}
        />
      </div>
    </div>
  );
}

interface DividerProps {
  direction: "horizontal" | "vertical";
  nodeId: string;
  onRatioChange: (nodeId: string, ratio: number) => void;
  onDragStateChange: (dragging: boolean) => void;
}

function Divider({ direction, nodeId, onRatioChange, onDragStateChange }: DividerProps) {
  const dividerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const divider = dividerRef.current;
      if (!divider) return;

      const parent = divider.parentElement;
      if (!parent) return;

      onDragStateChange(true);

      const isVertical = direction === "vertical";

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const rect = parent.getBoundingClientRect();
        let ratio: number;
        if (isVertical) {
          ratio = (moveEvent.clientX - rect.left) / rect.width;
        } else {
          ratio = (moveEvent.clientY - rect.top) / rect.height;
        }
        onRatioChange(nodeId, clampRatio(ratio));
      };

      const handleMouseUp = () => {
        onDragStateChange(false);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [direction, nodeId, onRatioChange, onDragStateChange],
  );

  const isVertical = direction === "vertical";

  return (
    <div
      ref={dividerRef}
      className={`split-divider ${isVertical ? "split-divider-vertical" : "split-divider-horizontal"}`}
      onMouseDown={handleMouseDown}
    />
  );
}
