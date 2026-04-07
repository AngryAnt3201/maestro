import { LazyStore } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { isMac } from "@/lib/platform";

// --- Types ---

/** A single hotkey binding. */
export type HotkeyBinding = {
  /** The `KeyboardEvent.key` value (e.g. "]", "t", "d"). */
  key: string;
  /** Whether Cmd (Mac) / Ctrl (Win/Linux) is required. */
  mod: boolean;
  /** Whether Shift is required. */
  shift: boolean;
  /** Whether Alt/Option is required. */
  alt: boolean;
};

/** All configurable hotkey action identifiers. */
export type HotkeyAction =
  | "newSession"
  | "cycleNextSession"
  | "cyclePrevSession"
  | "cycleNextProject"
  | "cyclePrevProject"
  | "splitVertical"
  | "splitHorizontal"
  | "closePane"
  | "clearTerminal"
  | "jumpToTerminal1"
  | "jumpToTerminal2"
  | "jumpToTerminal3"
  | "jumpToTerminal4"
  | "jumpToTerminal5"
  | "jumpToTerminal6"
  | "jumpToTerminal7"
  | "jumpToTerminal8"
  | "jumpToTerminal9"
  | "jumpToTerminal10";

/** The full hotkey configuration map. */
export type HotkeyConfig = Record<HotkeyAction, HotkeyBinding>;

/** Human-readable labels for each action. */
export const ACTION_LABELS: Record<HotkeyAction, string> = {
  cycleNextProject: "Next Project Tab",
  cyclePrevProject: "Previous Project Tab",
  cycleNextSession: "Next Session",
  cyclePrevSession: "Previous Session",
  newSession: "New Session",
  jumpToTerminal1: "Jump to Terminal 1",
  jumpToTerminal2: "Jump to Terminal 2",
  jumpToTerminal3: "Jump to Terminal 3",
  jumpToTerminal4: "Jump to Terminal 4",
  jumpToTerminal5: "Jump to Terminal 5",
  jumpToTerminal6: "Jump to Terminal 6",
  jumpToTerminal7: "Jump to Terminal 7",
  jumpToTerminal8: "Jump to Terminal 8",
  jumpToTerminal9: "Jump to Terminal 9",
  jumpToTerminal10: "Jump to Terminal 10",
  splitVertical: "Split Vertical",
  splitHorizontal: "Split Horizontal",
  closePane: "Close Pane",
  clearTerminal: "Clear Terminal",
};

/** Grouped action keys for the settings UI. */
export const ACTION_GROUPS: { label: string; actions: HotkeyAction[] }[] = [
  {
    label: "Projects",
    actions: ["cycleNextProject", "cyclePrevProject"],
  },
  {
    label: "Sessions",
    actions: [
      "cycleNextSession",
      "cyclePrevSession",
      "newSession",
      "jumpToTerminal1",
      "jumpToTerminal2",
      "jumpToTerminal3",
      "jumpToTerminal4",
      "jumpToTerminal5",
      "jumpToTerminal6",
      "jumpToTerminal7",
      "jumpToTerminal8",
      "jumpToTerminal9",
      "jumpToTerminal10",
    ],
  },
  {
    label: "Panes",
    actions: ["splitVertical", "splitHorizontal", "closePane"],
  },
  {
    label: "Terminal",
    actions: ["clearTerminal"],
  },
];

// --- Default Bindings ---

const DEFAULT_HOTKEYS: HotkeyConfig = {
  newSession: { key: "t", mod: true, shift: false, alt: false },
  cycleNextSession: { key: "]", mod: true, shift: false, alt: false },
  cyclePrevSession: { key: "[", mod: true, shift: false, alt: false },
  cycleNextProject: { key: "]", mod: true, shift: true, alt: false },
  cyclePrevProject: { key: "[", mod: true, shift: true, alt: false },
  splitVertical: { key: "d", mod: true, shift: false, alt: false },
  splitHorizontal: { key: "d", mod: true, shift: true, alt: false },
  closePane: { key: "w", mod: true, shift: false, alt: false },
  clearTerminal: { key: "k", mod: true, shift: false, alt: false },
  jumpToTerminal1: { key: "1", mod: true, shift: false, alt: false },
  jumpToTerminal2: { key: "2", mod: true, shift: false, alt: false },
  jumpToTerminal3: { key: "3", mod: true, shift: false, alt: false },
  jumpToTerminal4: { key: "4", mod: true, shift: false, alt: false },
  jumpToTerminal5: { key: "5", mod: true, shift: false, alt: false },
  jumpToTerminal6: { key: "6", mod: true, shift: false, alt: false },
  jumpToTerminal7: { key: "7", mod: true, shift: false, alt: false },
  jumpToTerminal8: { key: "8", mod: true, shift: false, alt: false },
  jumpToTerminal9: { key: "9", mod: true, shift: false, alt: false },
  jumpToTerminal10: { key: "0", mod: true, shift: false, alt: false },
};

