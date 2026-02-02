import { Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DynamicIcon } from "./DynamicIcon";
import { QuickActionEditor } from "./QuickActionEditor";
import { useQuickActionStore } from "@/stores/useQuickActionStore";
import type { QuickAction } from "@/types/quickAction";

interface QuickActionsManagerProps {
  onClose: () => void;
}

/**
 * Modal for managing quick actions: view, edit, delete, and reset to defaults.
 */
export function QuickActionsManager({ onClose }: QuickActionsManagerProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const { actions, addAction, updateAction, deleteAction, resetToDefaults } = useQuickActionStore();

  // Editor state
  const [editingAction, setEditingAction] = useState<QuickAction | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Delete confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Reset confirmation
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Sort actions by sortOrder
  const sortedActions = [...actions].sort((a, b) => a.sortOrder - b.sortOrder);

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
        if (editingAction || isCreating) {
          setEditingAction(null);
          setIsCreating(false);
        } else if (deleteConfirmId || showResetConfirm) {
          setDeleteConfirmId(null);
          setShowResetConfirm(false);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, editingAction, isCreating, deleteConfirmId, showResetConfirm]);

  const handleCreate = (actionData: Omit<QuickAction, "id" | "createdAt" | "sortOrder">) => {
    addAction(actionData);
    setIsCreating(false);
  };

  const handleEdit = (actionData: Omit<QuickAction, "id" | "createdAt" | "sortOrder">) => {
    if (editingAction) {
      updateAction(editingAction.id, actionData);
      setEditingAction(null);
    }
  };

  const handleDelete = (id: string) => {
    deleteAction(id);
    setDeleteConfirmId(null);
  };

  const handleReset = () => {
    resetToDefaults();
    setShowResetConfirm(false);
  };

  // If editor is open, show it
  if (isCreating) {
    return <QuickActionEditor onSave={handleCreate} onClose={() => setIsCreating(false)} />;
  }

  if (editingAction) {
    return (
      <QuickActionEditor
        action={editingAction}
        onSave={handleEdit}
        onClose={() => setEditingAction(null)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        ref={modalRef}
        className="w-full max-w-md rounded-lg border border-maestro-border bg-maestro-bg shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-maestro-border px-4 py-3">
          <h2 className="text-sm font-semibold text-maestro-text">Manage Quick Actions</h2>
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
          {sortedActions.length === 0 ? (
            <p className="py-8 text-center text-xs text-maestro-muted">
              No quick actions configured.
            </p>
          ) : (
            <div className="space-y-2">
              {sortedActions.map((action) => (
                <div
                  key={action.id}
                  className="group flex items-start gap-3 rounded-lg border border-maestro-border bg-maestro-card p-3"
                >
                  {/* Icon */}
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded"
                    style={{ backgroundColor: `${action.colorHex}20` }}
                  >
                    <DynamicIcon
                      name={action.icon}
                      size={16}
                      style={{ color: action.colorHex }}
                    />
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-maestro-text">
                        {action.name}
                      </span>
                      {!action.isEnabled && (
                        <span className="rounded bg-maestro-border/40 px-1.5 py-0.5 text-[9px] text-maestro-muted">
                          Disabled
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-maestro-muted">
                      {action.prompt}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => setEditingAction(action)}
                      className="rounded p-1.5 hover:bg-maestro-border/40"
                      title="Edit"
                    >
                      <Pencil size={12} className="text-maestro-muted" />
                    </button>
                    {deleteConfirmId === action.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleDelete(action.id)}
                          className="rounded bg-maestro-red/20 px-2 py-1 text-[10px] font-medium text-maestro-red hover:bg-maestro-red/30"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(null)}
                          className="rounded px-2 py-1 text-[10px] text-maestro-muted hover:bg-maestro-border/40"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(action.id)}
                        className="rounded p-1.5 hover:bg-maestro-border/40"
                        title="Delete"
                      >
                        <Trash2 size={12} className="text-maestro-red" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-maestro-border px-4 py-3">
          {showResetConfirm ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-maestro-muted">Reset all actions?</span>
              <button
                type="button"
                onClick={handleReset}
                className="rounded bg-maestro-red/20 px-2 py-1 text-[10px] font-medium text-maestro-red hover:bg-maestro-red/30"
              >
                Yes, Reset
              </button>
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="rounded px-2 py-1 text-[10px] text-maestro-muted hover:bg-maestro-border/40"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-maestro-muted hover:bg-maestro-border/40"
            >
              <RotateCcw size={12} />
              Reset to Defaults
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-1 rounded bg-maestro-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-maestro-accent/90"
          >
            <Plus size={12} />
            Add Quick Action
          </button>
        </div>
      </div>
    </div>
  );
}
