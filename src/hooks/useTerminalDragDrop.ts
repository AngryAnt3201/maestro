import { useEffect, useMemo, useState } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";

import type { SessionSlot } from "@/components/terminal/PreLaunchCard";

interface UseTerminalDragDropOptions {
  slots: SessionSlot[];
  onDrop: (sessionId: number, paths: string[]) => void;
}

interface UseTerminalDragDropResult {
  /** Which pane slot is being hovered during a file drag */
  dropTargetSlotId: string | null;
  /** Whether an external file drag is active over the window */
  isDraggingFiles: boolean;
}

/**
 * Window-level drag-drop handler for files dragged from Finder/Explorer
 * onto terminal panes.
 *
 * Uses Tauri's native `onDragDropEvent` which provides physical coordinates
 * and file paths. Hit-tests against `[data-slot-id]` DOM elements to
 * determine which pane the files are being dragged over.
 */
export function useTerminalDragDrop({
  slots,
  onDrop,
}: UseTerminalDragDropOptions): UseTerminalDragDropResult {
  const [dropTargetSlotId, setDropTargetSlotId] = useState<string | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  // Build a lookup from slotId → sessionId for quick access
  const slotSessionMap = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const slot of slots) {
      map.set(slot.id, slot.sessionId);
    }
    return map;
  }, [slots]);

  useEffect(() => {
    const appWindow = getCurrentWindow();

    /**
     * Hit-test physical coordinates against `[data-slot-id]` elements.
     * Tauri provides PhysicalPosition — divide by devicePixelRatio to get CSS pixels.
     */
    function findSlotAtPosition(physX: number, physY: number): string | null {
      const scale = window.devicePixelRatio || 1;
      const cssX = physX / scale;
      const cssY = physY / scale;

      const slotElements = document.querySelectorAll<HTMLElement>("[data-slot-id]");
      for (const el of slotElements) {
        const rect = el.getBoundingClientRect();
        if (
          cssX >= rect.left &&
          cssX <= rect.right &&
          cssY >= rect.top &&
          cssY <= rect.bottom
        ) {
          return el.dataset.slotId ?? null;
        }
      }
      return null;
    }

    const unlisten = appWindow.onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") {
        setIsDraggingFiles(true);
        const pos = event.payload.position;
        const slotId = findSlotAtPosition(pos.x, pos.y);
        // Only highlight slots that have a launched session
        if (slotId && slotSessionMap.get(slotId) !== null) {
          setDropTargetSlotId(slotId);
        } else {
          setDropTargetSlotId(null);
        }
      } else if (event.payload.type === "drop") {
        const pos = event.payload.position;
        const slotId = findSlotAtPosition(pos.x, pos.y);
        if (slotId) {
          const sessionId = slotSessionMap.get(slotId);
          if (sessionId !== null && sessionId !== undefined) {
            onDrop(sessionId, event.payload.paths);
          }
        }
        setDropTargetSlotId(null);
        setIsDraggingFiles(false);
      } else if (event.payload.type === "leave") {
        setDropTargetSlotId(null);
        setIsDraggingFiles(false);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [slotSessionMap, onDrop]);

  return { dropTargetSlotId, isDraggingFiles };
}
