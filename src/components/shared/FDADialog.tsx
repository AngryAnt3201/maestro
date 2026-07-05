import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import ShieldAlert from "lucide-react/dist/esm/icons/shield-alert";
import X from "lucide-react/dist/esm/icons/x";
import { useState } from "react";
import { requestFullDiskAccess } from "@/lib/permissions";

interface FDADialogProps {
  path: string | null;
  onDismiss: () => void;
  onDismissPermanently: () => void;
  onRetry: () => Promise<void>;
}

/**
 * Dialog shown when the app needs Full Disk Access to open a project
 * in a TCC-protected location (Desktop, Documents, Downloads).
 */
export function FDADialog({ path, onDismiss, onDismissPermanently, onRetry }: FDADialogProps) {
  const [isRetrying, setIsRetrying] = useState(false);

  const handleOpenSettings = async () => {
    await requestFullDiskAccess();
  };

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await onRetry();
    } finally {
      setIsRetrying(false);
    }
  };

  // Extract just the folder name for display
  const folderName = path?.split("/").pop() ?? "this folder";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="relative mx-4 w-full max-w-md rounded-lg border border-maestro-border bg-maestro-card p-6 shadow-xl">
        {/* Close button */}
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-3 top-3 rounded p-1 text-maestro-muted transition-colors hover:bg-maestro-bg hover:text-maestro-text"
          aria-label="Close"
        >
          <X size={16} />
        </button>

        {/* Icon and title */}
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/15">
            <ShieldAlert size={20} className="text-amber-500" />
          </div>
          <h2 className="text-lg font-semibold text-maestro-text">Full Disk Access Required</h2>
        </div>

        {/* Description */}
        <div className="mb-6 space-y-3 text-sm text-maestro-muted">
          <p>
            Maestro needs Full Disk Access to open{" "}
            <strong className="text-maestro-text">{folderName}</strong> because it's in a protected
            location.
          </p>
          {path && (
            <p className="rounded bg-maestro-bg px-2 py-1.5 font-mono text-xs break-all">{path}</p>
          )}
          <p>
            Projects on <strong className="text-maestro-text">external drives</strong> or{" "}
            <strong className="text-maestro-text">network mounts</strong> work without this
            permission.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleOpenSettings}
            className="flex items-center justify-center gap-2 rounded-md bg-maestro-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-maestro-accent/90"
          >
            <ExternalLink size={16} />
            Open System Settings
          </button>
          <button
            type="button"
            onClick={handleRetry}
            disabled={isRetrying}
            className="flex items-center justify-center gap-2 rounded-md border border-maestro-border px-4 py-2 text-sm font-medium text-maestro-text transition-colors hover:bg-maestro-bg disabled:opacity-50"
          >
            <RefreshCw size={16} className={isRetrying ? "animate-spin" : ""} />
            {isRetrying ? "Checking..." : "I've Granted Access"}
          </button>
          <button
            type="button"
            onClick={onDismissPermanently}
            className="rounded-md px-4 py-2 text-sm text-maestro-muted transition-colors hover:bg-maestro-bg hover:text-maestro-text"
          >
            Don't ask again
          </button>
        </div>

        {/* Help text */}
        <p className="mt-4 text-xs text-maestro-muted/70">
          In System Settings, go to Privacy &amp; Security &rarr; Full Disk Access, then enable
          Maestro.
        </p>
      </div>
    </div>
  );
}
