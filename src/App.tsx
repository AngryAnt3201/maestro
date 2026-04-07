import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { getDeduplicatedCurrentBranch } from "@/lib/git";
import { killSession } from "@/lib/terminal";
import { useOpenProject } from "@/lib/useOpenProject";
import { useFDAStore } from "@/stores/useFDAStore";
import { useSessionStore } from "@/stores/useSessionStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { useTerminalSettingsStore } from "./stores/useTerminalSettingsStore";
import { useAppKeyboard } from "./hooks/useAppKeyboard";
import { useSwipeNavigation } from "./hooks/useSwipeNavigation";
import { useUpdateStore } from "./stores/useUpdateStore";
import { initActivityListener, stopActivityListener } from "./stores/useActivityStore";
import { UpdateNotification } from "./components/update/UpdateNotification";
import { BottomBar } from "./components/shared/BottomBar";
import { FDADialog } from "./components/shared/FDADialog";
import { MultiProjectView, type MultiProjectViewHandle } from "./components/shared/MultiProjectView";
import { MAC_TITLE_BAR_INSET_PX, useMacTitleBarPadding } from "@/hooks/useMacTitleBarPadding";
import { isMac } from "@/lib/platform";
import { ProjectTabs } from "./components/shared/ProjectTabs";
import { RightPanel } from "./components/shared/RightPanel";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";
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
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
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

  // Cmd/Ctrl+T: add a new session slot in grid view
  const handleAddSessionShortcut = useCallback(() => {
    multiProjectRef.current?.addSessionToActiveProject();
  }, []);

  useAppKeyboard({
    onAddSession: handleAddSessionShortcut,
    canAddSession: activeTabSessionsLaunched,
    onCycleNextProject: switchToNextTab,
    onCyclePrevProject: switchToPrevTab,
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
      className="flex h-screen w-screen flex-col overflow-hidden bg-maestro-bg"
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
        onToggleRightPanel={() => setRightPanelOpen((prev) => !prev)}
        rightPanelOpen={rightPanelOpen}
      />

      {/* Main area: sidebar + content + right panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — below project tabs */}
        <Sidebar
          collapsed={!sidebarOpen}
          onCollapse={() => setSidebarOpen(false)}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        {/* Center column: content + bottom bar */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <main className="relative flex-1 overflow-hidden bg-maestro-bg">
            <ErrorBoundary>
              <MultiProjectView
                ref={multiProjectRef}
                onSessionCountChange={handleSessionCountChange}
              />
            </ErrorBoundary>
          </main>

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

        {/* Right panel */}
        <RightPanel
          collapsed={!rightPanelOpen}
          onCollapse={() => setRightPanelOpen(false)}
          branchName={currentBranch}
          repoPath={activeTab ? activeTab.projectPath : undefined}
          onBranchChanged={(newBranch) => {
            setCurrentBranch(newBranch);
            multiProjectRef.current?.refreshBranchesInActiveProject();
          }}
          currentBranch={currentBranch}
          onFocusSession={(sessionId) => {
            multiProjectRef.current?.focusSessionInActiveProject(sessionId);
          }}
          onLaunchSession={(branch, worktreePath) => {
            if (activeTab && !activeTabSessionsLaunched) {
              setSessionsLaunched(activeTab.id, true);
            }
            multiProjectRef.current?.addSessionWithConfigToActiveProject(branch, worktreePath);
          }}
        />
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
