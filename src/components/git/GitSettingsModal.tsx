import {
  Check,
  Edit2,
  FolderSearch,
  GitBranch,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGitStore } from "@/stores/useGitStore";
import { useWorkspaceStore, type RepositoryInfo } from "@/stores/useWorkspaceStore";
import { RemoteStatusIndicator } from "./RemoteStatusIndicator";

interface GitSettingsModalProps {
  repoPath: string;
  tabId: string;
  onClose: () => void;
}

/**
 * Modal for managing Git repository settings:
 * - User Identity (name/email)
 * - Remotes (add/edit/delete with connection testing)
 * - Default Branch configuration
 */
export function GitSettingsModal({ repoPath, tabId, onClose }: GitSettingsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        ref={modalRef}
        className="w-full max-w-md rounded-lg border border-maestro-border bg-maestro-bg shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-maestro-border px-4 py-3">
          <h2 className="text-sm font-semibold text-maestro-text">Git Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-maestro-border/40"
          >
            <X size={16} className="text-maestro-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
          <UserIdentitySection repoPath={repoPath} />
          <RepositoryDiscoverySection repoPath={repoPath} tabId={tabId} />
          <RemotesSection repoPath={repoPath} />
          <DefaultBranchSection repoPath={repoPath} />
        </div>
      </div>
    </div>
  );
}

/* ── User Identity Section ── */

function UserIdentitySection({ repoPath }: { repoPath: string }) {
  const { userConfig, fetchUserConfig, setUserConfig } = useGitStore();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [global, setGlobal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetchUserConfig(repoPath);
  }, [repoPath, fetchUserConfig]);

  useEffect(() => {
    if (userConfig) {
      setName(userConfig.name ?? "");
      setEmail(userConfig.email ?? "");
      setDirty(false);
    }
  }, [userConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setUserConfig(repoPath, name || null, email || null, global);
      setDirty(false);
    } catch {
      // Error is logged in store
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    setDirty(true);
  };

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-maestro-muted">
        User Identity
      </h3>
      <div className="space-y-2 rounded-lg border border-maestro-border bg-maestro-card p-3">
        <div className="flex items-center gap-2">
          <User size={14} className="text-maestro-muted shrink-0" />
          <input
            type="text"
            value={name}
            onChange={handleChange(setName)}
            placeholder="Name"
            className="flex-1 bg-transparent text-xs text-maestro-text placeholder:text-maestro-muted focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <Mail size={14} className="text-maestro-muted shrink-0" />
          <input
            type="email"
            value={email}
            onChange={handleChange(setEmail)}
            placeholder="Email"
            className="flex-1 bg-transparent text-xs text-maestro-text placeholder:text-maestro-muted focus:outline-none"
          />
        </div>
        <div className="flex items-center justify-between pt-1">
          <label className="flex items-center gap-2 text-xs text-maestro-muted">
            <input
              type="checkbox"
              checked={global}
              onChange={(e) => setGlobal(e.target.checked)}
              className="h-3 w-3 rounded border-maestro-border"
            />
            Apply globally
          </label>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-maestro-accent hover:bg-maestro-accent/10 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Save
          </button>
        </div>
      </div>
    </section>
  );
}

/* ── Repository Discovery Section ── */

