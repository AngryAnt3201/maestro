import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ChevronDown,
  GitBranch,
  GitMerge,
  Loader2,
  Minus,
  PanelLeft,
  Square,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useGitStore } from "../../stores/useGitStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { BranchDropdown } from "./BranchDropdown";
import { StatusLegend } from "./StatusLegend";

interface TopBarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  branchName?: string;
  repoPath?: string;
  onToggleGitPanel?: () => void;
  gitPanelOpen?: boolean;
  /** When true, hides window controls (minimize/maximize/close) - use when ProjectTabs provides them */
  hideWindowControls?: boolean;
  /** Called when branch is switched */
  onBranchChanged?: (newBranch: string) => void;
}

export function TopBar({
  sidebarOpen,
  onToggleSidebar,
  branchName,
  repoPath,
  onToggleGitPanel,
  gitPanelOpen,
  hideWindowControls = false,
  onBranchChanged,
}: TopBarProps) {
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  const { checkoutBranch, createBranch, fetchCurrentBranch } = useGitStore();

  const handleBranchSelect = useCallback(
    async (branch: string) => {
      if (!repoPath || branch === branchName) {
        setBranchDropdownOpen(false);
        return;
      }

      // Warn if there are active non-worktree sessions that share the main checkout
      const activeSessions = useSessionStore.getState().sessions.filter(
        (s) => s.project_path === repoPath && !s.worktree_path
      );
      if (activeSessions.length > 0) {
        const proceed = window.confirm(
          `Switching branches will affect ${activeSessions.length} active session(s) ` +
          `that share the main repository checkout.\n\nContinue?`
        );
        if (!proceed) {
          setBranchDropdownOpen(false);
          return;
        }
      }

      setIsSwitching(true);
      try {
        await checkoutBranch(repoPath, branch);
        // Refresh current branch and notify parent
        await fetchCurrentBranch(repoPath);
        onBranchChanged?.(branch);
        setBranchDropdownOpen(false);
      } catch (err) {
        console.error("Failed to switch branch:", err);
        // Show error to user
        window.alert(`Failed to switch to ${branch}: ${err}`);
      } finally {
        setIsSwitching(false);
      }
    },
    [repoPath, branchName, checkoutBranch, fetchCurrentBranch, onBranchChanged]
  );

  const handleCreateBranch = useCallback(
    async (name: string) => {
      if (!repoPath) return;

      await createBranch(repoPath, name);
      // After creation, switch to the new branch
      await handleBranchSelect(name);
    },
    [repoPath, createBranch, handleBranchSelect]
  );

  return (
    <div data-tauri-drag-region className="no-select flex h-10 flex-1 items-center bg-maestro-bg">
      {/* Left: collapse toggle (3D button) + branch area */}
      <div className="flex items-center gap-2 px-2">
        {/* Sidebar toggle - only shown when ProjectTabs isn't providing it */}
        {!hideWindowControls && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className={`rounded-md border px-1.5 py-1 shadow-sm transition-all active:translate-y-px active:shadow-none ${
              sidebarOpen
                ? "border-maestro-accent/30 bg-maestro-accent/10 text-maestro-accent hover:bg-maestro-accent/15"
                : "border-maestro-border bg-maestro-card text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text hover:shadow"
            }`}
            aria-label="Toggle sidebar"
          >
            <PanelLeft size={15} />
          </button>
        )}

        {/* Branch selector — wide area, embedded text with dropdown */}
        {branchName && repoPath && (
          <div className="relative">
            <button
              type="button"
              onClick={() => !isSwitching && setBranchDropdownOpen((p) => !p)}
              disabled={isSwitching}
              aria-haspopup="listbox"
              aria-expanded={branchDropdownOpen}
              aria-label="Select branch"
              className="flex items-center gap-1.5 rounded px-2 py-1 transition-colors hover:bg-maestro-card/50 disabled:opacity-70"
            >
              {isSwitching ? (
                <Loader2 size={13} className="animate-spin text-maestro-accent" />
              ) : (
                <GitBranch size={13} className="text-maestro-muted" />
              )}
              <span className="max-w-[200px] truncate text-xs font-medium text-maestro-text">
                {branchName}
              </span>
              <ChevronDown size={11} className="text-maestro-muted" />
            </button>

            {branchDropdownOpen && (
              <BranchDropdown
                repoPath={repoPath}
                currentBranch={branchName}
                onSelect={handleBranchSelect}
                onCreateBranch={handleCreateBranch}
                onClose={() => setBranchDropdownOpen(false)}
              />
            )}
          </div>
        )}
      </div>

      {/* Center: drag region */}
      <div data-tauri-drag-region className="flex-1" />

      {/* Right: status legend (embedded text, no button wrappers) */}
      <div className="mr-3">
        <StatusLegend />
      </div>

      {/* Right: action icons */}
      <div className="flex items-center gap-0.5 mr-1">
        <button
          type="button"
          onClick={onToggleGitPanel}
          className={`rounded p-1.5 transition-colors ${
            gitPanelOpen
              ? "text-maestro-accent hover:bg-maestro-accent/10"
              : "text-maestro-muted hover:bg-maestro-card hover:text-maestro-text"
          }`}
          aria-label="Git graph"
          title="Git Graph"
        >
          <GitMerge size={14} />
        </button>
      </div>

      {/* Window controls (scaled down ~15%) - only shown when not hidden */}
      {!hideWindowControls && (
        <div className="flex items-center border-l border-maestro-border">
          <button
            type="button"
            onClick={() => appWindow.minimize()}
            className="flex h-8 w-9 items-center justify-center text-maestro-muted transition-colors hover:bg-maestro-muted/10 hover:text-maestro-text"
            aria-label="Minimize"
          >
            <Minus size={12} />
          </button>
          <button
            type="button"
            onClick={() => appWindow.toggleMaximize()}
            className="flex h-8 w-9 items-center justify-center text-maestro-muted transition-colors hover:bg-maestro-muted/10 hover:text-maestro-text"
            aria-label="Maximize"
          >
            <Square size={10} />
          </button>
          <button
            type="button"
            onClick={() => appWindow.close()}
            className="flex h-8 w-9 items-center justify-center text-maestro-muted transition-colors hover:bg-maestro-red/80 hover:text-white"
            aria-label="Close"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
