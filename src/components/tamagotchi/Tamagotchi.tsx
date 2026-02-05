import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useUsageStore } from "@/stores/useUsageStore";
import { formatResetTime } from "@/lib/usageParser";
import { TamagotchiCharacter } from "./TamagotchiCharacter";

/**
 * Tamagotchi widget that displays Claude Code rate limit usage.
 * Character visibility is controlled via Appearance settings.
 * Click label to toggle between daily and weekly.
 */
export function Tamagotchi() {
  const { usage, mood, isLoading, error, needsAuth, fetchUsage, startPolling, showCharacter } =
    useUsageStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(100);
  const [showWeekly, setShowWeekly] = useState(false);

  // Start polling on mount
  useEffect(() => {
    const cleanup = startPolling();
    return cleanup;
  }, [startPolling]);

  // Resize observer to scale with sidebar width
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        // Scale size to fill container width (smaller max)
        setSize(Math.max(80, Math.min(width - 24, 160)));
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const sessionPercent = usage?.sessionPercent ?? 0;
  const weeklyPercent = usage?.weeklyPercent ?? 0;
  const sessionResetTime = formatResetTime(usage?.sessionResetsAt ?? null);
  const weeklyResetTime = formatResetTime(usage?.weeklyResetsAt ?? null);

  const currentPercent = showWeekly ? weeklyPercent : sessionPercent;
  const currentResetTime = showWeekly ? weeklyResetTime : sessionResetTime;
  const currentLabel = showWeekly ? "Weekly" : "Daily";
  const currentColor = showWeekly ? "bg-maestro-green" : "bg-maestro-accent";

  return (
    <div
      ref={containerRef}
      className="shrink-0 border-t border-maestro-border/60 bg-maestro-surface px-2 py-1.5"
    >
      {showCharacter ? (
        /* Character view with overlaid bar */
        <div className="relative flex justify-center items-center">
          <TamagotchiCharacter mood={mood} size={size} />

          {/* Single overlaid usage bar */}
          {!needsAuth && (
            <div
              className="absolute left-0 right-0 px-3"
              style={{ bottom: size * 0.06 }}
            >
              <div className="h-2.5 overflow-hidden rounded-full bg-maestro-border/60">
                <div
                  className={`h-full rounded-full ${currentColor} transition-all duration-500`}
                  style={{ width: `${Math.min(100, currentPercent)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Bars-only view */
        !needsAuth && (
          <div className="py-1">
            <div className="h-2.5 overflow-hidden rounded-full bg-maestro-border/60">
              <div
                className={`h-full rounded-full ${currentColor} transition-all duration-500`}
                style={{ width: `${Math.min(100, currentPercent)}%` }}
              />
            </div>
          </div>
        )
      )}

      {/* Stats row */}
      <div className="flex items-center justify-between mt-1">
        <div className="flex-1 min-w-0">
          {needsAuth ? (
            <div className="text-[9px] text-maestro-muted">
              Run <code className="rounded bg-maestro-border/50 px-1 py-0.5 font-mono">claude</code> to wake
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowWeekly(!showWeekly)}
              className="flex items-center gap-1.5 text-[9px] text-maestro-muted hover:text-maestro-text transition-colors"
              title={currentResetTime ? `Resets ${currentResetTime}. Click to toggle.` : "Click to toggle daily/weekly"}
            >
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${currentColor}`} />
              <span>{currentLabel}: {Math.round(currentPercent)}%</span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={fetchUsage}
          disabled={isLoading}
          className="rounded p-0.5 hover:bg-maestro-border/40 shrink-0"
          title="Refresh usage"
        >
          <RefreshCw
            size={10}
            className={`text-maestro-muted ${isLoading ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      {error && (
        <div className="mt-1 truncate text-[9px] text-maestro-red text-center">{error}</div>
      )}
    </div>
  );
}
