import { useMarketplaceStore } from "@/stores/useMarketplaceStore";
import type { InstallScope, MarketplacePlugin } from "@/types/marketplace";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Check, Folder, Package, User, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface PluginInstallModalProps {
  plugin: MarketplacePlugin;
  onClose: () => void;
  onInstalled: () => void;
  currentProjectPath?: string;
}

export function PluginInstallModal({
  plugin,
  onClose,
  onInstalled,
  currentProjectPath,
}: PluginInstallModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const { installPlugin, installingPluginId } = useMarketplaceStore();

  const [scope, setScope] = useState<InstallScope>("user");
  const [projectPath, setProjectPath] = useState(currentProjectPath || "");
  const [error, setError] = useState<string | null>(null);

  const isInstalling = installingPluginId === plugin.id;

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

  const handleBrowseProject = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        title: "Select Project Directory",
      });
      if (selected) {
        setProjectPath(selected);
      }
    } catch (err) {
      console.error("Failed to open directory picker:", err);
    }
  };

  const handleInstall = async () => {
    setError(null);

    // Validate project path for project/local scopes
    if ((scope === "project" || scope === "local") && !projectPath) {
      setError("Please select a project directory");
      return;
    }

    const result = await installPlugin(
      plugin.id,
      scope,
      scope === "user" ? undefined : projectPath
    );

    if (result) {
      onInstalled();
    }
  };

  const scopeOptions: { value: InstallScope; label: string; description: string; icon: React.ReactNode }[] = [
    {
      value: "user",
      label: "User",
      description: "Available in all projects (~/.claude/plugins/)",
      icon: <User size={16} />,
    },
    {
      value: "project",
      label: "Project",
      description: "Available in this project (.claude/plugins/)",
      icon: <Folder size={16} />,
    },
    {
      value: "local",
      label: "Local",
      description: "Local to this machine (.claude.local/plugins/)",
      icon: <Folder size={16} />,
    },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        ref={modalRef}
        className="w-full max-w-md rounded-lg border border-maestro-border bg-maestro-bg shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-maestro-border px-4 py-3">
          <h2 className="text-sm font-semibold text-maestro-text">Install Plugin</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-maestro-border/40"
          >
            <X size={16} className="text-maestro-muted" />
          </button>
        </div>

        {/* Plugin info */}
        <div className="border-b border-maestro-border px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-maestro-accent/10">
              {plugin.icon_url ? (
                <img
                  src={plugin.icon_url}
                  alt={plugin.name}
                  className="h-6 w-6 rounded"
                />
              ) : (
                <Package size={20} className="text-maestro-accent" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium text-maestro-text">
                {plugin.name}
              </h3>
              <p className="text-xs text-maestro-muted">
                {plugin.author} · v{plugin.version}
              </p>
            </div>
          </div>
        </div>

        {/* Scope selection */}
        <div className="p-4">
          <label className="mb-2 block text-xs font-medium text-maestro-text">
            Installation Scope
          </label>
          <div className="space-y-2">
            {scopeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setScope(option.value)}
                className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                  scope === option.value
                    ? "border-maestro-accent bg-maestro-accent/5"
                    : "border-maestro-border hover:border-maestro-accent/50"
                }`}
              >
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded ${
                    scope === option.value
                      ? "bg-maestro-accent text-white"
                      : "bg-maestro-surface text-maestro-muted"
                  }`}
                >
                  {option.icon}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-maestro-text">
                      {option.label}
                    </span>
                    {scope === option.value && (
                      <Check size={14} className="text-maestro-accent" />
                    )}
                  </div>
                  <p className="text-xs text-maestro-muted">{option.description}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Project path picker (for project/local scopes) */}
          {(scope === "project" || scope === "local") && (
            <div className="mt-4">
              <label className="mb-2 block text-xs font-medium text-maestro-text">
                Project Directory
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={projectPath}
                  onChange={(e) => setProjectPath(e.target.value)}
                  placeholder="/path/to/project"
                  className="flex-1 rounded border border-maestro-border bg-maestro-surface px-3 py-2 text-xs text-maestro-text placeholder:text-maestro-muted focus:border-maestro-accent focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleBrowseProject}
                  className="rounded border border-maestro-border bg-maestro-card px-3 py-2 text-xs text-maestro-text hover:bg-maestro-surface"
                >
                  Browse
                </button>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <p className="mt-2 text-xs text-red-400">{error}</p>
          )}
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
            onClick={handleInstall}
            disabled={isInstalling}
            className="flex items-center gap-2 rounded bg-maestro-accent px-4 py-2 text-xs text-white hover:bg-maestro-accent/80 disabled:opacity-50"
          >
            {isInstalling ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Installing...
              </>
            ) : (
              "Install"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
