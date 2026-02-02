import { useMarketplaceStore } from "@/stores/useMarketplaceStore";
import type { MarketplacePlugin } from "@/types/marketplace";
import {
  Grid,
  Layers,
  List,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MarketplaceFilters } from "./MarketplaceFilters";
import { MarketplacePluginCard } from "./MarketplacePluginCard";
import { MarketplacePluginRow } from "./MarketplacePluginRow";
import { MarketplaceSourcesPanel } from "./MarketplaceSourcesPanel";
import { PluginInstallModal } from "./PluginInstallModal";

interface MarketplaceBrowserProps {
  onClose: () => void;
  currentProjectPath?: string;
}

export function MarketplaceBrowser({ onClose, currentProjectPath }: MarketplaceBrowserProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const {
    isLoading,
    isRefreshing,
    error,
    searchText,
    setSearchText,
    viewMode,
    setViewMode,
    showSourcesSidebar,
    toggleSourcesSidebar,
    refreshMarketplaces,
    getFilteredPlugins,
    selectPlugin,
  } = useMarketplaceStore();

  const [installPlugin, setInstallPlugin] = useState<MarketplacePlugin | null>(null);

  const filteredPlugins = getFilteredPlugins();

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
        if (installPlugin) {
          setInstallPlugin(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, installPlugin]);

  // Focus search on open
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const handleInstallClick = (plugin: MarketplacePlugin) => {
    setInstallPlugin(plugin);
  };

  const handleInstalled = () => {
    setInstallPlugin(null);
    // Optionally show success toast
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div
          ref={modalRef}
          className="flex h-[700px] w-[900px] max-w-[95vw] max-h-[90vh] flex-col rounded-lg border border-maestro-border bg-maestro-bg shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-maestro-border px-4 py-3">
            <div className="flex items-center gap-3">
              <Layers size={18} className="text-maestro-accent" />
              <h2 className="text-sm font-semibold text-maestro-text">Plugin Marketplace</h2>
            </div>

            <div className="flex items-center gap-2">
              {/* Search */}
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-maestro-muted"
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Search plugins..."
                  className="w-64 rounded border border-maestro-border bg-maestro-surface py-1.5 pl-8 pr-3 text-xs text-maestro-text placeholder:text-maestro-muted focus:border-maestro-accent focus:outline-none"
                />
              </div>

              {/* View toggle */}
              <div className="flex items-center rounded border border-maestro-border">
                <button
                  type="button"
                  onClick={() => setViewMode("grid")}
                  className={`rounded-l p-1.5 ${
                    viewMode === "grid"
                      ? "bg-maestro-accent text-white"
                      : "text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text"
                  }`}
                  title="Grid view"
                >
                  <Grid size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={`rounded-r p-1.5 ${
                    viewMode === "list"
                      ? "bg-maestro-accent text-white"
                      : "text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text"
                  }`}
                  title="List view"
                >
                  <List size={14} />
                </button>
              </div>

              {/* Refresh */}
              <button
                type="button"
                onClick={() => refreshMarketplaces()}
                disabled={isRefreshing}
                className="rounded p-1.5 text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text disabled:opacity-50"
                title="Refresh marketplaces"
              >
                <RefreshCw
                  size={14}
                  className={isRefreshing ? "animate-spin" : ""}
                />
              </button>

              {/* Sources toggle */}
              <button
                type="button"
                onClick={toggleSourcesSidebar}
                className={`rounded p-1.5 ${
                  showSourcesSidebar
                    ? "bg-maestro-accent/10 text-maestro-accent"
                    : "text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text"
                }`}
                title="Manage sources"
              >
                <Settings size={14} />
              </button>

              {/* Close */}
              <button
                type="button"
                onClick={onClose}
                className="rounded p-1.5 text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Filters */}
          <MarketplaceFilters />

          {/* Content */}
          <div className="flex flex-1 overflow-hidden">
            {/* Main content area */}
            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="flex h-full items-center justify-center">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 size={24} className="animate-spin text-maestro-accent" />
                    <p className="text-xs text-maestro-muted">Loading plugins...</p>
                  </div>
                </div>
              ) : error ? (
                <div className="flex h-full items-center justify-center">
                  <div className="flex flex-col items-center gap-3 p-6 text-center">
                    <p className="text-sm text-red-400">{error}</p>
                    <button
                      type="button"
                      onClick={() => refreshMarketplaces()}
                      className="rounded bg-maestro-accent px-4 py-2 text-xs text-white hover:bg-maestro-accent/80"
                    >
                      Try Again
                    </button>
                  </div>
                </div>
              ) : filteredPlugins.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <div className="flex flex-col items-center gap-3 p-6 text-center">
                    <Layers size={32} className="text-maestro-muted" />
                    <p className="text-sm text-maestro-muted">No plugins found</p>
                    <p className="text-xs text-maestro-muted">
                      {searchText
                        ? "Try adjusting your search or filters"
                        : "Add a marketplace source to browse plugins"}
                    </p>
                  </div>
                </div>
              ) : viewMode === "grid" ? (
                <div className="grid grid-cols-3 gap-4 p-4">
                  {filteredPlugins.map((plugin) => (
                    <MarketplacePluginCard
                      key={plugin.id}
                      plugin={plugin}
                      onInstall={() => handleInstallClick(plugin)}
                    />
                  ))}
                </div>
              ) : (
                <div>
                  {filteredPlugins.map((plugin) => (
                    <MarketplacePluginRow
                      key={plugin.id}
                      plugin={plugin}
                      onInstall={() => handleInstallClick(plugin)}
                      onSelect={() => selectPlugin(plugin)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Sources sidebar */}
            {showSourcesSidebar && <MarketplaceSourcesPanel />}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-maestro-border px-4 py-2">
            <span className="text-[10px] text-maestro-muted">
              {filteredPlugins.length} plugin{filteredPlugins.length !== 1 ? "s" : ""} available
            </span>
            <span className="text-[10px] text-maestro-muted">
              Plugins are installed from their GitHub repositories
            </span>
          </div>
        </div>
      </div>

      {/* Install modal */}
      {installPlugin && (
        <PluginInstallModal
          plugin={installPlugin}
          onClose={() => setInstallPlugin(null)}
          onInstalled={handleInstalled}
          currentProjectPath={currentProjectPath}
        />
      )}
    </>
  );
}
