import { invoke } from "@tauri-apps/api/core";

/** Usage data from Anthropic's OAuth API. */
export interface UsageData {
  /** Session (5-hour window) usage percentage (0-100). */
  sessionPercent: number;
  /** When the session window resets (ISO 8601). */
  sessionResetsAt: string | null;
  /** Weekly (7-day window) usage percentage for all models (0-100). */
  weeklyPercent: number;
  /** When the weekly window resets (ISO 8601). */
  weeklyResetsAt: string | null;
  /** Weekly Opus-specific usage percentage (0-100). */
  weeklyOpusPercent: number;
  /** When the weekly Opus window resets (ISO 8601). */
  weeklyOpusResetsAt: string | null;
  /** Error message if token is expired or unavailable. */
  errorMessage: string | null;
  /** Whether token needs refresh (user should run `claude` to refresh). */
  needsAuth: boolean;
}

/** Fetch Claude Code usage from Anthropic's OAuth API via Tauri. */
export async function getClaudeUsage(): Promise<UsageData> {
  return invoke<UsageData>("get_claude_usage");
}

/**
 * Tamagotchi mood based on usage level.
 * More usage = happier pet (like feeding a tamagotchi).
 */
export type TamagotchiMood =
  | "hungry"   // <20% - needs more usage!
  | "bored"    // <40% - could use more activity
  | "content"  // <60% - doing okay
  | "happy"    // <80% - well fed
  | "ecstatic" // >=80% - thriving!
  | "sleeping"; // needs auth - dormant state

/**
 * Determine mood based on weekly usage percentage.
 * More usage = happier tamagotchi.
 */
export function getMood(weeklyPercent: number, needsAuth: boolean): TamagotchiMood {
  if (needsAuth) return "sleeping";
  if (weeklyPercent < 20) return "hungry";
  if (weeklyPercent < 40) return "bored";
  if (weeklyPercent < 60) return "content";
  if (weeklyPercent < 80) return "happy";
  return "ecstatic";
}

/**
 * Get a friendly description for each mood.
 */
export function getMoodDescription(mood: TamagotchiMood): string {
  switch (mood) {
    case "sleeping":
      return "Zzz... Run `claude` to wake me!";
    case "hungry":
      return "I'm hungry! Use Claude more!";
    case "bored":
      return "Could use some coding...";
    case "content":
      return "Doing okay today!";
    case "happy":
      return "Well fed and happy!";
    case "ecstatic":
      return "I'm thriving! Keep it up!";
  }
}

/**
 * Format a reset time for display.
 * Shows relative time like "in 2h 30m" or "in 3d".
 */
export function formatResetTime(isoDate: string | null): string {
  if (!isoDate) return "";

  try {
    const resetDate = new Date(isoDate);
    const now = new Date();
    const diffMs = resetDate.getTime() - now.getTime();

    if (diffMs <= 0) return "now";

    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays > 0) {
      const remainingHours = diffHours % 24;
      return remainingHours > 0
        ? `in ${diffDays}d ${remainingHours}h`
        : `in ${diffDays}d`;
    }

    if (diffHours > 0) {
      const remainingMins = diffMins % 60;
      return remainingMins > 0
        ? `in ${diffHours}h ${remainingMins}m`
        : `in ${diffHours}h`;
    }

    return `in ${diffMins}m`;
  } catch {
    return "";
  }
}
