import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DynamicIcon } from "./DynamicIcon";
import type { QuickAction } from "@/types/quickAction";
import { QUICK_ACTION_COLORS, QUICK_ACTION_ICONS } from "@/types/quickAction";

interface QuickActionEditorProps {
  /** Existing action to edit, or undefined to create new */
  action?: QuickAction;
  /** Called when the action is saved */
  onSave: (action: Omit<QuickAction, "id" | "createdAt" | "sortOrder">) => void;
  /** Called when the modal is closed without saving */
  onClose: () => void;
}

/**
 * Modal for creating or editing a quick action.
 * Includes icon picker, color picker, and live preview.
 */
export function QuickActionEditor({ action, onSave, onClose }: QuickActionEditorProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Form state
  const [name, setName] = useState(action?.name ?? "");
  const [icon, setIcon] = useState(action?.icon ?? "Star");
  const [colorHex, setColorHex] = useState(action?.colorHex ?? QUICK_ACTION_COLORS[0].hex);
  const [prompt, setPrompt] = useState(action?.prompt ?? "");
  const [isEnabled, setIsEnabled] = useState(action?.isEnabled ?? true);

  // Validation
  const isValid = name.trim().length > 0 && prompt.trim().length > 0;

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

  const handleSave = () => {
    if (!isValid) return;
    onSave({
      name: name.trim(),
      icon,
      colorHex,
      prompt: prompt.trim(),
      isEnabled,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        ref={modalRef}
        className="w-full max-w-lg rounded-lg border border-maestro-border bg-maestro-bg shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-maestro-border px-4 py-3">
          <h2 className="text-sm font-semibold text-maestro-text">
            {action ? "Edit Quick Action" : "New Quick Action"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-maestro-border/40"
          >
            <X size={16} className="text-maestro-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
          {/* Name input */}
          <div>
            <label className="mb-1 block text-xs font-medium text-maestro-muted">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Quick action name"
              className="w-full rounded border border-maestro-border bg-maestro-card px-3 py-2 text-sm text-maestro-text placeholder:text-maestro-muted focus:border-maestro-accent focus:outline-none"
              autoFocus
            />
          </div>

          {/* Icon picker */}
          <div>
            <label className="mb-2 block text-xs font-medium text-maestro-muted">
              Icon
            </label>
            <div className="grid grid-cols-8 gap-1 rounded border border-maestro-border bg-maestro-card p-2">
              {QUICK_ACTION_ICONS.map((iconName) => (
                <button
                  key={iconName}
                  type="button"
                  onClick={() => setIcon(iconName)}
                  className={`flex h-8 w-8 items-center justify-center rounded transition-colors ${
                    icon === iconName
                      ? "bg-maestro-accent/20 ring-1 ring-maestro-accent"
                      : "hover:bg-maestro-border/40"
                  }`}
                  title={iconName}
                >
                  <DynamicIcon
                    name={iconName}
                    size={16}
                    className={icon === iconName ? "text-maestro-accent" : "text-maestro-muted"}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Color picker */}
          <div>
            <label className="mb-2 block text-xs font-medium text-maestro-muted">
              Color
            </label>
            <div className="flex flex-wrap gap-2 rounded border border-maestro-border bg-maestro-card p-2">
              {QUICK_ACTION_COLORS.map((color) => (
                <button
                  key={color.name}
                  type="button"
                  onClick={() => setColorHex(color.hex)}
                  className={`h-6 w-6 rounded-full transition-transform ${
                    colorHex === color.hex ? "scale-110 ring-2 ring-white ring-offset-2 ring-offset-maestro-card" : "hover:scale-105"
                  }`}
                  style={{ backgroundColor: color.hex }}
                  title={color.name}
                />
              ))}
            </div>
          </div>

          {/* Prompt textarea */}
          <div>
            <label className="mb-1 block text-xs font-medium text-maestro-muted">
              Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter the prompt that will be sent to Claude..."
              rows={6}
              className="w-full rounded border border-maestro-border bg-maestro-card px-3 py-2 font-mono text-xs text-maestro-text placeholder:text-maestro-muted focus:border-maestro-accent focus:outline-none"
            />
          </div>

          {/* Enabled toggle */}
          <label className="flex items-center gap-2 text-xs text-maestro-muted">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
              className="h-3 w-3 rounded border-maestro-border"
            />
            Enabled
          </label>

          {/* Live preview */}
          <div>
            <label className="mb-2 block text-xs font-medium text-maestro-muted">
              Preview
            </label>
            <div className="flex items-center gap-2 rounded border border-maestro-border bg-maestro-surface p-2">
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-maestro-muted"
              >
                <DynamicIcon
                  name={icon}
                  size={9}
                  style={{ color: colorHex }}
                  fill="currentColor"
                />
                {name || "Quick Action"}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-maestro-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-maestro-muted hover:bg-maestro-border/40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!isValid}
            className="flex items-center gap-1 rounded bg-maestro-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-maestro-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check size={12} />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
