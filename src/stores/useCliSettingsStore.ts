import { LazyStore } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type { AiMode } from "@/lib/terminal";

// --- Types ---

/** CLI flags configuration for a single AI mode. */
export type AiModeCliFlags = {
  /** Whether to include --dangerously-skip-permissions flag. */
  skipPermissions: boolean;
  /** Space-separated additional custom flags. */
  customFlags: string;
  /** Optional host (for Ollama). */
  host?: string;
  /** Optional port (for Ollama). */
  port?: string;
  /** Optional model name (for Ollama). */
  model?: string;
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
  /** Update the custom flags for a mode. */
  setCustomFlags: (mode: Exclude<AiMode, "Plain">, value: string) => void;
  /** Update the host for a mode. */
  setHost: (mode: Exclude<AiMode, "Plain">, value: string) => void;
  /** Update the port for a mode. */
  setPort: (mode: Exclude<AiMode, "Plain">, value: string) => void;
  /** Update the model for a mode. */
  setModel: (mode: Exclude<AiMode, "Plain">, value: string) => void;
  /** Reset all settings for a specific mode to defaults. */
  resetModeToDefaults: (mode: Exclude<AiMode, "Plain">) => void;
  /** Reset all settings to defaults. */
  resetAllToDefaults: () => void;
  /** Get the effective flags for a mode. */
  getFlags: (mode: Exclude<AiMode, "Plain">) => AiModeCliFlags;
};

// --- Default Settings ---

const DEFAULT_MODE_FLAGS: AiModeCliFlags = {
  skipPermissions: false,
  customFlags: "",
  host: "",
  port: "",
  model: "",
};

const DEFAULT_FLAGS: CliFlagsConfig = {
  Claude: { ...DEFAULT_MODE_FLAGS },
  Gemini: { ...DEFAULT_MODE_FLAGS },
  Codex: { ...DEFAULT_MODE_FLAGS },
  Ollama: { ...DEFAULT_MODE_FLAGS },
};

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

      setHost: (mode, value) => {
        set({
          flags: {
            ...get().flags,
            [mode]: {
              ...get().flags[mode],
              host: value,
            },
          },
        });
      },

      setPort: (mode, value) => {
        set({
          flags: {
            ...get().flags,
            [mode]: {
              ...get().flags[mode],
              port: value,
            },
          },
        });
      },

      setModel: (mode, value) => {
        set({
          flags: {
            ...get().flags,
            [mode]: {
              ...get().flags[mode],
              model: value,
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
            Ollama: { ...DEFAULT_MODE_FLAGS },
          },
        });
      },

      getFlags: (mode) => {
        return get().flags[mode] ?? DEFAULT_MODE_FLAGS;
      },
    }),
    {
      name: "maestro-cli-settings",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({ flags: state.flags }),
      version: 1,
    }
  )
);
