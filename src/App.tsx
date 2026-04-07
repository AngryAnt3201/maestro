import { invoke } from "@tauri-apps/api/core";
import { GitFork, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getDeduplicatedCurrentBranch } from "@/lib/git";
import { killSession } from "@/lib/terminal";
import { useOpenProject } from "@/lib/useOpenProject";
import { useFDAStore } from "@/stores/useFDAStore";
import { useSessionStore } from "@/stores/useSessionStore";
import { useWorkspaceStore, type RepositoryInfo } from "@/stores/useWorkspaceStore";
import { useGitStore } from "./stores/useGitStore";
import { useTerminalSettingsStore } from "./stores/useTerminalSettingsStore";
import { useAppKeyboard } from "./hooks/useAppKeyboard";
import { useSwipeNavigation } from "./hooks/useSwipeNavigation";
import { useUpdateStore } from "./stores/useUpdateStore";
import { initActivityListener, stopActivityListener } from "./stores/useActivityStore";
import { UpdateNotification } from "./components/update/UpdateNotification";
import { GitGraphPanel } from "./components/git/GitGraphPanel";
import { BottomBar } from "./components/shared/BottomBar";
import { FDADialog } from "./components/shared/FDADialog";
import { MultiProjectView, type MultiProjectViewHandle } from "./components/shared/MultiProjectView";
import { MAC_TITLE_BAR_INSET_PX, useMacTitleBarPadding } from "@/hooks/useMacTitleBarPadding";
import { isMac } from "@/lib/platform";
import { ProjectTabs } from "./components/shared/ProjectTabs";
import { TopBar } from "./components/shared/TopBar";
import { Sidebar } from "./components/sidebar/Sidebar";

const DEFAULT_SESSION_COUNT = 6;

type Theme = "dark" | "light";

function isValidTheme(value: string | null): value is Theme {
  return value === "dark" || value === "light";
}