function RepositoryDiscoverySection({ repoPath, tabId }: { repoPath: string; tabId: string }) {
  const [scanning, setScanning] = useState(false);
  const [repositories, setRepositories] = useState<RepositoryInfo[]>([]);
  const [hasScanned, setHasScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateRepositories = useWorkspaceStore((s) => s.updateRepositories);

  // Format remote URL for display (shorten GitHub URLs)
  const formatRemoteUrl = (url: string) => {
    // git@github.com:user/repo.git -> github.com/user/repo
    // https://github.com/user/repo.git -> github.com/user/repo
    const match = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (match) {
      return `github.com/${match[1]}`;
    }
    // For other URLs, just show the host/path
    try {
      const parsed = new URL(url.replace(/^git@/, "https://").replace(/:(?!\/\/)/, "/"));
      return `${parsed.host}${parsed.pathname.replace(/\.git$/, "")}`;
    } catch {
      return url;
    }
  };

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const repos = await invoke<RepositoryInfo[]>("detect_repositories", { path: repoPath });
      setRepositories(repos);
      setHasScanned(true);
      // Update the workspace store with found repositories
      if (tabId) {
        updateRepositories(tabId, repos);
      }
    } catch (err) {
      console.error("Failed to scan for repositories:", err);
      setError(err instanceof Error ? err.message : "Failed to scan for repositories");
    } finally {
      setScanning(false);
    }
  };

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-maestro-muted">
        Repository Discovery
      </h3>
      <div className="space-y-2 rounded-lg border border-maestro-border bg-maestro-card p-3">
        <p className="text-xs text-maestro-muted">
          Scan this workspace for nested git repositories.
        </p>

        <button
          type="button"
          onClick={handleScan}
          disabled={scanning}
          className="flex items-center gap-2 rounded px-3 py-1.5 text-xs font-medium bg-maestro-accent/10 text-maestro-accent hover:bg-maestro-accent/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {scanning ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <FolderSearch size={14} />
          )}
          {scanning ? "Scanning..." : "Scan for Repositories"}
        </button>

        {error && (
          <p className="text-xs text-maestro-red">{error}</p>
        )}

        {hasScanned && !error && (
          <div className="pt-2 border-t border-maestro-border">
            <p className="text-xs font-medium text-maestro-text mb-2">
              Found {repositories.length} {repositories.length === 1 ? "repository" : "repositories"}:
            </p>
            {repositories.length === 0 ? (
              <p className="text-xs text-maestro-muted">No git repositories found in this directory.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {repositories.map((repo) => (
                  <div
                    key={repo.path}
                    className="text-xs text-maestro-text py-1"
                  >
                    <div className="flex items-center gap-2">
                      <GitBranch size={12} className="text-maestro-green shrink-0" />
                      <span className="font-medium truncate">{repo.name}</span>
                      {repo.currentBranch && (
                        <span className="text-maestro-muted">({repo.currentBranch})</span>
                      )}
                    </div>
                    {repo.remoteUrl && (
                      <div className="pl-5 text-[11px] text-maestro-muted truncate" title={repo.remoteUrl}>
                        {formatRemoteUrl(repo.remoteUrl)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Remotes Section ── */

function RemotesSection({ repoPath }: { repoPath: string }) {
  const { remotes, remoteStatuses, fetchRemotes, addRemote, removeRemote, setRemoteUrl, testRemote, testAllRemotes } =
    useGitStore();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingRemote, setEditingRemote] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState("");

  useEffect(() => {
    fetchRemotes(repoPath);
  }, [repoPath, fetchRemotes]);

  // Test all remotes on initial load
  useEffect(() => {
    if (remotes.length > 0) {
      testAllRemotes(repoPath);
    }
  }, [remotes.length, repoPath, testAllRemotes]);

  const handleAdd = async () => {
    if (!newName.trim() || !newUrl.trim()) return;
    setAdding(true);
    try {
      await addRemote(repoPath, newName.trim(), newUrl.trim());
      setNewName("");
      setNewUrl("");
      setShowAdd(false);
    } catch {
      // Error logged in store
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (name: string) => {
    try {
      await removeRemote(repoPath, name);
    } catch {
      // Error logged in store
    }
  };

  const handleEditStart = (name: string, url: string) => {
    setEditingRemote(name);
    setEditUrl(url);
  };

  const handleEditSave = async () => {
    if (!editingRemote || !editUrl.trim()) return;
    try {
      await setRemoteUrl(repoPath, editingRemote, editUrl.trim());
      setEditingRemote(null);
      setEditUrl("");
    } catch {
      // Error logged in store
    }
  };

  const handleEditCancel = () => {
    setEditingRemote(null);
    setEditUrl("");
  };

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-maestro-muted">
          Remotes
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => testAllRemotes(repoPath)}
            className="rounded p-1 hover:bg-maestro-border/40"
            title="Test all connections"
          >
            <RefreshCw size={12} className="text-maestro-muted" />
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="rounded p-1 hover:bg-maestro-border/40"
            title="Add remote"
          >
            <Plus size={12} className="text-maestro-muted" />
          </button>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-maestro-border bg-maestro-card p-3">
        {remotes.length === 0 && !showAdd && (
          <p className="text-xs text-maestro-muted">No remotes configured</p>
        )}

        {remotes.map((remote) => (
          <div key={remote.name} className="group">
            {editingRemote === remote.name ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-maestro-text">{remote.name}</span>
                </div>
                <input
                  type="text"
                  value={editUrl}
                  onChange={(e) => setEditUrl(e.target.value)}
                  placeholder="URL"
                  className="w-full rounded border border-maestro-border bg-maestro-bg px-2 py-1 text-xs text-maestro-text placeholder:text-maestro-muted focus:outline-none focus:border-maestro-accent"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleEditSave();
                    if (e.key === "Escape") handleEditCancel();
                  }}
                />
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={handleEditCancel}
                    className="rounded px-2 py-1 text-xs text-maestro-muted hover:bg-maestro-border/40"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleEditSave}
                    className="rounded px-2 py-1 text-xs text-maestro-accent hover:bg-maestro-accent/10"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <RemoteStatusIndicator status={remoteStatuses[remote.name] ?? "unknown"} />
                  <span className="text-xs font-semibold text-maestro-text">{remote.name}</span>
                  <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => testRemote(repoPath, remote.name)}
                      className="rounded p-1 hover:bg-maestro-border/40"
                      title="Test connection"
                    >
                      <RefreshCw size={10} className="text-maestro-muted" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEditStart(remote.name, remote.url)}
                      className="rounded p-1 hover:bg-maestro-border/40"
                      title="Edit remote"
                    >
                      <Edit2 size={10} className="text-maestro-muted" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(remote.name)}
                      className="rounded p-1 hover:bg-maestro-border/40"
                      title="Remove remote"
                    >
                      <Trash2 size={10} className="text-maestro-red" />
                    </button>
                  </div>
                </div>
                <div className="pl-5 text-[11px] text-maestro-muted truncate">{remote.url}</div>
              </>
            )}
          </div>
        ))}

        {showAdd && (
          <div className="space-y-2 border-t border-maestro-border pt-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Remote name (e.g., origin)"
              className="w-full rounded border border-maestro-border bg-maestro-bg px-2 py-1 text-xs text-maestro-text placeholder:text-maestro-muted focus:outline-none focus:border-maestro-accent"
              autoFocus
            />
            <input
              type="text"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="URL (e.g., git@github.com:user/repo.git)"
              className="w-full rounded border border-maestro-border bg-maestro-bg px-2 py-1 text-xs text-maestro-text placeholder:text-maestro-muted focus:outline-none focus:border-maestro-accent"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
                if (e.key === "Escape") setShowAdd(false);
              }}
            />
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="rounded px-2 py-1 text-xs text-maestro-muted hover:bg-maestro-border/40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={adding || !newName.trim() || !newUrl.trim()}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-maestro-accent hover:bg-maestro-accent/10 disabled:opacity-50"
              >
                {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                Add
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Default Branch Section ── */

function DefaultBranchSection({ repoPath }: { repoPath: string }) {
  const { defaultBranch, fetchDefaultBranch, setDefaultBranch } = useGitStore();
  const [branch, setBranch] = useState("");
  const [global, setGlobal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const presets = ["main", "master", "develop"];

  useEffect(() => {
    fetchDefaultBranch(repoPath);
  }, [repoPath, fetchDefaultBranch]);

  useEffect(() => {
    if (defaultBranch !== null) {
      setBranch(defaultBranch);
      setDirty(false);
    }
  }, [defaultBranch]);

  const handleSave = async () => {
    if (!branch.trim()) return;
    setSaving(true);
    try {
      await setDefaultBranch(repoPath, branch.trim(), global);
      setDirty(false);
    } catch {
      // Error logged in store
    } finally {
      setSaving(false);
    }
  };

  const handlePresetClick = (preset: string) => {
    setBranch(preset);
    setDirty(true);
  };

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-maestro-muted">
        Default Branch
      </h3>
      <div className="space-y-2 rounded-lg border border-maestro-border bg-maestro-card p-3">
        <input
          type="text"
          value={branch}
          onChange={(e) => {
            setBranch(e.target.value);
            setDirty(true);
          }}
          placeholder="Branch name"
          className="w-full bg-transparent text-xs text-maestro-text placeholder:text-maestro-muted focus:outline-none"
        />
        <div className="flex flex-wrap gap-1">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => handlePresetClick(preset)}
              className={`rounded px-2 py-0.5 text-[11px] ${
                branch === preset
                  ? "bg-maestro-accent/20 text-maestro-accent"
                  : "bg-maestro-border/40 text-maestro-muted hover:bg-maestro-border"
              }`}
            >
              {preset}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between pt-1">
          <label className="flex items-center gap-2 text-xs text-maestro-muted">
            <input
              type="checkbox"
              checked={global}
              onChange={(e) => setGlobal(e.target.checked)}
              className="h-3 w-3 rounded border-maestro-border"
            />
            Apply globally
          </label>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving || !branch.trim()}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-maestro-accent hover:bg-maestro-accent/10 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Save
          </button>
        </div>
      </div>
    </section>
  );
}
