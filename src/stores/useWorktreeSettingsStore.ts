import { LazyStore } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

/** What to do with a session's worktree when the session is closed. */
export type WorktreeCloseAction = "keep" | "delete" | "ask";

type WorktreeSettingsState = {
  worktreeCloseAction: WorktreeCloseAction;
  setWorktreeCloseAction: (action: WorktreeCloseAction) => void;
};

const lazyStore = new LazyStore("worktree-settings.json");

const tauriStorage: StateStorage = {
  getItem: async (name) => {
    try {
      return (await lazyStore.get<string>(name)) ?? null;
    } catch {
      return null;
    }
  },
  setItem: async (name, value) => {
    await lazyStore.set(name, value);
    await lazyStore.save();
  },
  removeItem: async (name) => {
    await lazyStore.delete(name);
    await lazyStore.save();
  },
};

export const useWorktreeSettingsStore = create<WorktreeSettingsState>()(
  persist(
    (set) => ({
      worktreeCloseAction: "keep",
      setWorktreeCloseAction: (action) => set({ worktreeCloseAction: action }),
    }),
    {
      name: "maestro-worktree-settings",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({ worktreeCloseAction: state.worktreeCloseAction }),
    },
  ),
);
