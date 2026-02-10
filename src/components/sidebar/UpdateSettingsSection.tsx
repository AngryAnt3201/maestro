import { invoke } from "@tauri-apps/api/core";
import {
  ArrowDownCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useUpdateStore } from "@/stores/useUpdateStore";

const cardClass =
  "rounded-lg border border-maestro-border/60 bg-maestro-card p-3 shadow-[0_1px_4px_rgb(0_0_0/0.15),0_0_0_1px_rgb(255_255_255/0.03)_inset] transition-shadow hover:shadow-[0_2px_8px_rgb(0_0_0/0.25),0_0_0_1px_rgb(255_255_255/0.05)_inset]";

const INTERVAL_OPTIONS = [
  { label: "30 minutes", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "2 hours", value: 120 },
  { label: "6 hours", value: 360 },
  { label: "24 hours", value: 1440 },
];

function formatTimeAgo(timestamp: number | null): string {
  if (!timestamp) return "Never";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function UpdateSettingsSection() {
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [endpointInput, setEndpointInput] = useState("");

  const status = useUpdateStore((s) => s.status);
  const lastCheckedAt = useUpdateStore((s) => s.lastCheckedAt);
  const autoCheckEnabled = useUpdateStore((s) => s.autoCheckEnabled);
  const checkIntervalMinutes = useUpdateStore((s) => s.checkIntervalMinutes);
  const customEndpoint = useUpdateStore((s) => s.customEndpoint);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);
  const setAutoCheckEnabled = useUpdateStore((s) => s.setAutoCheckEnabled);
  const setCheckInterval = useUpdateStore((s) => s.setCheckInterval);
  const setCustomEndpoint = useUpdateStore((s) => s.setCustomEndpoint);

  useEffect(() => {
    invoke<string>("get_app_version")
      .then(setAppVersion)
      .catch((err) => console.error("Failed to get app version:", err));
  }, []);

  // Sync endpoint input with store value
  useEffect(() => {
    setEndpointInput(customEndpoint ?? "");
  }, [customEndpoint]);

  const handleCheckNow = useCallback(() => {
    checkForUpdates();
  }, [checkForUpdates]);

  const handleEndpointBlur = () => {
    const trimmed = endpointInput.trim();
    setCustomEndpoint(trimmed || null);
  };

  const isChecking = status === "checking";

  return (
    <div className={cardClass}>
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-maestro-muted">
        <ArrowDownCircle size={13} className="text-maestro-green" />
        <span className="flex-1">Updates</span>
        <button
          type="button"
          onClick={handleCheckNow}
          disabled={isChecking}
          className="rounded p-0.5 hover:bg-maestro-border/40"
          title="Check for updates"
        >
          <RefreshCw
            size={12}
            className={`text-maestro-muted ${isChecking ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      {/* Version and last checked */}
      <div className="space-y-1 mb-2">
        <div className="flex items-center gap-2 px-1 text-xs">
          <Check size={12} className="shrink-0 text-maestro-green" />
          <span className="text-maestro-text font-medium">
            v{appVersion ?? "..."}
          </span>
          <span className="flex-1" />
          <span className="text-[10px] text-maestro-muted">
            {formatTimeAgo(lastCheckedAt)}
          </span>
        </div>
        {status === "checking" && (
          <div className="flex items-center gap-2 px-1 text-[11px] text-maestro-muted">
            <Loader2 size={11} className="animate-spin" />
            Checking...
          </div>
        )}
      </div>

      {/* Auto-check toggle */}
      <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-maestro-text hover:bg-maestro-border/40">
        <span className="flex-1">Auto-check</span>
        <button
          type="button"
          onClick={() => setAutoCheckEnabled(!autoCheckEnabled)}
          className={`relative h-4 w-7 rounded-full transition-colors ${
            autoCheckEnabled ? "bg-maestro-accent" : "bg-maestro-border"
          }`}
          aria-label="Toggle auto-check"
        >
          <span
            className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
              autoCheckEnabled ? "left-3.5" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {/* Interval dropdown */}
      {autoCheckEnabled && (
        <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-maestro-text">
          <span className="flex-1 text-maestro-muted">Interval</span>
          <select
            value={checkIntervalMinutes}
            onChange={(e) => setCheckInterval(Number(e.target.value))}
            className="rounded border border-maestro-border bg-maestro-surface px-1.5 py-0.5 text-[11px] text-maestro-text outline-none"
          >
            {INTERVAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Advanced section */}
      <button
        type="button"
        onClick={() => setAdvancedOpen(!advancedOpen)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-maestro-muted hover:bg-maestro-border/40 hover:text-maestro-text"
      >
        {advancedOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        Advanced
      </button>

      {advancedOpen && (
        <div className="px-2 py-1.5 space-y-1.5">
          <label className="block text-[10px] text-maestro-muted uppercase tracking-wide">
            Custom endpoint
          </label>
          <input
            type="text"
            value={endpointInput}
            onChange={(e) => setEndpointInput(e.target.value)}
            onBlur={handleEndpointBlur}
            placeholder="https://..."
            className="w-full rounded border border-maestro-border bg-maestro-surface px-2 py-1 text-[11px] text-maestro-text placeholder-maestro-muted/50 outline-none focus:border-maestro-accent"
          />
          {customEndpoint && (
            <button
              type="button"
              onClick={() => {
                setCustomEndpoint(null);
                setEndpointInput("");
              }}
              className="text-[10px] text-maestro-red hover:underline"
            >
              Reset to default
            </button>
          )}
        </div>
      )}
    </div>
  );
}
