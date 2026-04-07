import { useEffect } from "react";
import {
  useHotkeySettingsStore,
  matchesHotkey,
} from "@/stores/useHotkeySettingsStore";

interface UseAppKeyboardOptions {
  /** Callback to add a new session */
  onAddSession: () => void;
  /** Whether adding a session is currently allowed (e.g. in grid view) */
  canAddSession: boolean;
  /** Callback to switch to the next project tab */
  onCycleNextProject?: () => void;
  /** Callback to switch to the previous project tab */
  onCyclePrevProject?: () => void;
}

/**
 * App-level keyboard shortcut handler.
 *
 * Shortcuts (configurable via Keyboard Shortcuts settings):
 * - New Session (default Cmd/Ctrl+T): Add a new session slot (when in grid view)
 * - Next Project Tab (default Cmd/Ctrl+Shift+]): Cycle to next project
 * - Previous Project Tab (default Cmd/Ctrl+Shift+[): Cycle to previous project
 */
export function useAppKeyboard({
  onAddSession,
  canAddSession,
  onCycleNextProject,
  onCyclePrevProject,
}: UseAppKeyboardOptions): void {
  const hotkeys = useHotkeySettingsStore((s) => s.hotkeys);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (matchesHotkey(event, hotkeys.newSession)) {
        // Always prevent default to block WebView's new-tab behavior
        event.preventDefault();
        if (canAddSession) {
          onAddSession();
        }
        return;
      }

      if (matchesHotkey(event, hotkeys.cycleNextProject)) {
        event.preventDefault();
        onCycleNextProject?.();
        return;
      }

      if (matchesHotkey(event, hotkeys.cyclePrevProject)) {
        event.preventDefault();
        onCyclePrevProject?.();
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    hotkeys,
    onAddSession,
    canAddSession,
    onCycleNextProject,
    onCyclePrevProject,
  ]);
}
