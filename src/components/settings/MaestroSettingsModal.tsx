import { invoke } from "@tauri-apps/api/core";
import {
  ArrowDownCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Terminal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useUpdateStore } from "@/stores/useUpdateStore";

interface MaestroSettingsModalProps {
  onClose: () => void;
}

/** Sentinel the backend returns when the user dismisses the admin auth prompt.
 *  Must match `CANCEL_SENTINEL` in `src-tauri/src/commands/cli.rs`. */
const CLI_CANCEL_SENTINEL = "CANCELLED_BY_USER";

type CliStatus = { kind: "ok" | "error"; message: string };

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

export function MaestroSettingsModal({ onClose }: MaestroSettingsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [endpointInput, setEndpointInput] = useState("");
  const [cliInstalled, setCliInstalled] = useState<boolean | null>(null);
  const [cliStatus, setCliStatus] = useState<CliStatus | null>(null);

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
    invoke<boolean>("is_cli_installed").then(setCliInstalled).catch(() => setCliInstalled(false));
  }, []);

  useEffect(() => {
    invoke<string>("get_app_version")
      .then(setAppVersion)
      .catch((err) => console.error("Failed to get app version:", err));
  }, []);

  useEffect(() => {
    setEndpointInput(customEndpoint ?? "");
  }, [customEndpoint]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleCheckNow = useCallback(() => {
    checkForUpdates();
  }, [checkForUpdates]);

  const handleEndpointBlur = () => {
    const trimmed = endpointInput.trim();
    setCustomEndpoint(trimmed || null);
  };

  const isChecking = status === "checking";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        ref={modalRef}
        className="w-full max-w-md rounded-lg border border-maestro-border bg-maestro-bg shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-maestro-border px-4 py-3">
          <h2 className="text-sm font-semibold text-maestro-text">Maestro Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-maestro-border/40"
          >
            <X size={16} className="text-maestro-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 p-4">
          {/* Version */}
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-maestro-muted">
              Version
            </div>
            <div className="flex items-center gap-2 px-1 text-xs">
              <Check size={12} className="shrink-0 text-maestro-green" />
              <span className="text-maestro-text font-medium">
                v{appVersion ?? "..."}
              </span>
            </div>
          </div>

          {/* Updates */}
          <div>
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

            <div className="space-y-1">
              {status === "checking" && (
                <div className="flex items-center gap-2 px-1 text-[11px] text-maestro-muted">
                  <Loader2 size={11} className="animate-spin" />
                  Checking...
                </div>
              )}
              <div className="flex items-center gap-2 px-1 text-[10px] text-maestro-muted">
                Last checked: {formatTimeAgo(lastCheckedAt)}
              </div>
            </div>

            {/* Auto-check toggle */}
            <div className="mt-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-maestro-text hover:bg-maestro-border/40">
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
          </div>

          {/* CLI Command */}
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-maestro-muted">
              <Terminal size={13} className="text-maestro-accent" />
              CLI Command
            </div>
            <div className="space-y-1.5 px-1">
              <p className="text-[11px] text-maestro-muted">
                Install the <code className="rounded bg-maestro-border/40 px-1 py-0.5 text-maestro-text">maestro</code> command to open projects from your terminal.
              </p>
              {cliStatus && (
                <div className={`text-[11px] ${cliStatus.kind === "error" ? "text-maestro-red" : "text-maestro-green"}`}>
                  {cliStatus.message}
                </div>
              )}
              <div className="flex items-center gap-2">
                {cliInstalled ? (
                  <>
                    <div className="flex items-center gap-1.5 text-[11px] text-maestro-green">
                      <Check size={11} />
                      Installed
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setCliStatus(null);
                        invoke("uninstall_cli")
                          .then(() => {
                            setCliInstalled(false);
                            setCliStatus({ kind: "ok", message: "CLI command removed" });
                          })
                          .catch((err) => {
                            const msg = String(err);
                            if (msg === CLI_CANCEL_SENTINEL) {
                              setCliStatus(null);
                              return;
                            }
                            setCliStatus({ kind: "error", message: `Error: ${msg}` });
                          });
                      }}
                      className="rounded px-2 py-0.5 text-[11px] text-maestro-red hover:bg-maestro-border/40"
                    >
                      Uninstall
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setCliStatus(null);
                      invoke<string>("install_cli")
                        .then((path) => {
                          setCliInstalled(true);
                          setCliStatus({ kind: "ok", message: `Installed to ${path}` });
                        })
                        .catch((err) => {
                          const msg = String(err);
                          if (msg === CLI_CANCEL_SENTINEL) {
                            setCliStatus(null);
                            return;
                          }
                          setCliStatus({ kind: "error", message: `Error: ${msg}` });
                        });
                    }}
                    className="rounded border border-maestro-accent/50 bg-maestro-accent/10 px-3 py-1 text-[11px] font-medium text-maestro-accent hover:bg-maestro-accent/20"
                  >
                    Install &apos;maestro&apos; command in PATH
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Advanced */}
          <div>
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
        </div>
      </div>
    </div>
  );
}
