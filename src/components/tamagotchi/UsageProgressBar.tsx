interface UsageProgressBarProps {
  percent: number;
  showLabel?: boolean;
}

/**
 * Get bar color based on weekly usage percentage.
 * More usage = happier colors (green for high usage).
 */
function getBarColor(percent: number): string {
  if (percent < 20) return "bg-maestro-red";
  if (percent < 40) return "bg-maestro-orange";
  if (percent < 60) return "bg-maestro-purple";
  if (percent < 80) return "bg-maestro-accent";
  return "bg-maestro-green";
}

/**
 * Horizontal progress bar for weekly usage display.
 */
export function UsageProgressBar({
  percent,
  showLabel = true,
}: UsageProgressBarProps) {
  const barColor = getBarColor(percent);

  return (
    <div className="w-full">
      <div className="h-1.5 overflow-hidden rounded-full bg-maestro-border/50">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
      {showLabel && (
        <div className="mt-0.5 flex justify-between text-[9px] text-maestro-muted">
          <span>{Math.round(percent)}% weekly</span>
        </div>
      )}
    </div>
  );
}
