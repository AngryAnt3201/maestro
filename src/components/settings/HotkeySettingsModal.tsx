import { RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ACTION_GROUPS,
  ACTION_LABELS,
  type HotkeyAction,
  type HotkeyBinding,
  formatBinding,
  useHotkeySettingsStore,
} from "@/stores/useHotkeySettingsStore";

interface HotkeySettingsModalProps {
  onClose: () => void;
}

const MODIFIER_KEYS = new Set(["Meta", "Control", "Shift", "Alt"]);

export function HotkeySettingsModal({ onClose }: HotkeySettingsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const hotkeys = useHotkeySettingsStore((s) => s.hotkeys);
  const setHotkey = useHotkeySettingsStore((s) => s.setHotkey);
  const resetToDefaults = useHotkeySettingsStore((s) => s.resetToDefaults);
  const hasConflict = useHotkeySettingsStore((s) => s.hasConflict);

  const [recordingAction, setRecordingAction] = useState<HotkeyAction | null>(
    null,
  );
  const [conflictInfo, setConflictInfo] = useState<{
    action: HotkeyAction;
    binding: HotkeyBinding;
    conflictsWith: HotkeyAction;
  } | null>(null);

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

  // Close on Escape (only when not recording)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (recordingAction) {
          setRecordingAction(null);
          setConflictInfo(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, recordingAction]);

  // Key recorder: capture keydown when recording
  useEffect(() => {
    if (!recordingAction) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Ignore bare modifier-only keypresses
      if (MODIFIER_KEYS.has(e.key)) return;

      const binding: HotkeyBinding = {
        key: e.key,
        mod: e.metaKey || e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
      };

      // Check for conflicts
      const conflict = hasConflict(recordingAction, binding);
      if (conflict) {
        setConflictInfo({
          action: recordingAction,
          binding,
          conflictsWith: conflict,
        });
        return;
      }

      setHotkey(recordingAction, binding);
      setRecordingAction(null);
      setConflictInfo(null);
    };

    // Use capture phase so we intercept before other handlers
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [recordingAction, hasConflict, setHotkey]);

  const handleConfirmConflict = useCallback(() => {
    if (!conflictInfo) return;
    // Overwrite: set the new binding (the conflicting one keeps its binding, user can change it later)
    setHotkey(conflictInfo.action, conflictInfo.binding);
    setRecordingAction(null);
    setConflictInfo(null);
  }, [conflictInfo, setHotkey]);

  const handleCancelConflict = useCallback(() => {
    setConflictInfo(null);
    // Stay in recording mode so user can try again
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        ref={modalRef}
        className="w-full max-w-lg rounded-lg border border-maestro-border bg-maestro-bg shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-maestro-border px-4 py-3">
          <h2 className="text-sm font-semibold text-maestro-text">
            Keyboard Shortcuts
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
        <div className="max-h-[60vh] overflow-y-auto p-4">
          {ACTION_GROUPS.map((group) => (
            <div key={group.label} className="mb-4 last:mb-0">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-maestro-muted">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.actions.map((action) => (
                  <HotkeyRow
                    key={action}
                    action={action}
                    binding={hotkeys[action]}
                    isRecording={recordingAction === action}
                    conflictInfo={
                      conflictInfo?.action === action ? conflictInfo : null
                    }
                    onStartRecording={() => {
                      setRecordingAction(action);
                      setConflictInfo(null);
                    }}
                    onConfirmConflict={handleConfirmConflict}
                    onCancelConflict={handleCancelConflict}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-maestro-border px-4 py-2.5">
          <button
            type="button"
            onClick={() => {
              resetToDefaults();
              setRecordingAction(null);
              setConflictInfo(null);
            }}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] text-maestro-muted transition-colors hover:bg-maestro-border/40 hover:text-maestro-text"
          >
            <RotateCcw size={12} />
            Reset All to Defaults
          </button>
        </div>
      </div>
    </div>
  );
}

function HotkeyRow({
  action,
  binding,
  isRecording,
  conflictInfo,
  onStartRecording,
  onConfirmConflict,
  onCancelConflict,
}: {
  action: HotkeyAction;
  binding: HotkeyBinding;
  isRecording: boolean;
  conflictInfo: {
    action: HotkeyAction;
    binding: HotkeyBinding;
    conflictsWith: HotkeyAction;
  } | null;
  onStartRecording: () => void;
  onConfirmConflict: () => void;
  onCancelConflict: () => void;
}) {
  return (
    <div className="group rounded-md px-2 py-1.5 hover:bg-maestro-border/20">
      <div className="flex items-center justify-between">
        <span className="text-xs text-maestro-text">
          {ACTION_LABELS[action]}
        </span>
        <div className="flex items-center gap-1.5">
          {isRecording ? (
            <span className="rounded border border-maestro-accent/50 bg-maestro-accent/10 px-2 py-0.5 text-[11px] text-maestro-accent animate-pulse">
              Press keys...
            </span>
          ) : (
            <button
              type="button"
              onClick={onStartRecording}
              className="rounded border border-maestro-border bg-maestro-surface px-2 py-0.5 text-[11px] font-mono text-maestro-text transition-colors hover:border-maestro-accent/50"
            >
              {formatBinding(binding)}
            </button>
          )}
        </div>
      </div>
      {conflictInfo && (
        <div className="mt-1 flex items-center gap-2 text-[10px]">
          <span className="text-maestro-orange">
            Conflicts with "{ACTION_LABELS[conflictInfo.conflictsWith]}"
          </span>
          <button
            type="button"
            onClick={onConfirmConflict}
            className="rounded bg-maestro-orange/20 px-1.5 py-0.5 text-maestro-orange hover:bg-maestro-orange/30"
          >
            Override
          </button>
          <button
            type="button"
            onClick={onCancelConflict}
            className="rounded bg-maestro-border/40 px-1.5 py-0.5 text-maestro-muted hover:bg-maestro-border/60"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