function App() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const selectTab = useWorkspaceStore((s) => s.selectTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const reorderTabs = useWorkspaceStore((s) => s.reorderTabs);
  const moveTab = useWorkspaceStore((s) => s.moveTab);
  const setSessionsLaunched = useWorkspaceStore((s) => s.setSessionsLaunched);
  const setSelectedRepo = useWorkspaceStore((s) => s.setSelectedRepo);
  const rehydrateRepositories = useWorkspaceStore((s) => s.rehydrateRepositories);
  const fetchSessions = useSessionStore((s) => s.fetchSessions);
  const initListeners = useSessionStore((s) => s.initListeners);
  const { openProject: handleOpenProject } = useOpenProject();
  const showFDADialog = useFDAStore((s) => s.showDialog);
  const fdaPath = useFDAStore((s) => s.pendingPath);
  const dismissFDADialog = useFDAStore((s) => s.dismiss);
  const dismissFDADialogPermanently = useFDAStore((s) => s.dismissPermanently);
  const retryAfterFDAGrant = useFDAStore((s) => s.retryAfterGrant);
  const multiProjectRef = useRef<MultiProjectViewHandle>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [gitPanelOpen, setGitPanelOpen] = useState(false);
  const [sessionCounts, setSessionCounts] = useState<Map<string, { slotCount: number; launchedCount: number }>>(new Map());
  const [isStoppingAll, setIsStoppingAll] = useState(false);
  const [currentBranch, setCurrentBranch] = useState<string | undefined>(undefined);
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("maestro-theme");
    return isValidTheme(stored) ? stored : "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("maestro-theme", theme);
  }, [theme]);

  // Tag the document with platform class so CSS can disable expensive effects
  // (e.g. box-shadow animations) that aren't GPU-accelerated on WebKitGTK/Linux.
  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("linux")) {
      document.documentElement.classList.add("platform-linux");
    }
  }, []);

  // Clean up orphaned PTY sessions on mount, then fetch fresh session state.
  // kill_all_sessions clears both ProcessManager (PTYs) and SessionManager
  // (metadata), so fetchSessions must run AFTER cleanup completes to avoid
  // loading stale "idle" sessions from a previous frontend lifecycle.
  useEffect(() => {
    invoke<number>("kill_all_sessions")
      .then((count) => {
        if (count > 0) {
          console.log(`Cleaned up ${count} orphaned PTY session(s) from previous page load`);
        }
      })
      .catch((err) => {
        console.error("Failed to clean up orphaned sessions:", err);
      })
      .finally(() => {
        fetchSessions().catch((err) => {
          console.error("Failed to fetch sessions:", err);
        });
      });

    const unlistenPromise = initListeners().catch((err) => {
      console.error("Failed to initialize listeners:", err);
      return () => {}; // no-op cleanup
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [fetchSessions, initListeners]);

  // Initialize terminal settings store (detects available fonts)
  const initializeTerminalSettings = useTerminalSettingsStore((s) => s.initialize);
  useEffect(() => {
    initializeTerminalSettings().catch((err) => {
      console.error("Failed to initialize terminal settings:", err);
    });
  }, [initializeTerminalSettings]);

  // Initialize update event listeners and auto-check
  const initUpdateListeners = useUpdateStore((s) => s.initListeners);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);
  const autoCheckEnabled = useUpdateStore((s) => s.autoCheckEnabled);
  const checkIntervalMinutes = useUpdateStore((s) => s.checkIntervalMinutes);

  useEffect(() => {
    const unlistenPromise = initUpdateListeners().catch((err) => {
      console.error("Failed to initialize update listeners:", err);
      return () => {};
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [initUpdateListeners]);

  // Initialize activity event listener (claude-event from transcript watcher)
  useEffect(() => {
    initActivityListener().catch((err) => {
      console.error("Failed to initialize activity listener:", err);
    });
    return () => {
      stopActivityListener();
    };
  }, []);

  useEffect(() => {
    if (!autoCheckEnabled) return;
    // Check on mount
    checkForUpdates();
    // Then periodically
    const interval = setInterval(checkForUpdates, checkIntervalMinutes * 60 * 1000);
    return () => clearInterval(interval);
  }, [autoCheckEnabled, checkIntervalMinutes, checkForUpdates]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  const macTitleBarPadding = useMacTitleBarPadding();
  const activeTab = tabs.find((tab) => tab.active) ?? null;
  const activeProjectPath = activeTab?.projectPath;
  const activeRepoPath = activeTab?.selectedRepoPath ?? activeProjectPath;

  // Trackpad two-finger horizontal swipe to switch project tabs
  const switchToNextTab = useCallback(() => {
    const idx = tabs.findIndex((t) => t.active);
    const next = tabs[(idx + 1) % tabs.length];
    if (next) selectTab(next.id);
  }, [tabs, selectTab]);

  const switchToPrevTab = useCallback(() => {
    const idx = tabs.findIndex((t) => t.active);
    const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
    if (prev) selectTab(prev.id);
  }, [tabs, selectTab]);

  useSwipeNavigation({
    onSwipeLeft: switchToNextTab,
    onSwipeRight: switchToPrevTab,
    enabled: tabs.length >= 2,
  });

  // Git store for commit count and refresh
  const { commits, fetchCommits } = useGitStore();
  const [isRefreshingGit, setIsRefreshingGit] = useState(false);

  const handleRefreshGit = useCallback(async () => {
    if (!activeRepoPath) return;
    setIsRefreshingGit(true);
    try {
      await fetchCommits(activeRepoPath);
    } finally {
      setIsRefreshingGit(false);
    }
  }, [activeRepoPath, fetchCommits]);

  useEffect(() => {
    let cancelled = false;
    if (!activeRepoPath) {
      setCurrentBranch(undefined);
      return () => {};
    }
    getDeduplicatedCurrentBranch(activeRepoPath)
      .then((branch) => {
        if (!cancelled) setCurrentBranch(branch);
      })
      .catch((err) => {
        console.error("Failed to load current branch:", err);
        if (!cancelled) setCurrentBranch(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [activeRepoPath]);

  // Rehydrate multi-repo tabs after store rehydration
  useEffect(() => {
    rehydrateRepositories().catch((err) => {
      console.error("Failed to rehydrate repositories:", err);
    });
  }, [rehydrateRepositories]);

  // Auto-refresh repos on window focus (with 2s debounce)
  useEffect(() => {
    let lastRefresh = 0;
    const COOLDOWN_MS = 2000;

    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefresh < COOLDOWN_MS) return;
      lastRefresh = now;

      const tab = useWorkspaceStore.getState().tabs.find((t) => t.active);
      if (!tab) return;

      if (tab.workspaceType === "multi-repo") {
        invoke<RepositoryInfo[]>("detect_repositories", { path: tab.projectPath })
          .then((repos) => {
            useWorkspaceStore.getState().updateRepositories(tab.id, repos);
          })
          .catch((err) => console.error("Failed to refresh repos on focus:", err));
      }

      // Refresh branch for the active repo
      const repoPath = tab.selectedRepoPath ?? tab.projectPath;
      if (repoPath) {
        getDeduplicatedCurrentBranch(repoPath)
          .then(setCurrentBranch)
          .catch(() => {});
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // Derive state from active tab
  const activeTabSessionsLaunched = activeTab?.sessionsLaunched ?? false;
  const activeTabCounts = activeTab ? sessionCounts.get(activeTab.id) : undefined;
  const activeTabSlotCount = activeTabCounts?.slotCount ?? 0;
  const activeTabLaunchedCount = activeTabCounts?.launchedCount ?? 0;

  // Cmd/Ctrl+T: add a new session slot in grid view
  const handleAddSessionShortcut = useCallback(() => {
    multiProjectRef.current?.addSessionToActiveProject();
  }, []);

  useAppKeyboard({
    onAddSession: handleAddSessionShortcut,
    canAddSession: activeTabSessionsLaunched,
  });

  // Handler to enter grid view for the active project
  const handleEnterGridView = () => {
    if (activeTab) {
      setSessionsLaunched(activeTab.id, true);
    }
  };

  const handleSessionCountChange = useCallback((tabId: string, slotCount: number, launchedCount: number) => {
    setSessionCounts((prev) => {
      const next = new Map(prev);
      next.set(tabId, { slotCount, launchedCount });
      return next;
    });
  }, []);

  const macTitleBarInset =
    isMac() && macTitleBarPadding ? `${MAC_TITLE_BAR_INSET_PX}px` : "0";

  return (
    <div
      className="flex h-screen w-screen flex-col bg-maestro-bg"
      style={{ ["--mac-title-bar-inset" as string]: macTitleBarInset }}
    >
      {/* Project tabs — full width at top (with window controls) */}
      <ProjectTabs
        tabs={tabs.map((t) => ({ id: t.id, name: t.name, active: t.active }))}
        onSelectTab={selectTab}
        onCloseTab={closeTab}
        onNewTab={handleOpenProject}
        onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        sidebarOpen={sidebarOpen}
        onReorderTab={reorderTabs}
        onMoveTab={moveTab}
      />

      {/* Main area: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — below project tabs */}
        <Sidebar
          collapsed={!sidebarOpen}
          onCollapse={() => setSidebarOpen(false)}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        {/* Right column: top bar + content + bottom bar */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Top bar row - includes git panel header when open */}
          <div className="flex h-10 shrink-0 bg-maestro-bg">
            {/* TopBar takes flex-1 to fill available space */}
            <TopBar
              sidebarOpen={sidebarOpen}
              onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
              branchName={currentBranch}
              repoPath={activeRepoPath}
              onToggleGitPanel={() => setGitPanelOpen((prev) => !prev)}
              gitPanelOpen={gitPanelOpen}
              hideWindowControls
              onBranchChanged={(newBranch) => {
                setCurrentBranch(newBranch);
                multiProjectRef.current?.refreshBranchesInActiveProject();
              }}
            />

            {/* Git panel header - inline at same level as TopBar */}
            {gitPanelOpen && (
              <div
                className="flex h-10 shrink-0 items-center border-l border-maestro-border px-3 gap-2 bg-maestro-bg"
                style={{ width: 560 }}
              >
                <GitFork size={14} className="text-maestro-muted" />
                {activeTab?.workspaceType === "multi-repo" && activeTab.selectedRepoPath && (
                  <span className="text-xs font-medium text-maestro-accent">
                    {activeTab.repositories.find((r) => r.path === activeTab.selectedRepoPath)?.name}
                  </span>
                )}
                <span className="text-sm font-medium text-maestro-text">Commits</span>
                {commits.length > 0 && (
                  <span className="rounded-full bg-maestro-accent/15 px-1.5 py-px text-[10px] font-medium text-maestro-accent">
                    {commits.length}
                  </span>
                )}
                <div className="flex-1" />
                {activeRepoPath && (
                  <button
                    type="button"
                    onClick={handleRefreshGit}
                    disabled={isRefreshingGit}
                    className="rounded p-1 text-maestro-muted transition-colors hover:bg-maestro-card hover:text-maestro-text disabled:opacity-50"
                    aria-label="Refresh commits"
                  >
                    <RefreshCw size={14} className={isRefreshingGit ? "animate-spin" : ""} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setGitPanelOpen(false)}
                  className="rounded p-1 text-maestro-muted transition-colors hover:bg-maestro-card hover:text-maestro-text"
                  aria-label="Close git panel"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          {/* Content area (main + optional git panel) */}
          <div className="flex flex-1 overflow-hidden">
            {/* Main content - MultiProjectView keeps all projects alive */}
            <main className="relative flex-1 overflow-hidden bg-maestro-bg">
              <MultiProjectView
                ref={multiProjectRef}
                onSessionCountChange={handleSessionCountChange}
              />
            </main>

            {/* Git graph panel (optional right side) */}
            <GitGraphPanel
              open={gitPanelOpen}
              onClose={() => setGitPanelOpen(false)}
              repoPath={activeRepoPath ?? null}
              currentBranch={currentBranch ?? null}
              repositories={activeTab?.repositories ?? []}
              workspaceType={activeTab?.workspaceType ?? "single-repo"}
              onRepoChange={(path) => activeTab && setSelectedRepo(activeTab.id, path)}
            />
          </div>

          {/* Bottom action bar */}
          <div className="bg-maestro-bg">
            <BottomBar
              inGridView={activeTabSessionsLaunched}
              slotCount={activeTabSlotCount}
              launchedCount={activeTabLaunchedCount}
              maxSessions={DEFAULT_SESSION_COUNT}
              isStoppingAll={isStoppingAll}
              onSelectDirectory={handleOpenProject}
              onLaunchAll={() => {
                if (!activeTabSessionsLaunched && activeTab) {
                  // First enter grid view, then launch
                  handleEnterGridView();
                }
                multiProjectRef.current?.launchAllInActiveProject();
              }}
              onAddSession={() => multiProjectRef.current?.addSessionToActiveProject()}
              onStopAll={async () => {
                if (!activeTab || isStoppingAll) return;
                setIsStoppingAll(true);
                try {
                  // Kill all running PTY sessions for this project
                  const sessionStore = useSessionStore.getState();
                  const projectSessions = sessionStore.getSessionsByProject(activeTab.projectPath);
                  const results = await Promise.allSettled(projectSessions.map((s) => killSession(s.id)));
                  for (const result of results) {
                    if (result.status === "rejected") {
                      console.error("Failed to stop session:", result.reason);
                    }
                  }
                  // Remove sessions from backend and local store
                  await sessionStore.removeSessionsForProject(activeTab.projectPath);
                  setSessionsLaunched(activeTab.id, false);
                  setSessionCounts((prev) => {
                    const next = new Map(prev);
                    next.set(activeTab.id, { slotCount: 0, launchedCount: 0 });
                    return next;
                  });
                } finally {
                  setIsStoppingAll(false);
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* FDA Dialog for macOS TCC-protected paths */}
      {showFDADialog && (
        <FDADialog
          path={fdaPath}
          onDismiss={dismissFDADialog}
          onDismissPermanently={dismissFDADialogPermanently}
          onRetry={retryAfterFDAGrant}
        />
      )}

      <UpdateNotification />
    </div>
  );
}

export default App;
