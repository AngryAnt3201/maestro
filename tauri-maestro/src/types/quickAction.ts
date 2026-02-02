/**
 * Types and constants for quick action buttons in the terminal toolbar.
 */

/** A custom quick action that appears in the terminal footer bar */
export interface QuickAction {
  id: string; // UUID
  name: string; // Button label
  icon: string; // Lucide icon name (e.g., "Play")
  colorHex: string; // Hex color (e.g., "#34C759")
  prompt: string; // Prompt sent to Claude
  isEnabled: boolean;
  sortOrder: number;
  createdAt: string; // ISO date
}

/** Available icon names for quick actions (Lucide icon names) */
export const QUICK_ACTION_ICONS = [
  "Star",
  "Zap",
  "Wand2",
  "Sparkles",
  "Play",
  "RefreshCw",
  "CheckCircle",
  "XCircle",
  "FileText",
  "Folder",
  "Trash2",
  "Pencil",
  "Settings",
  "Wrench",
  "Hammer",
  "Scissors",
  "Flag",
  "Bookmark",
  "Tag",
  "Heart",
  "Bell",
  "Mail",
  "Send",
  "MessageSquare",
  "Terminal",
  "Code",
  "Braces",
  "Binary",
  "ArrowUpCircle",
  "GitBranch",
  "GitCommit",
  "Bug",
] as const;

export type QuickActionIconName = (typeof QUICK_ACTION_ICONS)[number];

/** Available colors for quick actions */
export const QUICK_ACTION_COLORS = [
  { name: "green", hex: "#34C759" },
  { name: "blue", hex: "#007AFF" },
  { name: "orange", hex: "#FF9500" },
  { name: "purple", hex: "#AF52DE" },
  { name: "pink", hex: "#FF2D55" },
  { name: "red", hex: "#FF3B30" },
  { name: "yellow", hex: "#FFCC00" },
  { name: "teal", hex: "#5AC8FA" },
  { name: "cyan", hex: "#32ADE6" },
  { name: "indigo", hex: "#5856D6" },
  { name: "mint", hex: "#00C7BE" },
  { name: "gray", hex: "#8E8E93" },
] as const;

export type QuickActionColorName = (typeof QUICK_ACTION_COLORS)[number]["name"];