// --- Utility Functions (non-store, synchronous) ---

/**
 * Check if a KeyboardEvent matches a HotkeyBinding.
 * The `mod` field checks metaKey on Mac, ctrlKey elsewhere.
 */
export function matchesHotkey(
  event: KeyboardEvent,
  binding: HotkeyBinding,
): boolean {
  const modKey = isMac() ? event.metaKey : event.ctrlKey;
  return (
    event.key === binding.key &&
    modKey === binding.mod &&
    event.shiftKey === binding.shift &&
    event.altKey === binding.alt
  );
}

/**
 * Check if a KeyboardEvent matches ANY configured hotkey binding.
 * Used by the xterm custom key handler to block hotkeys from reaching the PTY.
 * Reads the store synchronously via getState().
 */
export function shouldBlockForXterm(event: KeyboardEvent): boolean {
  if (event.type !== "keydown") return false;
  const { hotkeys } = useHotkeySettingsStore.getState();
  return Object.values(hotkeys).some((binding) =>
    matchesHotkey(event, binding),
  );
}

/**
 * Format a HotkeyBinding as a human-readable string.
 * e.g. "Cmd+Shift+]" on Mac, "Ctrl+Shift+]" on Win/Linux.
 */
export function formatBinding(binding: HotkeyBinding): string {
  const parts: string[] = [];
  if (binding.mod) parts.push(isMac() ? "Cmd" : "Ctrl");
  if (binding.shift) parts.push("Shift");
  if (binding.alt) parts.push(isMac() ? "Option" : "Alt");

  // Prettify certain key names
  let keyLabel = binding.key;
  if (keyLabel === " ") keyLabel = "Space";
  else if (keyLabel === "ArrowUp") keyLabel = "Up";
  else if (keyLabel === "ArrowDown") keyLabel = "Down";
  else if (keyLabel === "ArrowLeft") keyLabel = "Left";
  else if (keyLabel === "ArrowRight") keyLabel = "Right";
  else if (keyLabel.length === 1) keyLabel = keyLabel.toUpperCase();

  parts.push(keyLabel);
  return parts.join("+");
}

// --- Tauri LazyStore-backed StateStorage adapter ---

const lazyStore = new LazyStore("hotkey-settings.json");

const tauriStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const value = await lazyStore.get<string>(name);
      return value ?? null;
    } catch (err) {
      console.error(`tauriStorage.getItem("${name}") failed:`, err);
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      await lazyStore.set(name, value);
      await lazyStore.save();
    } catch (err) {
      console.error(`tauriStorage.setItem("${name}") failed:`, err);
      throw err;
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      await lazyStore.delete(name);
      await lazyStore.save();
    } catch (err) {
      console.error(`tauriStorage.removeItem("${name}") failed:`, err);
      throw err;
    }
  },
};

// --- Store ---

type HotkeySettingsState = {
  hotkeys: HotkeyConfig;
};

type HotkeySettingsActions = {
  /** Update a single hotkey binding. */
  setHotkey: (action: HotkeyAction, binding: HotkeyBinding) => void;
  /** Reset all hotkeys to defaults. */
  resetToDefaults: () => void;
  /** Reset a single hotkey to its default. */
  resetHotkey: (action: HotkeyAction) => void;
  /** Check if a binding conflicts with another action (returns conflicting action or null). */
  hasConflict: (
    action: HotkeyAction,
    binding: HotkeyBinding,
  ) => HotkeyAction | null;
};

export const useHotkeySettingsStore = create<
  HotkeySettingsState & HotkeySettingsActions
>()(
  persist(
    (set, get) => ({
      hotkeys: DEFAULT_HOTKEYS,

      setHotkey: (action, binding) => {
        set({
          hotkeys: {
            ...get().hotkeys,
            [action]: binding,
          },
        });
      },

      resetToDefaults: () => {
        set({ hotkeys: DEFAULT_HOTKEYS });
      },

      resetHotkey: (action) => {
        set({
          hotkeys: {
            ...get().hotkeys,
            [action]: DEFAULT_HOTKEYS[action],
          },
        });
      },

      hasConflict: (action, binding) => {
        const { hotkeys } = get();
        for (const [key, existing] of Object.entries(hotkeys)) {
          if (key === action) continue;
          if (
            existing.key === binding.key &&
            existing.mod === binding.mod &&
            existing.shift === binding.shift &&
            existing.alt === binding.alt
          ) {
            return key as HotkeyAction;
          }
        }
        return null;
      },
    }),
    {
      name: "maestro-hotkey-settings",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({ hotkeys: state.hotkeys }),
      version: 1,
    },
  ),
);
