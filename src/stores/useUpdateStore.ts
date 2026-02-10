import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { LazyStore } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

// --- Types ---

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "installing" | "error";

export interface UpdateInfo {
  available: boolean;
  current_version: string;
  latest_version: string;
  release_notes: string | null;
  date: string | null;
}

interface DownloadProgress {
  chunk_length: number;
  content_length: number | null;
}

/** Persisted settings. */
type UpdateSettings = {
  autoCheckEnabled: boolean;
  checkIntervalMinutes: number;
  dismissedVersion: string | null;
  customEndpoint: string | null;
};

/** Full store state: persisted settings + transient runtime state. */
type UpdateState = UpdateSettings & {
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  downloadProgress: number | null;
  error: string | null;
  lastCheckedAt: number | null;
};

/** Store actions. */
type UpdateActions = {
  checkForUpdates: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  dismissUpdate: () => void;
  setAutoCheckEnabled: (enabled: boolean) => void;
  setCheckInterval: (minutes: number) => void;
  setCustomEndpoint: (url: string | null) => void;
  initListeners: () => Promise<UnlistenFn>;
};

// --- Tauri LazyStore-backed StateStorage adapter ---

const lazyStore = new LazyStore("update-settings.json");

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

export const useUpdateStore = create<UpdateState & UpdateActions>()(
  persist(
    (set, get) => ({
      // Persisted settings
      autoCheckEnabled: true,
      checkIntervalMinutes: 60,
      dismissedVersion: null,
      customEndpoint: null,

      // Transient state
      status: "idle",
      updateInfo: null,
      downloadProgress: null,
      error: null,
      lastCheckedAt: null,

      checkForUpdates: async () => {
        const { status, customEndpoint } = get();
        if (status === "checking" || status === "downloading" || status === "installing") return;

        set({ status: "checking", error: null });
        try {
          const info = await invoke<UpdateInfo>("check_for_updates", {
            customEndpoint: customEndpoint || null,
          });
          set({
            status: info.available ? "available" : "idle",
            updateInfo: info,
            lastCheckedAt: Date.now(),
          });
        } catch (err) {
          set({
            status: "error",
            error: err instanceof Error ? err.message : String(err),
            lastCheckedAt: Date.now(),
          });
        }
      },

      downloadAndInstall: async () => {
        const { status, customEndpoint } = get();
        if (status !== "available") return;

        set({ status: "downloading", downloadProgress: 0, error: null });
        try {
          await invoke("download_and_install_update", {
            customEndpoint: customEndpoint || null,
          });
          // The Rust side emits events tracked by initListeners
        } catch (err) {
          set({
            status: "error",
            error: err instanceof Error ? err.message : String(err),
            downloadProgress: null,
          });
        }
      },

      dismissUpdate: () => {
        const { updateInfo } = get();
        set({
          status: "idle",
          dismissedVersion: updateInfo?.latest_version ?? null,
        });
      },

      setAutoCheckEnabled: (enabled) => set({ autoCheckEnabled: enabled }),
      setCheckInterval: (minutes) => set({ checkIntervalMinutes: minutes }),
      setCustomEndpoint: (url) => set({ customEndpoint: url }),

      initListeners: async () => {
        let bytesReceived = 0;

        const unlistenProgress = await listen<DownloadProgress>(
          "update-download-progress",
          (event) => {
            bytesReceived += event.payload.chunk_length;
            const total = event.payload.content_length;
            const progress = total ? Math.min(100, Math.round((bytesReceived / total) * 100)) : null;
            set({ downloadProgress: progress });
          },
        );

        const unlistenInstalling = await listen("update-installing", () => {
          set({ status: "installing", downloadProgress: 100 });
        });

        return () => {
          unlistenProgress();
          unlistenInstalling();
        };
      },
    }),
    {
      name: "maestro-update-settings",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({
        autoCheckEnabled: state.autoCheckEnabled,
        checkIntervalMinutes: state.checkIntervalMinutes,
        dismissedVersion: state.dismissedVersion,
        customEndpoint: state.customEndpoint,
      }),
      version: 1,
    },
  ),
);
