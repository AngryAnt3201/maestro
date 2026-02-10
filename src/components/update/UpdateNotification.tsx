import { AlertTriangle, ArrowDownCircle, Download, Loader2, X } from "lucide-react";
import { useUpdateStore } from "@/stores/useUpdateStore";

export function UpdateNotification() {
  const status = useUpdateStore((s) => s.status);
  const updateInfo = useUpdateStore((s) => s.updateInfo);
  const downloadProgress = useUpdateStore((s) => s.downloadProgress);
  const error = useUpdateStore((s) => s.error);
  const dismissedVersion = useUpdateStore((s) => s.dismissedVersion);
  const downloadAndInstall = useUpdateStore((s) => s.downloadAndInstall);
  const dismissUpdate = useUpdateStore((s) => s.dismissUpdate);

  // Don't show if idle/checking, or if this version was dismissed
  const isVisible =
    status === "available" ||
    status === "downloading" ||
    status === "installing" ||
    status === "error";

  if (!isVisible) return null;

  // Don't show if user dismissed this specific version
  if (
    status === "available" &&
    dismissedVersion &&
    updateInfo?.latest_version === dismissedVersion
  ) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-maestro-border bg-maestro-card shadow-[0_4px_24px_rgb(0_0_0/0.4)] animate-in slide-in-from-bottom-4">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-maestro-border/40 px-3 py-2">
        {status === "error" ? (
          <AlertTriangle size={14} className="shrink-0 text-maestro-red" />
        ) : status === "installing" ? (
          <Loader2 size={14} className="shrink-0 text-maestro-accent animate-spin" />
        ) : status === "downloading" ? (
          <Download size={14} className="shrink-0 text-maestro-accent" />
        ) : (
          <ArrowDownCircle size={14} className="shrink-0 text-maestro-green" />
        )}
        <span className="flex-1 text-xs font-semibold text-maestro-text">
          {status === "error"
            ? "Update Error"
            : status === "installing"
              ? "Installing Update..."
              : status === "downloading"
                ? "Downloading Update..."
                : "Update Available"}
        </span>
        {status !== "installing" && status !== "downloading" && (
          <button
            type="button"
            onClick={dismissUpdate}
            className="rounded p-0.5 text-maestro-muted hover:bg-maestro-border/40 hover:text-maestro-text"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 space-y-2">
        {status === "error" && (
          <p className="text-[11px] text-maestro-red leading-relaxed">{error}</p>
        )}

        {status === "available" && updateInfo && (
          <>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-maestro-muted">Current:</span>
              <span className="font-medium text-maestro-text">
                v{updateInfo.current_version}
              </span>
              <span className="text-maestro-muted mx-0.5">&rarr;</span>
              <span className="font-medium text-maestro-green">
                v{updateInfo.latest_version}
              </span>
            </div>
            {updateInfo.release_notes && (
              <p className="text-[11px] text-maestro-muted leading-relaxed line-clamp-3">
                {updateInfo.release_notes}
              </p>
            )}
            <button
              type="button"
              onClick={downloadAndInstall}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-maestro-accent/15 px-3 py-1.5 text-xs font-medium text-maestro-accent transition-colors hover:bg-maestro-accent/25"
            >
              <Download size={13} />
              Download and Install
            </button>
          </>
        )}

        {status === "downloading" && (
          <>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-maestro-border/40">
              <div
                className="h-full rounded-full bg-maestro-accent transition-all duration-300"
                style={{ width: `${downloadProgress ?? 0}%` }}
              />
            </div>
            <p className="text-[11px] text-maestro-muted text-center">
              {downloadProgress != null ? `${downloadProgress}%` : "Downloading..."}
            </p>
          </>
        )}

        {status === "installing" && (
          <p className="text-[11px] text-maestro-muted text-center">
            Installing update... the app will restart.
          </p>
        )}
      </div>
    </div>
  );
}
