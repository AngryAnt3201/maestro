import { create } from "zustand";
import {
  getClaudeUsage,
  getMood,
  type UsageData,
  type TamagotchiMood,
} from "@/lib/usageParser";

/** Default polling interval for usage updates (60 seconds). */
const POLL_INTERVAL_MS = 60_000;

/** Max polling interval after repeated errors (5 minutes). */
const MAX_POLL_INTERVAL_MS = 300_000;

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

/** Tracks the single active polling timeout across all component mounts. */
let globalTimeoutId: ReturnType<typeof setTimeout> | null = null;
/** Number of components currently subscribed to polling. */
let pollingRefCount = 0;
/** Consecutive error count for backoff. */
let consecutiveErrors = 0;

/**
 * Zustand store for Claude Code usage tracking.
 * Powers the tamagotchi widget in the sidebar footer.
 *
 * Polling is ref-counted: multiple mounts share one interval,
 * and it is cleared only when the last subscriber unmounts.
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
    // Skip if a fetch is already in-flight
    if (get().isLoading) return;

    set({ isLoading: true, error: null });

    try {
      const usage = await getClaudeUsage();
      const needsAuth = usage.needsAuth;
      const mood = getMood(usage.weeklyPercent, needsAuth);

      const hasError = !needsAuth && !!usage.errorMessage;
      if (hasError) {
        consecutiveErrors++;
      } else {
        consecutiveErrors = 0;
      }

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
      consecutiveErrors++;
      set({
        error: String(err),
        isLoading: false,
      });
    }
  },

  startPolling: () => {
    pollingRefCount++;

    // If this is the first subscriber, start the global interval
    if (pollingRefCount === 1) {
      // Initial fetch
      get().fetchUsage();

      const scheduleNext = () => {
        // Exponential backoff: double the interval for each consecutive error, up to max
        const backoffMs = consecutiveErrors > 0
          ? Math.min(POLL_INTERVAL_MS * Math.pow(2, consecutiveErrors), MAX_POLL_INTERVAL_MS)
          : POLL_INTERVAL_MS;

        globalTimeoutId = setTimeout(() => {
          get().fetchUsage();
          scheduleNext();
        }, backoffMs);
      };

      scheduleNext();
    }

    // Return cleanup: decrement ref count, clear interval if last subscriber
    return () => {
      pollingRefCount = Math.max(0, pollingRefCount - 1);
      if (pollingRefCount === 0 && globalTimeoutId) {
        clearTimeout(globalTimeoutId);
        globalTimeoutId = null;
        consecutiveErrors = 0;
      }
    };
  },

  toggleCharacter: () => {
    set((state) => ({ showCharacter: !state.showCharacter }));
  },
}));
