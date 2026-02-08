import { ArrowRight, Download, X } from "lucide-react";
import { useState, useEffect } from "react";
import { type CliAiMode } from "@/lib/terminal";
import { checkForUpdates, getPlatform, getUpdateCommand, type VersionInfo } from "@/lib/updates";
import { useCliSettingsStore } from "@/stores/useCliSettingsStore";

interface TerminalUpdateBannerProps {
  mode: CliAiMode;
}

/**
 * Banner shown in the terminal when a CLI update is available.
 * Only shown if auto-update checking is enabled in settings.
 */
export function TerminalUpdateBanner({ mode }: TerminalUpdateBannerProps) {
  const [updateInfo, setUpdateInfo] = useState<VersionInfo | null>(null);
  const [updateCmd, setUpdateCmd] = useState<string>("");
  const [isDismissed, setIsDismissed] = useState(false);
  
  const { flags } = useCliSettingsStore();
  // Only show banner if autoUpdate is FALSE (because if it's true, we auto-applied it)
  const autoUpdateEnabled = flags[mode]?.autoUpdate ?? true;

  useEffect(() => {
    // If auto-update is ON, we don't show the banner (silent update)
    // We only show banner if user explicitly disabled auto-updates but we found one
    if (autoUpdateEnabled || isDismissed) return;

    let mounted = true;
    
    checkForUpdates(mode).then((info) => {
      if (mounted && info) {
        setUpdateInfo(info);
      }
    });

    return () => {
      mounted = false;
    };
  }, [mode, autoUpdateEnabled, isDismissed]);

  useEffect(() => {
    if (!updateInfo) {
      setUpdateCmd("");
      return;
    }

    let mounted = true;
    const platform = getPlatform();
    getUpdateCommand(mode, platform, updateInfo.source).then((cmd) => {
      if (mounted) {
        setUpdateCmd(cmd);
      }
    }).catch(() => {
      if (mounted) {
        setUpdateCmd("");
      }
    });

    return () => {
      mounted = false;
    };
  }, [mode, updateInfo]);

  if (!updateInfo || isDismissed) return null;
  
  const sourceLabel = updateInfo.source === "homebrew" ? "Homebrew" :
                      updateInfo.source === "npm" ? "npm" :
                      updateInfo.source === "choco" ? "Chocolatey" :
                      updateInfo.source === "scoop" ? "Scoop" : "your package manager";

  return (
    <div className="bg-maestro-accent/15 border-b border-maestro-accent/30 px-4 py-2.5 flex items-center justify-between animate-in fade-in slide-in-from-top-1 duration-300">
      <div className="flex items-center gap-3">
        <div className="bg-maestro-accent/20 p-2 rounded-full text-maestro-accent">
          <Download size={16} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-maestro-text">
              {mode} CLI update available!
            </span>
            <div className="flex items-center gap-1 text-xs font-mono bg-maestro-bg/50 border border-maestro-border px-2 py-0.5 rounded text-maestro-muted">
              <span>{updateInfo.current}</span>
              <ArrowRight size={10} className="text-maestro-muted/50" />
              <span className="text-maestro-accent font-bold">{updateInfo.latest}</span>
            </div>
          </div>
          <p className="text-xs text-maestro-muted mt-1">
            Installed via <span className="text-maestro-text font-medium">{sourceLabel}</span>. Please update with <code className="bg-maestro-bg/80 border border-maestro-border px-1.5 py-0.5 rounded text-maestro-accent font-mono font-bold ml-1">"{updateCmd}"</code>
          </p>
        </div>
      </div>
      
      <button 
        onClick={() => setIsDismissed(true)}
        className="p-1 hover:bg-maestro-border/40 rounded transition-colors text-maestro-muted hover:text-maestro-text"
        title="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
