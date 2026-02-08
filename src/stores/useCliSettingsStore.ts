import { LazyStore } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type { AiMode } from "@/lib/terminal";

// --- Types ---

/** CLI flags configuration for a single AI mode. */
export type AiModeCliFlags = {
  /** Whether to include --dangerously-skip-permissions flag. */
  skipPermissions: boolean;
  /** Whether to automatically check and apply updates. */
  autoUpdate: boolean;
  /** Timestamp of the last successful update check. */
  lastUpdateCheck: number;
  /** Space-separated additional custom flags. */
  customFlags: string;
};

/** CLI flags configuration for all AI modes. */
export type CliFlagsConfig = Record<Exclude<AiMode, "Plain">, AiModeCliFlags>;

/** Read-only slice of the CLI settings store; persisted to disk. */
type CliSettingsState = {
  flags: CliFlagsConfig;
};

/** Actions for managing CLI settings. */
type CliSettingsActions = {
  /** Update the skipPermissions flag for a mode. */
  setSkipPermissions: (mode: Exclude<AiMode, "Plain">, value: boolean) => void;
  /** Update the autoUpdate flag for a mode. */
  setAutoUpdate: (mode: Exclude<AiMode, "Plain">, value: boolean) => void;
  /** Update the custom flags for a mode. */
  setCustomFlags: (mode: Exclude<AiMode, "Plain">, value: string) => void;
  /** Reset all settings for a specific mode to defaults. */
  resetModeToDefaults: (mode: Exclude<AiMode, "Plain">) => void;
  /** Reset all settings to defaults. */
  resetAllToDefaults: () => void;
  /** Update the last update check timestamp. */
  setLastUpdateCheck: (mode: Exclude<AiMode, "Plain">, value: number) => void;
  /** Get the effective flags for a mode. */
  getFlags: (mode: Exclude<AiMode, "Plain">) => AiModeCliFlags;
};

// --- Default Settings ---

const DEFAULT_MODE_FLAGS: AiModeCliFlags = {
  skipPermissions: false,
  autoUpdate: true,
  lastUpdateCheck: 0,
  customFlags: "",
};

const DEFAULT_FLAGS: CliFlagsConfig = {
  Claude: { ...DEFAULT_MODE_FLAGS },
  Gemini: { ...DEFAULT_MODE_FLAGS },
  Codex: { ...DEFAULT_MODE_FLAGS },
};

function normalizeModeFlags(flags?: Partial<AiModeCliFlags> & {
  autoUpdateEnabled?: boolean;
  autoApplyUpdates?: boolean;
}): AiModeCliFlags {
  const migratedAutoUpdate =
    flags?.autoUpdate ??
    flags?.autoApplyUpdates ??
    flags?.autoUpdateEnabled ??
    DEFAULT_MODE_FLAGS.autoUpdate;

  return {
    skipPermissions: flags?.skipPermissions ?? DEFAULT_MODE_FLAGS.skipPermissions,
    autoUpdate: migratedAutoUpdate,
    lastUpdateCheck: flags?.lastUpdateCheck ?? DEFAULT_MODE_FLAGS.lastUpdateCheck,
    customFlags: flags?.customFlags ?? DEFAULT_MODE_FLAGS.customFlags,
  };
}

function normalizeFlagsConfig(flags?: Partial<Record<Exclude<AiMode, "Plain">, Partial<AiModeCliFlags> & {
  autoUpdateEnabled?: boolean;
  autoApplyUpdates?: boolean;
}>>): CliFlagsConfig {
  return {
    Claude: normalizeModeFlags(flags?.Claude),
    Gemini: normalizeModeFlags(flags?.Gemini),
    Codex: normalizeModeFlags(flags?.Codex),
  };
}

// --- Tauri LazyStore-backed StateStorage adapter ---

/**
 * Singleton LazyStore instance for CLI settings.
 * Stored separately from other store files to keep concerns separate.
 */
const lazyStore = new LazyStore("cli-settings.json");

/**
 * Zustand-compatible StateStorage adapter backed by the Tauri plugin-store.
 */
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

/**
 * Global store for CLI settings.
 *
 * Manages per-AI-mode CLI flags with persistence.
 * Flags are automatically applied when launching CLI sessions.
 */
export const useCliSettingsStore = create<CliSettingsState & CliSettingsActions>()(
  persist(
    (set, get) => ({
      flags: DEFAULT_FLAGS,

      setSkipPermissions: (mode, value) => {
        set({
          flags: {
            ...get().flags,
            [mode]: {
              ...get().flags[mode],
              skipPermissions: value,
            },
          },
        });
      },

      setAutoUpdate: (mode, value) => {
        set({
          flags: {
            ...get().flags,
            [mode]: {
              ...get().flags[mode],
              autoUpdate: value,
            },
          },
        });
      },

      setCustomFlags: (mode, value) => {
        set({
          flags: {
            ...get().flags,
            [mode]: {
              ...get().flags[mode],
              customFlags: value,
            },
          },
        });
      },

      setLastUpdateCheck: (mode, value) => {
        set({
          flags: {
            ...get().flags,
            [mode]: {
              ...get().flags[mode],
              lastUpdateCheck: value,
            },
          },
        });
      },

      resetModeToDefaults: (mode) => {
        set({
          flags: {
            ...get().flags,
            [mode]: { ...DEFAULT_MODE_FLAGS },
          },
        });
      },

      resetAllToDefaults: () => {
        set({
          flags: {
            Claude: { ...DEFAULT_MODE_FLAGS },
            Gemini: { ...DEFAULT_MODE_FLAGS },
            Codex: { ...DEFAULT_MODE_FLAGS },
          },
        });
      },

      getFlags: (mode) => {
        return normalizeModeFlags(get().flags[mode]);
      },
    }),
    {
      name: "maestro-cli-settings",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({ flags: state.flags }),
      version: 2,
      migrate: (persistedState) => {
        const state = persistedState as Partial<CliSettingsState> | undefined;
        return {
          flags: normalizeFlagsConfig(state?.flags as any),
        };
      },
    }
  )
);
