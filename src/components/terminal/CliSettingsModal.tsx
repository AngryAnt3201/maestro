import { AlertTriangle, Bot, ChevronDown, Globe, Hash, RotateCcw, Search, Terminal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCliSettingsStore } from "@/stores/useCliSettingsStore";
import { AI_CLI_CONFIG, buildCliCommand, type CliAiMode } from "@/lib/terminal";
import { fetchInstalledModels, type OllamaModel } from "@/lib/ollama";

interface CliSettingsModalProps {
  onClose: () => void;
}

/** The AI modes that support CLI flags. */
const CLI_MODES: CliAiMode[] = ["Claude", "Gemini", "Codex", "Ollama"];

/** Mode display configuration */
const MODE_CONFIG: Record<CliAiMode, { color: string; bgColor: string; skipFlagName: string | null }> = {
  Claude: {
    color: "text-maestro-orange",
    bgColor: "bg-maestro-orange/20",
    skipFlagName: "--dangerously-skip-permissions",
  },
  Gemini: {
    color: "text-maestro-accent",
    bgColor: "bg-maestro-accent/20",
    skipFlagName: "--yolo",
  },
  Codex: {
    color: "text-maestro-green",
    bgColor: "bg-maestro-green/20",
    skipFlagName: "--dangerously-bypass-approvals-and-sandbox",
  },
  Ollama: {
    color: "text-blue-500",
    bgColor: "bg-blue-500/20",
    skipFlagName: null,
  },
};

/**
 * Modal for managing CLI settings for each AI mode.
 * Allows configuring flags like --dangerously-skip-permissions and custom flags.
 */
