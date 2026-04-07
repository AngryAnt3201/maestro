import { useEffect } from "react";
import {
  type HotkeyAction,
  useHotkeySettingsStore,
  matchesHotkey,
} from "@/stores/useHotkeySettingsStore";

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

/** Map jump-to-terminal actions to their 0-based index. */
const JUMP_ACTIONS: [HotkeyAction, number][] = [
  ["jumpToTerminal1", 0],
  ["jumpToTerminal2", 1],
  ["jumpToTerminal3", 2],
  ["jumpToTerminal4", 3],
  ["jumpToTerminal5", 4],
  ["jumpToTerminal6", 5],
  ["jumpToTerminal7", 6],
  ["jumpToTerminal8", 7],
  ["jumpToTerminal9", 8],
  ["jumpToTerminal10", 9],
];

/**
 * Global keyboard shortcut handler for terminal navigation.
 *
 * All shortcuts are configurable via Keyboard Shortcuts settings.
 * Defaults:
 * - Cmd/Ctrl+1-9,0: Jump to terminal N
 * - Cmd/Ctrl+[: Cycle to previous terminal
 * - Cmd/Ctrl+]: Cycle to next terminal
 * - Cmd/Ctrl+D: Split pane vertically
 * - Cmd/Ctrl+Shift+D: Split pane horizontally
 * - Cmd/Ctrl+W: Close focused pane
 */
export function useTerminalKeyboard({
  terminalCount,
  focusedIndex,
  onFocusTerminal,
  onCycleNext,
  onCyclePrevious,
  onSplitVertical,
  onSplitHorizontal,
  onClosePane,
  enabled = true,
}: UseTerminalKeyboardOptions): void {
  const hotkeys = useHotkeySettingsStore((s) => s.hotkeys);

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(event: KeyboardEvent) {
      // Split pane shortcuts — work even with 0 launched terminals
      if (matchesHotkey(event, hotkeys.splitHorizontal)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onSplitHorizontal?.();
        return;
      }

      if (matchesHotkey(event, hotkeys.splitVertical)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onSplitVertical?.();
        return;
      }

      // Close pane
      if (matchesHotkey(event, hotkeys.closePane)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClosePane?.();
        return;
      }

      // Navigation shortcuts only apply when terminals exist
      if (terminalCount === 0) return;

      // Jump to terminal N
      for (const [action, index] of JUMP_ACTIONS) {
        if (matchesHotkey(event, hotkeys[action])) {
          if (index < terminalCount) {
            event.preventDefault();
            onFocusTerminal(index);
          }
          return;
        }
      }

      // Cycle terminals
      if (matchesHotkey(event, hotkeys.cycleNextSession)) {
        event.preventDefault();
        onCycleNext();
        return;
      }

      if (matchesHotkey(event, hotkeys.cyclePrevSession)) {
        event.preventDefault();
        onCyclePrevious();
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    enabled,
    hotkeys,
    terminalCount,
    focusedIndex,
    onFocusTerminal,
    onCycleNext,
    onCyclePrevious,
    onSplitVertical,
    onSplitHorizontal,
    onClosePane,
  ]);
}
