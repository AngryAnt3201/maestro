import { useEffect } from "react";

interface UseTerminalKeyboardOptions {
  /** Total number of launched terminals */
  terminalCount: number;
  /** Currently focused terminal index (0-based), or null if none focused */
  focusedIndex: number | null;
  /** Callback to focus a specific terminal by index */
  onFocusTerminal: (index: number) => void;
  /** Callback to cycle to the next terminal */
  onCycleNext: () => void;
  /** Callback to cycle to the previous terminal */
  onCyclePrevious: () => void;
  /** Callback to split the focused terminal vertically (Cmd+D) */
  onSplitVertical?: () => void;
  /** Callback to split the focused terminal horizontally (Cmd+Shift+D) */
  onSplitHorizontal?: () => void;
  /** Callback to close the focused pane (Cmd+W) */
  onClosePane?: () => void;
  /** Whether this keyboard handler is active (e.g. only for the active project tab) */
  enabled?: boolean;
}

/**
 * Detect whether the current platform uses Cmd (Mac) or Ctrl (Windows/Linux) as the modifier key.
 */
function isMac(): boolean {
  return navigator.platform.toLowerCase().includes("mac");
}

/**
 * Global keyboard shortcut handler for terminal navigation.
 *
 * Shortcuts:
 * - Cmd/Ctrl+1-9,0: Jump to terminal N (1-9 for terminals 1-9, 0 for terminal 10)
 * - Cmd/Ctrl+[: Cycle to previous terminal
 * - Cmd/Ctrl+]: Cycle to next terminal
 */
export function useTerminalKeyboard({
  terminalCount,
  onFocusTerminal,
  onCycleNext,
  onCyclePrevious,
  onSplitVertical,
  onSplitHorizontal,
  onClosePane,
  enabled = true,
}: UseTerminalKeyboardOptions): void {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(event: KeyboardEvent) {
      const modifierKey = isMac() ? event.metaKey : event.ctrlKey;
      if (!modifierKey) return;

      // Cmd/Ctrl+D: split pane (Shift = horizontal, no Shift = vertical)
      // Works even with 0 launched terminals (splits pre-launch cards too)
      if (event.key === "d" && !event.altKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.shiftKey) {
          onSplitHorizontal?.();
        } else {
          onSplitVertical?.();
        }
        return;
      }

      // Cmd/Ctrl+W: close the focused pane
      if (event.key === "w" && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClosePane?.();
        return;
      }

      // Navigation shortcuts only apply when terminals exist
      if (terminalCount === 0) return;

      // Don't interfere with other modifier combinations
      if (event.altKey || event.shiftKey) return;

      // Handle number keys 1-9 and 0 for terminal jumping
      if (event.key >= "1" && event.key <= "9") {
        const targetIndex = parseInt(event.key, 10) - 1;
        if (targetIndex < terminalCount) {
          event.preventDefault();
          onFocusTerminal(targetIndex);
        }
        return;
      }

      if (event.key === "0") {
        // 0 maps to terminal 10 (index 9)
        const targetIndex = 9;
        if (targetIndex < terminalCount) {
          event.preventDefault();
          onFocusTerminal(targetIndex);
        }
        return;
      }

      // Handle bracket keys for cycling
      if (event.key === "]") {
        event.preventDefault();
        onCycleNext();
        return;
      }

      if (event.key === "[") {
        event.preventDefault();
        onCyclePrevious();
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    enabled,
    terminalCount,
    onFocusTerminal,
    onCycleNext,
    onCyclePrevious,
    onSplitVertical,
    onSplitHorizontal,
    onClosePane,
  ]);
}
