import { Loader2, RefreshCw, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { clearFontCache, EMBEDDED_FONT } from "@/lib/fonts";
import { useTerminalSettingsStore } from "@/stores/useTerminalSettingsStore";

interface TerminalSettingsModalProps {
  onClose: () => void;
}

/**
 * Modal for managing terminal display settings:
 * - Font family selection (with detected system fonts)
 * - Font size adjustment
 * - Line height adjustment
 */
export function TerminalSettingsModal({ onClose }: TerminalSettingsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const {
    settings,
    availableFonts,
    isLoading,
    isInitialized,
    initialize,
    setSetting,
    resetToDefaults,
    setZoomLevel,
    getEffectiveFontSize,
  } = useTerminalSettingsStore();

  const [isRefreshing, setIsRefreshing] = useState(false);

  // Initialize settings store on mount
  useEffect(() => {
    if (!isInitialized) {
      initialize();
    }
  }, [isInitialized, initialize]);

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

  const handleRefreshFonts = async () => {
    setIsRefreshing(true);
    clearFontCache();
    await initialize();
    setIsRefreshing(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        ref={modalRef}
        className="w-full max-w-md rounded-lg border border-maestro-border bg-maestro-bg shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-maestro-border px-4 py-3">
          <h2 className="text-sm font-semibold text-maestro-text">Terminal Settings</h2>
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
          {isLoading && !isInitialized ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-maestro-muted" />
            </div>
          ) : (
            <>
              {/* Font Family Section */}
              <FontFamilySection
                availableFonts={availableFonts}
                selectedFont={settings.fontFamily}
                onSelect={(font) => setSetting("fontFamily", font)}
                onRefresh={handleRefreshFonts}
                isRefreshing={isRefreshing}
              />

              {/* Font Size Section */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-maestro-muted">
                  Font Size
                </h3>
                <div className="rounded-lg border border-maestro-border bg-maestro-card p-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={10}
                      max={20}
                      step={1}
                      value={settings.fontSize}
                      onChange={(e) => setSetting("fontSize", Number(e.target.value))}
                      className="flex-1 accent-maestro-accent"
                    />
                    <span className="w-16 text-right text-xs font-medium text-maestro-text">
                      {settings.zoomLevel !== 100
                        ? `${settings.fontSize}px @ ${settings.zoomLevel}% = ${getEffectiveFontSize()}px`
                        : `${settings.fontSize}px`}
                    </span>
                  </div>
                </div>
              </section>

              {/* Zoom Level Section */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-maestro-muted">
                  Zoom Level
                </h3>
                <div className="rounded-lg border border-maestro-border bg-maestro-card p-3">
                  <div className="flex flex-wrap gap-1.5">
                    {[50, 75, 100, 125, 150, 200].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setZoomLevel(preset)}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                          settings.zoomLevel === preset
                            ? "bg-maestro-accent text-white"
                            : "bg-maestro-bg text-maestro-muted hover:bg-maestro-border/40 hover:text-maestro-text"
                        }`}
                      >
                        {preset}%
                      </button>
                    ))}
                  </div>
                  {settings.zoomLevel !== 100 && (
                    <p className="mt-2 text-[10px] text-maestro-muted">
                      Effective font size: {getEffectiveFontSize()}px
                    </p>
                  )}
                </div>
              </section>

              {/* Line Height Section */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-maestro-muted">
                  Line Height
                </h3>
                <div className="rounded-lg border border-maestro-border bg-maestro-card p-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={1.0}
                      max={2.0}
                      step={0.1}
                      value={settings.lineHeight}
                      onChange={(e) => setSetting("lineHeight", Number(e.target.value))}
                      className="flex-1 accent-maestro-accent"
                    />
                    <span className="w-8 text-right text-xs font-medium text-maestro-text">
                      {settings.lineHeight.toFixed(1)}
                    </span>
                  </div>
                </div>
              </section>

              {/* Reset Button */}
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={resetToDefaults}
                  className="flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium text-maestro-muted hover:bg-maestro-border/40 hover:text-maestro-text"
                >
                  <RotateCcw size={12} />
                  Reset to Defaults
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Font Family Section ── */

interface FontFamilySectionProps {
  availableFonts: { family: string; is_nerd_font: boolean; is_monospace: boolean }[];
  selectedFont: string;
  onSelect: (font: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

function FontFamilySection({
  availableFonts,
  selectedFont,
  onSelect,
  onRefresh,
  isRefreshing,
}: FontFamilySectionProps) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-maestro-muted">
          Font Family
        </h3>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="rounded p-1 hover:bg-maestro-border/40 disabled:opacity-50"
          title="Refresh font list"
        >
          {isRefreshing ? (
            <Loader2 size={12} className="animate-spin text-maestro-muted" />
          ) : (
            <RefreshCw size={12} className="text-maestro-muted" />
          )}
        </button>
      </div>
      <div className="rounded-lg border border-maestro-border bg-maestro-card p-3">
        <select
          value={selectedFont}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full rounded border border-maestro-border bg-maestro-bg px-3 py-2 text-sm text-maestro-text focus:outline-none focus:border-maestro-accent"
          style={{ fontFamily: selectedFont }}
          size={8}
        >
          {/* Always show embedded font first */}
          <option value={EMBEDDED_FONT}>
            {EMBEDDED_FONT} (Embedded)
          </option>

          {/* Nerd Fonts group */}
          {availableFonts.some((f) => f.is_nerd_font) && (
            <optgroup label="Nerd Fonts">
              {availableFonts
                .filter((f) => f.is_nerd_font && f.family !== EMBEDDED_FONT)
                .map((font) => (
                  <option key={font.family} value={font.family}>
                    {font.family}
                  </option>
                ))}
            </optgroup>
          )}

          {/* Other monospace fonts group */}
          {availableFonts.some((f) => !f.is_nerd_font) && (
            <optgroup label="Monospace Fonts">
              {availableFonts
                .filter((f) => !f.is_nerd_font && f.family !== EMBEDDED_FONT)
                .map((font) => (
                  <option key={font.family} value={font.family}>
                    {font.family}
                  </option>
                ))}
            </optgroup>
          )}
        </select>

        {/* Font preview */}
        <div
          className="mt-2 rounded border border-maestro-border bg-maestro-bg p-2 text-xs text-maestro-text"
          style={{ fontFamily: selectedFont }}
        >
          The quick brown fox jumps over the lazy dog
          <br />
          <span className="text-maestro-muted">0123456789 !@#$%^&*()</span>
        </div>

        {/* Selected font badges */}
        <div className="mt-2 flex flex-wrap gap-1">
          {availableFonts.find((f) => f.family === selectedFont)?.is_nerd_font && (
            <span className="rounded bg-maestro-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-maestro-accent">
              Nerd Font
            </span>
          )}
          {selectedFont === EMBEDDED_FONT && (
            <span className="rounded bg-maestro-green/20 px-1.5 py-0.5 text-[10px] font-medium text-maestro-green">
              Embedded
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
