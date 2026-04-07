import { LazyStore } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

// --- Defaults ---

const DEFAULT_SIDEBAR_WIDTH = 240;
const DEFAULT_RIGHT_PANEL_WIDTH = 308;

// --- Tauri storage adapter ---

const lazyStore = new LazyStore("layout.json");

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

// --- Types ---

type LayoutState = {
  sidebarWidth: number;
  rightPanelWidth: number;
  rightPanelOpen: boolean;
};

type LayoutActions = {
  setSidebarWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  setRightPanelOpen: (open: boolean) => void;
  toggleRightPanel: () => void;
};

// --- Store ---

export const useLayoutStore = create<LayoutState & LayoutActions>()(
  persist(
    (set, get) => ({
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      rightPanelWidth: DEFAULT_RIGHT_PANEL_WIDTH,
      rightPanelOpen: true,

      setSidebarWidth: (width) => set({ sidebarWidth: width }),

      setRightPanelWidth: (width) => set({ rightPanelWidth: width }),

      setRightPanelOpen: (open) => set({ rightPanelOpen: open }),

      toggleRightPanel: () => set({ rightPanelOpen: !get().rightPanelOpen }),
    }),
    {
      name: "maestro-layout",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({
        sidebarWidth: state.sidebarWidth,
        rightPanelWidth: state.rightPanelWidth,
        rightPanelOpen: state.rightPanelOpen,
      }),
    },
  ),
);
