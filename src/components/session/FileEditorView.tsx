import { memo, useEffect, useRef } from "react";
import { useDraggable } from "@dnd-kit/core";
import { FileText, GripVertical, Loader2, Maximize2, Minimize2, Save, X } from "lucide-react";

interface FileEditorViewProps {
  sessionId: number;
  slotId: string;
  filePath: string;
  content: string;
  isDirty: boolean;
  isSaving?: boolean;
  error?: string | null;
  isFocused?: boolean;
  terminalCount?: number;
  isZoomed?: boolean;
  onFocus?: () => void;
  onChange: (content: string) => void;
  onSave: () => void;
  onClose: (sessionId: number) => void;
  onToggleZoom?: () => void;
}

function basename(path: string): string {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] || path;
}

export const FileEditorView = memo(function FileEditorView({
  sessionId,
  slotId,
  filePath,
  content,
  isDirty,
  isSaving = false,
  error,
  isFocused = false,
  terminalCount = 1,
  isZoomed = false,
  onFocus,
  onChange,
  onSave,
  onClose,
  onToggleZoom,
}: FileEditorViewProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { attributes: dragAttributes, listeners: dragListeners, setNodeRef: setDragRef, isDragging } =
    useDraggable({
      id: slotId,
      disabled: !slotId,
    });

  useEffect(() => {
    if (isFocused) {
      textareaRef.current?.focus();
    }
  }, [isFocused]);

  const compact = !isZoomed && terminalCount >= 5;

  return (
    <div
      className={`terminal-cell flex h-full flex-col bg-maestro-bg ${isFocused ? "terminal-cell-focused" : "terminal-cell-idle"}`}
      onClick={onFocus}
    >
      <div
        className={`flex shrink-0 items-center gap-2 border-b border-maestro-border bg-maestro-surface px-3 ${compact ? "h-9" : "h-10"}`}
      >
        <button
          type="button"
          ref={setDragRef}
          {...dragAttributes}
          {...dragListeners}
          className={`rounded p-1 text-maestro-muted transition-colors hover:bg-maestro-card hover:text-maestro-text ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
          title="Drag to reorder"
        >
          <GripVertical size={14} />
        </button>
        <FileText size={16} className="shrink-0 text-maestro-accent" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-maestro-text">{basename(filePath)}</span>
            {isDirty && <span className="text-[11px] font-medium text-maestro-orange">Unsaved</span>}
          </div>
          <div className="truncate text-[11px] text-maestro-muted">{filePath}</div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSave();
          }}
          disabled={isSaving || !isDirty}
          className="flex items-center gap-1 rounded border border-maestro-border px-2 py-1 text-xs text-maestro-text transition-colors hover:bg-maestro-card disabled:cursor-default disabled:opacity-50"
          title="Save (Cmd/Ctrl+S)"
        >
          {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          Save
        </button>
        {onToggleZoom && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleZoom();
            }}
            className="rounded p-1 text-maestro-muted transition-colors hover:bg-maestro-card hover:text-maestro-text"
            title={isZoomed ? "Exit zoom" : "Zoom pane"}
          >
            {isZoomed ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose(sessionId);
          }}
          className="rounded p-1 text-maestro-muted transition-colors hover:bg-maestro-card hover:text-maestro-red"
          title="Close file"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {error && <div className="border-b border-maestro-border bg-maestro-red/10 px-3 py-2 text-xs text-maestro-red">{error}</div>}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              onSave();
            }
          }}
          className="min-h-0 flex-1 resize-none bg-maestro-bg px-4 py-3 font-mono text-sm text-maestro-text outline-none"
          spellCheck={false}
        />
      </div>
    </div>
  );
});