export function CliSettingsModal({ onClose }: CliSettingsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [activeMode, setActiveMode] = useState<CliAiMode>("Claude");
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [isLoadingOllama, setIsLoadingOllama] = useState(false);
  const [ollamaDropdownOpen, setOllamaDropdownOpen] = useState(false);
  const [ollamaSearchQuery, setOllamaSearchQuery] = useState("");
  const ollamaDropdownRef = useRef<HTMLDivElement>(null);

  const {
    flags,
    setSkipPermissions,
    setCustomFlags,
    setHost,
    setPort,
    setModel,
    resetModeToDefaults,
    resetAllToDefaults,
  } = useCliSettingsStore();

  // Fetch Ollama models when tab is active
  useEffect(() => {
    if (activeMode === "Ollama") {
      setIsLoadingOllama(true);
      fetchInstalledModels()
        .then(setOllamaModels)
        .finally(() => setIsLoadingOllama(false));
    }
  }, [activeMode]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
      if (ollamaDropdownRef.current && !ollamaDropdownRef.current.contains(e.target as Node)) {
        setOllamaDropdownOpen(false);
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

  const currentFlags = flags[activeMode];
  const previewCommand = buildCliCommand(activeMode, currentFlags);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        ref={modalRef}
        className="w-full max-w-lg rounded-lg border border-maestro-border bg-maestro-bg shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-maestro-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Terminal size={16} className="text-maestro-accent" />
            <h2 className="text-sm font-semibold text-maestro-text">CLI Settings</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-maestro-border/40"
          >
            <X size={16} className="text-maestro-muted" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex border-b border-maestro-border">
          {CLI_MODES.map((mode) => {
            const config = MODE_CONFIG[mode];
            const isActive = activeMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setActiveMode(mode)}
                className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${
                  isActive
                    ? `${config.bgColor} ${config.color} border-b-2 border-current`
                    : "text-maestro-muted hover:text-maestro-text hover:bg-maestro-border/20"
                }`}
              >
                {mode}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="space-y-4 p-4">
          {/* Skip Permissions Toggle - only show if mode supports it */}
          {MODE_CONFIG[activeMode].skipFlagName && (
            <section>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-maestro-muted">
                  Permissions
                </h3>
                <span className="rounded bg-maestro-red/20 px-1.5 py-0.5 text-[10px] font-medium text-maestro-red">
                  Security
                </span>
              </div>
              <div className="rounded-lg border border-maestro-border bg-maestro-card p-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={currentFlags.skipPermissions}
                    onChange={(e) => setSkipPermissions(activeMode, e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-maestro-border accent-maestro-accent"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-maestro-text">
                        Skip Permission Prompts
                      </span>
                      {currentFlags.skipPermissions && (
                        <span className="flex items-center gap-1 rounded bg-maestro-red/20 px-1.5 py-0.5 text-[10px] font-medium text-maestro-red">
                          <AlertTriangle size={10} />
                          Risk
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-maestro-muted">
                      Adds <code className="rounded bg-maestro-border/40 px-1">{MODE_CONFIG[activeMode].skipFlagName}</code> flag.
                      The CLI will not ask for confirmation before running commands.
                    </p>
                  </div>
                </label>
              </div>
            </section>
          )}

          {/* Connection Settings (for Ollama) */}
          {activeMode === "Ollama" && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-maestro-muted">
                Ollama Settings
              </h3>
              <div className="space-y-3 rounded-lg border border-maestro-border bg-maestro-card p-3">
                {/* Model Dropdown */}
                <div className="relative" ref={ollamaDropdownRef}>
                  <label className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-maestro-muted">
                    <Terminal size={10} />
                    DEFAULT MODEL
                  </label>
                  <button
                    type="button"
                    onClick={() => setOllamaDropdownOpen(!ollamaDropdownOpen)}
                    disabled={isLoadingOllama}
                    className="flex w-full items-center justify-between gap-2 rounded border border-maestro-border bg-maestro-bg px-3 py-1.5 text-left text-sm text-maestro-text transition-colors hover:border-maestro-accent/50 disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2">
                      <Bot size={14} className="text-blue-500" />
                      <span>{isLoadingOllama ? "Loading models..." : currentFlags.model || "Select a model"}</span>
                    </div>
                    <ChevronDown size={14} className="text-maestro-muted" />
                  </button>

                  {ollamaDropdownOpen && (
                    <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded border border-maestro-border bg-maestro-card shadow-lg">
                      <div className="border-b border-maestro-border p-2">
                        <div className="relative">
                          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-maestro-muted" />
                          <input
                            type="text"
                            placeholder="Search models..."
                            value={ollamaSearchQuery}
                            onChange={(e) => setOllamaSearchQuery(e.target.value)}
                            className="w-full rounded border border-maestro-border bg-maestro-surface py-1 px-7 text-xs text-maestro-text focus:outline-none"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {ollamaModels
                          .filter(m => m.name.toLowerCase().includes(ollamaSearchQuery.toLowerCase()))
                          .map((model) => (
                            <button
                              key={model.digest}
                              type="button"
                              onClick={() => {
                                setModel(activeMode, model.name);
                                setOllamaDropdownOpen(false);
                                setOllamaSearchQuery("");
                              }}
                              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-maestro-surface ${
                                currentFlags.model === model.name ? "bg-maestro-accent/10" : ""
                              }`}
                            >
                              <Bot size={12} className="text-blue-500" />
                              <span>{model.name}</span>
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Host & Port */}
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-maestro-muted">
                      <Globe size={10} />
                      HOST
                    </label>
                    <input
                      type="text"
                      value={currentFlags.host ?? ""}
                      onChange={(e) => setHost(activeMode, e.target.value)}
                      placeholder="e.g., localhost"
                      className="w-full rounded border border-maestro-border bg-maestro-bg px-3 py-1.5 text-sm text-maestro-text placeholder:text-maestro-muted/50 focus:border-maestro-accent focus:outline-none"
                    />
                  </div>
                  <div className="w-24">
                    <label className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-maestro-muted">
                      <Hash size={10} />
                      PORT
                    </label>
                    <input
                      type="text"
                      value={currentFlags.port ?? ""}
                      onChange={(e) => setPort(activeMode, e.target.value)}
                      placeholder="e.g., 11434"
                      className="w-full rounded border border-maestro-border bg-maestro-bg px-3 py-1.5 text-sm text-maestro-text placeholder:text-maestro-muted/50 focus:border-maestro-accent focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Custom Flags */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-maestro-muted">
              Custom Flags
            </h3>
            <div className="rounded-lg border border-maestro-border bg-maestro-card p-3">
              <input
                type="text"
                value={currentFlags.customFlags}
                onChange={(e) => setCustomFlags(activeMode, e.target.value)}
                placeholder="e.g., --verbose"
                className="w-full rounded border border-maestro-border bg-maestro-bg px-3 py-2 text-sm text-maestro-text placeholder:text-maestro-muted/50 focus:border-maestro-accent focus:outline-none"
              />
              <p className="mt-2 text-xs text-maestro-muted">
                Additional flags to pass to the {activeMode} CLI. Separate multiple flags with spaces.
              </p>
            </div>
          </section>

          {/* Command Preview */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-maestro-muted">
              Command Preview
            </h3>
            <div className="rounded-lg border border-maestro-border bg-maestro-card p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-maestro-muted">$</span>
                <code className="flex-1 font-mono text-sm text-maestro-text">
                  {previewCommand ?? AI_CLI_CONFIG[activeMode].command}
                </code>
              </div>
            </div>
          </section>

          {/* Actions */}
          <div className="flex items-center justify-between border-t border-maestro-border pt-4">
            <button
              type="button"
              onClick={resetAllToDefaults}
              className="flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium text-maestro-muted hover:bg-maestro-border/40 hover:text-maestro-text"
            >
              <RotateCcw size={12} />
              Reset All
            </button>
            <button
              type="button"
              onClick={() => resetModeToDefaults(activeMode)}
              className="flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium text-maestro-muted hover:bg-maestro-border/40 hover:text-maestro-text"
            >
              <RotateCcw size={12} />
              Reset {activeMode}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
