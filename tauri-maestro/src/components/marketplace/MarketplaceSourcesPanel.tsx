import { useMarketplaceStore } from "@/stores/useMarketplaceStore";
import {
  AlertCircle,
  Check,
  ExternalLink,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";

export function MarketplaceSourcesPanel() {
  const {
    sources,
    addSource,
    removeSource,
    toggleSource,
    refreshSource,
    isRefreshing,
  } = useMarketplaceStore();

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleAddSource = async () => {
    if (!newName.trim() || !newUrl.trim()) return;

    await addSource(newName.trim(), newUrl.trim());
    setNewName("");
    setNewUrl("");
    setShowAddForm(false);
  };

  const handleDelete = async (sourceId: string) => {
    await removeSource(sourceId);
    setDeleteConfirmId(null);
  };

  return (
    <div className="flex h-full w-72 flex-col border-l border-maestro-border bg-maestro-bg">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-maestro-border px-3 py-2">
        <h3 className="text-xs font-semibold text-maestro-text">Sources</h3>
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="rounded p-1 text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="border-b border-maestro-border p-3">
          <div className="mb-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Source name"
              className="w-full rounded border border-maestro-border bg-maestro-surface px-2 py-1.5 text-xs text-maestro-text placeholder:text-maestro-muted focus:border-maestro-accent focus:outline-none"
              autoFocus
            />
          </div>
          <div className="mb-2">
            <input
              type="text"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="w-full rounded border border-maestro-border bg-maestro-surface px-2 py-1.5 text-xs text-maestro-text placeholder:text-maestro-muted focus:border-maestro-accent focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setNewName("");
                setNewUrl("");
              }}
              className="rounded px-2 py-1 text-[10px] text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAddSource}
              disabled={!newName.trim() || !newUrl.trim()}
              className="rounded bg-maestro-accent px-2 py-1 text-[10px] text-white hover:bg-maestro-accent/80 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Sources list */}
      <div className="flex-1 overflow-y-auto">
        {sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <p className="mb-2 text-xs text-maestro-muted">No marketplace sources</p>
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="rounded bg-maestro-accent px-3 py-1.5 text-xs text-white hover:bg-maestro-accent/80"
            >
              Add Source
            </button>
          </div>
        ) : (
          <div className="divide-y divide-maestro-border">
            {sources.map((source) => (
              <div
                key={source.id}
                className={`p-3 ${!source.is_enabled ? "opacity-50" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-medium text-maestro-text">
                        {source.name}
                      </span>
                      {source.is_official && (
                        <span className="shrink-0 rounded-full bg-maestro-accent/10 px-1.5 py-0.5 text-[8px] text-maestro-accent">
                          Official
                        </span>
                      )}
                    </div>
                    <a
                      href={source.repository_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center gap-1 text-[10px] text-maestro-muted hover:text-maestro-accent"
                    >
                      <span className="truncate">
                        {source.repository_url.replace("https://github.com/", "")}
                      </span>
                      <ExternalLink size={8} className="shrink-0 opacity-0 group-hover:opacity-100" />
                    </a>
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => refreshSource(source.id)}
                      disabled={isRefreshing}
                      className="rounded p-1 text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text disabled:opacity-50"
                      title="Refresh"
                    >
                      <RefreshCw
                        size={12}
                        className={isRefreshing ? "animate-spin" : ""}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleSource(source.id)}
                      className={`rounded p-1 ${
                        source.is_enabled
                          ? "text-green-400 hover:bg-green-500/10"
                          : "text-maestro-muted hover:bg-maestro-surface"
                      }`}
                      title={source.is_enabled ? "Disable" : "Enable"}
                    >
                      <Check size={12} />
                    </button>
                    {!source.is_official && (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(source.id)}
                        className="rounded p-1 text-maestro-muted hover:bg-red-500/10 hover:text-red-400"
                        title="Remove"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Status */}
                <div className="mt-1.5 flex items-center gap-2 text-[10px]">
                  {source.last_error ? (
                    <span className="flex items-center gap-1 text-red-400">
                      <AlertCircle size={10} />
                      {source.last_error}
                    </span>
                  ) : source.last_fetched ? (
                    <span className="text-maestro-muted">
                      Last updated: {new Date(source.last_fetched).toLocaleDateString()}
                    </span>
                  ) : (
                    <span className="text-maestro-muted">Never fetched</span>
                  )}
                </div>

                {/* Delete confirmation */}
                {deleteConfirmId === source.id && (
                  <div className="mt-2 flex items-center gap-2 rounded bg-red-500/10 p-2">
                    <span className="flex-1 text-[10px] text-red-400">
                      Remove this source?
                    </span>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmId(null)}
                      className="rounded px-2 py-0.5 text-[10px] text-maestro-muted hover:bg-maestro-surface"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(source.id)}
                      className="rounded bg-red-500 px-2 py-0.5 text-[10px] text-white hover:bg-red-600"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
