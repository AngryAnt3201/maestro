import { invoke } from "@tauri-apps/api/core";
import { GitFork, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getDeduplicatedCurrentBranch } from "@/lib/git";
import { killSession } from "@/lib/terminal";
import { useOpenProject } from "@/lib/useOpenProject";
import { useSessionStore } from "@/stores/useSessionStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { useGitStore } from "./stores/useGitStore";
import { useTerminalSettingsStore } from "./stores/useTerminalSettingsStore";
import { GitGraphPanel } from "./components/git/GitGraphPanel";
import { BottomBar } from "./components/shared/BottomBar";
import { FDADialog } from "./components/shared/FDADialog";
import { MultiProjectView, type MultiProjectViewHandle } from "./components/shared/MultiProjectView";
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
  const setSessionsLaunched = useWorkspaceStore((s) => s.setSessionsLaunched);
  const fetchSessions = useSessionStore((s) => s.fetchSessions);
  const initListeners = useSessionStore((s) => s.initListeners);
  const {
    openProject: handleOpenProject,
    showFDADialog,
    fdaPath,
    dismissFDADialog,
    dismissFDADialogPermanently,
    retryAfterFDAGrant,
  } = useOpenProject();
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

  // Clean up orphaned PTY sessions on mount (e.g., after page reload)
  // This ensures no stale processes remain from the previous frontend state
  useEffect(() => {
    invoke<number>("kill_all_sessions")
      .then((count) => {
        if (count > 0) {
          console.log(`Cleaned up ${count} orphaned PTY session(s) from previous page load`);
        }
      })
      .catch((err) => {
        console.error("Failed to clean up orphaned sessions:", err);
      });
  }, []);

  // Initialize session store: fetch initial state and subscribe to events
  useEffect(() => {
    fetchSessions().catch((err) => {
      console.error("Failed to fetch sessions:", err);
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

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  const activeTab = tabs.find((tab) => tab.active) ?? null;
  const activeProjectPath = activeTab?.projectPath;

  // Git store for commit count and refresh
  const { commits, fetchCommits } = useGitStore();
  const [isRefreshingGit, setIsRefreshingGit] = useState(false);

  const handleRefreshGit = useCallback(async () => {
    if (!activeProjectPath) return;
    setIsRefreshingGit(true);
    try {
      await fetchCommits(activeProjectPath);
    } finally {
      setIsRefreshingGit(false);
    }
  }, [activeProjectPath, fetchCommits]);

  useEffect(() => {
    let cancelled = false;
    if (!activeProjectPath) {
      setCurrentBranch(undefined);
      return () => {};
    }
    getDeduplicatedCurrentBranch(activeProjectPath)
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
  }, [activeProjectPath]);

  // Derive state from active tab
  const activeTabSessionsLaunched = activeTab?.sessionsLaunched ?? false;
  const activeTabCounts = activeTab ? sessionCounts.get(activeTab.id) : undefined;
  const activeTabSlotCount = activeTabCounts?.slotCount ?? 0;
  const activeTabLaunchedCount = activeTabCounts?.launchedCount ?? 0;

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

  return (
    <div className="flex h-screen w-screen flex-col bg-maestro-bg">
      {/* Project tabs — full width at top (with window controls) */}
      <ProjectTabs
        tabs={tabs.map((t) => ({ id: t.id, name: t.name, active: t.active }))}
        onSelectTab={selectTab}
        onCloseTab={closeTab}
        onNewTab={handleOpenProject}
        onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        sidebarOpen={sidebarOpen}
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
              repoPath={activeTab ? activeTab.projectPath : undefined}
              onToggleGitPanel={() => setGitPanelOpen((prev) => !prev)}
              gitPanelOpen={gitPanelOpen}
              hideWindowControls
              onBranchChanged={(newBranch) => setCurrentBranch(newBranch)}
            />

            {/* Git panel header - inline at same level as TopBar */}
            {gitPanelOpen && (
              <div
                className="flex h-10 shrink-0 items-center border-l border-maestro-border px-3 gap-2 bg-maestro-bg"
                style={{ width: 560 }}
              >
                <GitFork size={14} className="text-maestro-muted" />
                <span className="text-sm font-medium text-maestro-text">Commits</span>
                {commits.length > 0 && (
                  <span className="rounded-full bg-maestro-accent/15 px-1.5 py-px text-[10px] font-medium text-maestro-accent">
                    {commits.length}
                  </span>
                )}
                <div className="flex-1" />
                {activeProjectPath && (
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
              repoPath={activeProjectPath ?? null}
              currentBranch={currentBranch ?? null}
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
    </div>
  );
}

export default App;
