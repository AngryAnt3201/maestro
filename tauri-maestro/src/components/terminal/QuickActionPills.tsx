import { Plus } from "lucide-react";
import { useMemo } from "react";
import { DynamicIcon } from "@/components/quickactions/DynamicIcon";
import { useQuickActionStore } from "@/stores/useQuickActionStore";

interface QuickActionPillsProps {
  /** Called when a quick action button is clicked, with the action's prompt */
  onAction?: (prompt: string) => void;
  /** Called when the manage quick actions button is clicked */
  onManageClick?: () => void;
}

export function QuickActionPills({ onAction, onManageClick }: QuickActionPillsProps) {
  // Select raw actions array (stable reference) instead of calling getSortedActions()
  // which creates a new array on every call and causes infinite re-renders
  const actions = useQuickActionStore((s) => s.actions);

  const sortedActions = useMemo(
    () =>
      actions
        .filter((a) => a.isEnabled)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [actions]
  );

  return (
    <div className="no-select flex shrink-0 items-center gap-1 border-t border-maestro-border bg-maestro-surface px-2 py-1">
      {sortedActions.map((a) => (
        <button
          type="button"
          key={a.id}
          disabled={!onAction}
          onClick={() => onAction?.(a.prompt)}
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-maestro-muted transition-colors hover:bg-maestro-card hover:text-maestro-text${!onAction ? " opacity-50 cursor-not-allowed" : ""}`}
        >
          <DynamicIcon
            name={a.icon}
            size={9}
            style={{ color: a.colorHex }}
            fill="currentColor"
          />
          {a.name}
        </button>
      ))}
      <button
        type="button"
        onClick={onManageClick}
        disabled={!onManageClick}
        title="Manage Quick Actions"
        className={`inline-flex items-center justify-center rounded p-0.5 text-maestro-muted transition-colors hover:bg-maestro-card hover:text-maestro-text${!onManageClick ? " opacity-50 cursor-not-allowed" : ""}`}
      >
        <Plus size={11} />
      </button>
    </div>
  );
}
