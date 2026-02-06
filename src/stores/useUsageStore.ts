import { create } from "zustand";
import {
  getClaudeUsage,
  getMood,
  type UsageData,
  type TamagotchiMood,
} from "@/lib/usageParser";

/** Polling interval for usage updates (60 seconds). */
const POLL_INTERVAL_MS = 60_000;

interface UsageState {
  /** Raw usage data from backend. */
  usage: UsageData | null;
  /** Current tamagotchi mood based on weekly usage. */
  mood: TamagotchiMood;
  /** Whether a fetch is in progress. */
  isLoading: boolean;
  /** Last error message, if any. */
  error: string | null;
  /** Timestamp of last successful fetch. */
  lastFetch: Date | null;
  /** Whether authentication is needed. */
  needsAuth: boolean;
  /** Whether to show the tamagotchi character (vs bars only). */
  showCharacter: boolean;

  // Actions
  /** Fetch usage data from backend. */
  fetchUsage: () => Promise<void>;
  /** Start polling for usage updates. Returns cleanup function. */
  startPolling: () => () => void;
  /** Toggle character visibility. */
  toggleCharacter: () => void;
}

/**
 * Zustand store for Claude Code usage tracking.
 * Powers the tamagotchi widget in the sidebar footer.
 */
export const useUsageStore = create<UsageState>()((set, get) => ({
  usage: null,
  mood: "sleeping",
  isLoading: false,
  error: null,
  lastFetch: null,
  needsAuth: false,
  showCharacter: true,

  fetchUsage: async () => {
    set({ isLoading: true, error: null });

    try {
      const usage = await getClaudeUsage();
      const needsAuth = usage.needsAuth;
      const mood = getMood(usage.weeklyPercent, needsAuth);

      set({
        usage,
        mood,
        needsAuth,
        isLoading: false,
        lastFetch: new Date(),
        // Only show error if it's not an auth error (those are handled via needsAuth)
        error: needsAuth ? null : usage.errorMessage,
      });
    } catch (err) {
      console.error("Failed to fetch Claude usage:", err);
      set({
        error: String(err),
        isLoading: false,
      });
    }
  },

  startPolling: () => {
    // Initial fetch
    get().fetchUsage();

    // Set up interval for periodic updates
    const intervalId = setInterval(() => {
      get().fetchUsage();
    }, POLL_INTERVAL_MS);

    // Return cleanup function
    return () => clearInterval(intervalId);
  },

  toggleCharacter: () => {
    set((state) => ({ showCharacter: !state.showCharacter }));
  },
}));
