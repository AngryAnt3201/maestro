import { useMarketplaceStore } from "@/stores/useMarketplaceStore";
import type { MarketplacePlugin } from "@/types/marketplace";
import { Check, ChevronRight, Download, Package } from "lucide-react";

interface MarketplacePluginRowProps {
  plugin: MarketplacePlugin;
  onInstall: () => void;
  onSelect: () => void;
}

export function MarketplacePluginRow({ plugin, onInstall, onSelect }: MarketplacePluginRowProps) {
  const { isInstalled, installingPluginId } = useMarketplaceStore();

  const installed = isInstalled(plugin.id);
  const isInstalling = installingPluginId === plugin.id;

  // Format types for display
  const typesLabel = plugin.types.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(", ");

  return (
    <div
      className="group flex items-center gap-3 border-b border-maestro-border px-4 py-3 transition-colors hover:bg-maestro-surface/50 cursor-pointer"
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      role="button"
      tabIndex={0}
    >
      {/* Icon */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-maestro-accent/10">
        {plugin.icon_url ? (
          <img
            src={plugin.icon_url}
            alt={plugin.name}
            className="h-5 w-5 rounded"
          />
        ) : (
          <Package size={16} className="text-maestro-accent" />
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-maestro-text">
            {plugin.name}
          </span>
          <span className="shrink-0 text-[10px] text-maestro-muted">
            v{plugin.version}
          </span>
          {installed && (
            <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-400">
              <Check size={10} />
              Installed
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="truncate text-xs text-maestro-muted">
            {plugin.description || "No description"}
          </span>
        </div>
      </div>

      {/* Category and types */}
      <div className="hidden shrink-0 items-center gap-2 text-[10px] text-maestro-muted sm:flex">
        <span className="rounded bg-maestro-accent/10 px-1.5 py-0.5 text-maestro-accent">
          {plugin.category}
        </span>
        {typesLabel && (
          <span className="text-maestro-border">|</span>
        )}
        <span>{typesLabel}</span>
      </div>

      {/* Stats */}
      <div className="hidden shrink-0 items-center gap-3 text-[10px] text-maestro-muted md:flex">
        {plugin.downloads !== null && (
          <span className="flex items-center gap-1">
            <Download size={10} />
            {plugin.downloads.toLocaleString()}
          </span>
        )}
        {plugin.stars !== null && (
          <span className="flex items-center gap-1">
            <span className="text-yellow-400">★</span>
            {plugin.stars}
          </span>
        )}
      </div>

      {/* Install button */}
      <div className="shrink-0">
        {installed ? (
          <span className="text-xs text-maestro-muted">
            <ChevronRight size={16} className="opacity-0 group-hover:opacity-100 transition-opacity" />
          </span>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onInstall();
            }}
            disabled={isInstalling}
            className="rounded bg-maestro-accent px-3 py-1 text-xs text-white transition-colors hover:bg-maestro-accent/80 disabled:opacity-50"
          >
            {isInstalling ? (
              <span className="flex items-center gap-1">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Installing
              </span>
            ) : (
              "Install"
            )}
          </button>
        )}
      </div>
    </div>
  );
}
