import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import X from "lucide-react/dist/esm/icons/x";
import { useEffect, useRef, useState } from "react";
import { writeClaudeMd } from "@/lib/claudemd";
import { toInvokeErrorMessage } from "@/lib/invokeError";

interface ClaudeMdEditorModalProps {
  /** Current project path */
  projectPath: string;
  /** Whether the file exists (determines create vs edit mode) */
  exists: boolean;
  /** Initial content (if editing existing file) */
  initialContent?: string;
  /** Close handler */
  onClose: () => void;
  /** Callback after successful save */
  onSaved?: () => void;
}

const DEFAULT_TEMPLATE = `# Project Context

<!-- Add project-specific instructions for Claude here -->

## Overview
[Describe your project briefly]

## Coding Standards
[Any specific coding standards or patterns to follow]

## Important Notes
[Any important context Claude should know]
`;

/**
 * Modal for viewing and editing CLAUDE.md files.
 */
export function ClaudeMdEditorModal({
  projectPath,
  exists,
  initialContent,
  onClose,
  onSaved,
}: ClaudeMdEditorModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [content, setContent] = useState(
    exists && initialContent ? initialContent : DEFAULT_TEMPLATE,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSave = async () => {
    setError(null);
    setSaving(true);

    try {
      await writeClaudeMd(projectPath, content);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(toInvokeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        ref={modalRef}
        className="w-full max-w-2xl rounded-lg border border-maestro-border bg-maestro-bg shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-maestro-border px-4 py-3">
          <h2 className="text-sm font-semibold text-maestro-text">
            {exists ? "Edit CLAUDE.md" : "Create CLAUDE.md"}
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
        <div className="p-4">
          <p className="mb-3 text-xs text-maestro-muted">
            {exists
              ? "Edit the project context file that provides instructions to Claude."
              : "Create a CLAUDE.md file to provide project-specific context and instructions to Claude."}
          </p>

          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Enter project context..."
            className="h-80 w-full resize-none rounded border border-maestro-border bg-maestro-surface p-3 font-mono text-xs text-maestro-text placeholder:text-maestro-muted focus:border-maestro-accent focus:outline-none"
            spellCheck={false}
          />

          {/* Error */}
          {error && <p className="mt-2 text-xs text-maestro-red">{error}</p>}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 border-t border-maestro-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-2 text-xs text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded bg-maestro-accent px-4 py-2 text-xs text-white hover:bg-maestro-accent/80 disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Saving...
              </>
            ) : exists ? (
              "Save Changes"
            ) : (
              "Create File"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
