import Check from "lucide-react/dist/esm/icons/check";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import X from "lucide-react/dist/esm/icons/x";
import type { RemoteStatus } from "@/stores/useGitStore";

interface RemoteStatusIndicatorProps {
  status: RemoteStatus;
  size?: "sm" | "md";
}

/**
 * Shows a connection status indicator for a git remote.
 * - unknown: gray dot
 * - checking: spinning loader
 * - connected: green dot with checkmark
 * - disconnected: red dot with X
 */
export function RemoteStatusIndicator({ status, size = "sm" }: RemoteStatusIndicatorProps) {
  const dotSize = size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5";
  const iconSize = size === "sm" ? 10 : 12;

  if (status === "checking") {
    return <Loader2 size={iconSize} className="animate-spin text-maestro-muted shrink-0" />;
  }

  if (status === "connected") {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <span className={`${dotSize} rounded-full bg-maestro-green`} />
        <Check size={iconSize} className="text-maestro-green" />
      </div>
    );
  }

  if (status === "disconnected") {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <span className={`${dotSize} rounded-full bg-maestro-red`} />
        <X size={iconSize} className="text-maestro-red" />
      </div>
    );
  }

  // unknown
  return <span className={`${dotSize} rounded-full bg-maestro-muted shrink-0`} />;
}
