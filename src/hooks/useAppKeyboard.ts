import { useEffect } from "react";

interface UseAppKeyboardOptions {
  /** Callback to add a new session */
  onAddSession: () => void;
  /** Whether adding a session is currently allowed (e.g. in grid view) */
  canAddSession: boolean;
}

/**
 * Detect whether the current platform uses Cmd (Mac) or Ctrl (Windows/Linux) as the modifier key.
 */
function isMac(): boolean {
  return navigator.platform.toLowerCase().includes("mac");
}

/**
 * App-level keyboard shortcut handler.
 *
 * Shortcuts:
 * - Cmd/Ctrl+T: Add a new session slot (when in grid view)
 */
export function useAppKeyboard({ onAddSession, canAddSession }: UseAppKeyboardOptions): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const modifierKey = isMac() ? event.metaKey : event.ctrlKey;
      if (!modifierKey) return;

      // Don't interfere with other modifier combinations
      if (event.altKey || event.shiftKey) return;

      if (event.key === "t") {
        // Always prevent default to block WebView's new-tab behavior
        event.preventDefault();
        if (canAddSession) {
          onAddSession();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onAddSession, canAddSession]);
}
