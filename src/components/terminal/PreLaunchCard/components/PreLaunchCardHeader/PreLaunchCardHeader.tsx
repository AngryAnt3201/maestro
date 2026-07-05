import Expand from "lucide-react/dist/esm/icons/expand";
import Minimize from "lucide-react/dist/esm/icons/minimize";
import X from "lucide-react/dist/esm/icons/x";

interface PreLaunchCardHeaderProps {
  isZoomed: boolean;
  onToggleZoom?: () => void;
  onRemove: () => void;
}

export function PreLaunchCardHeader({
  isZoomed,
  onToggleZoom,
  onRemove,
}: PreLaunchCardHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-maestro-text">Configure Session</span>
      <div className="flex items-center gap-1">
        {onToggleZoom && (
          <button
            type="button"
            onClick={() => onToggleZoom()}
            className="rounded p-1 text-maestro-muted transition-colors hover:bg-maestro-card hover:text-maestro-accent"
            title={isZoomed ? "Restore grid view" : "Zoom terminal"}
            aria-label={isZoomed ? "Restore grid view" : "Zoom terminal"}
          >
            {isZoomed ? <Minimize size={14} /> : <Expand size={14} />}
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-1 text-maestro-muted transition-colors hover:bg-maestro-card hover:text-maestro-red"
          title="Remove session slot"
          aria-label="Remove session slot"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
