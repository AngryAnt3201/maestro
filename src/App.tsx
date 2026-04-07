import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { getDeduplicatedCurrentBranch } from "@/lib/git";
import { killSession } from "@/lib/terminal";
import { useOpenProject } from "@/lib/useOpenProject";
import { useFDAStore } from "@/stores/useFDAStore";
import { useSessionStore } from "@/stores/useSessionStore";
import { useLayoutStore } from "@/stores/useLayoutStore";
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
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 320;
const SIDEBAR_COLLAPSE_THRESHOLD = 60;
const SIDEBAR_WIDTH_STEP = 4;
const RIGHT_PANEL_MIN_WIDTH = 200;
const RIGHT_PANEL_MAX_WIDTH = SIDEBAR_MAX_WIDTH * 2;
const RIGHT_PANEL_COLLAPSE_THRESHOLD = 60;
const RIGHT_PANEL_WIDTH_STEP = 4;

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
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth);
  const setSidebarWidth = useLayoutStore((s) => s.setSidebarWidth);
  const rightPanelWidth = useLayoutStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useLayoutStore((s) => s.setRightPanelWidth);
  const rightPanelOpen = useLayoutStore((s) => s.rightPanelOpen);
  const toggleRightPanel = useLayoutStore((s) => s.toggleRightPanel);
  const setRightPanelOpen = useLayoutStore((s) => s.setRightPanelOpen);
  const [isSidebarDragging, setIsSidebarDragging] = useState(false);
  const sidebarDragStartRef = useRef<{ x: number; w: number } | null>(null);
  const [isRightPanelDragging, setIsRightPanelDragging] = useState(false);
  const rightPanelDragStartRef = useRef<{ x: number; w: number } | null>(null);
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

  const clampSidebarWidth = useCallback((value: number) => {
    const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value));
    const snapped = Math.round(clamped / SIDEBAR_WIDTH_STEP) * SIDEBAR_WIDTH_STEP;
    return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, snapped));
  }, []);

  const handleSidebarResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      sidebarDragStartRef.current = { x: e.clientX, w: sidebarWidth };
      setIsSidebarDragging(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    [sidebarWidth],
  );

  const handleSidebarResizeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      let next = sidebarWidth;
      const smallStep = 8;
      const largeStep = 24;

      switch (e.key) {
        case "ArrowLeft":
          next = sidebarWidth - smallStep;
          break;
        case "ArrowRight":
          next = sidebarWidth + smallStep;
          break;
        case "PageDown":
          next = sidebarWidth - largeStep;
          break;
        case "PageUp":
          next = sidebarWidth + largeStep;
          break;
        case "Home":
          next = SIDEBAR_MIN_WIDTH;
          break;
        case "End":
          next = SIDEBAR_MAX_WIDTH;
          break;
        default:
          return;
      }

      e.preventDefault();
      if (next < SIDEBAR_COLLAPSE_THRESHOLD) {
        setSidebarOpen(false);
        return;
      }
      setSidebarWidth(clampSidebarWidth(next));
    },
    [sidebarWidth, clampSidebarWidth, setSidebarWidth],
  );

  useEffect(() => {
    if (!isSidebarDragging) return;

    const onMove = (e: PointerEvent) => {
      if (!sidebarDragStartRef.current) return;
      const raw = sidebarDragStartRef.current.w + (e.clientX - sidebarDragStartRef.current.x);
      if (raw < SIDEBAR_COLLAPSE_THRESHOLD) {
        setSidebarOpen(false);
        setIsSidebarDragging(false);
        sidebarDragStartRef.current = null;
        return;
      }
      setSidebarWidth(clampSidebarWidth(raw));
    };

    const onUp = () => {
      setIsSidebarDragging(false);
      sidebarDragStartRef.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isSidebarDragging, clampSidebarWidth, setSidebarWidth]);

  const clampRightPanelWidth = useCallback((value: number) => {
    const clamped = Math.min(RIGHT_PANEL_MAX_WIDTH, Math.max(RIGHT_PANEL_MIN_WIDTH, value));
    const snapped = Math.round(clamped / RIGHT_PANEL_WIDTH_STEP) * RIGHT_PANEL_WIDTH_STEP;
    return Math.min(RIGHT_PANEL_MAX_WIDTH, Math.max(RIGHT_PANEL_MIN_WIDTH, snapped));
  }, []);

  const handleRightPanelResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      rightPanelDragStartRef.current = { x: e.clientX, w: rightPanelWidth };
      setIsRightPanelDragging(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    [rightPanelWidth],
  );

  const handleRightPanelResizeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      let next = rightPanelWidth;
      const smallStep = 8;
      const largeStep = 24;

      switch (e.key) {
        case "ArrowLeft":
          next = rightPanelWidth + smallStep;
          break;
        case "ArrowRight":
          next = rightPanelWidth - smallStep;
          break;
        case "PageUp":
          next = rightPanelWidth + largeStep;
          break;
        case "PageDown":
          next = rightPanelWidth - largeStep;
          break;
        case "Home":
          next = RIGHT_PANEL_MAX_WIDTH;
          break;
        case "End":
          next = RIGHT_PANEL_MIN_WIDTH;
          break;
        default:
          return;
      }

      e.preventDefault();
      if (next < RIGHT_PANEL_COLLAPSE_THRESHOLD) {
        setRightPanelOpen(false);
        return;
      }
      setRightPanelWidth(clampRightPanelWidth(next));
    },
    [rightPanelWidth, clampRightPanelWidth, setRightPanelOpen, setRightPanelWidth],
  );

  useEffect(() => {
    if (!isRightPanelDragging) return;

    const onMove = (e: PointerEvent) => {
      if (!rightPanelDragStartRef.current) return;
      const raw = rightPanelDragStartRef.current.w - (e.clientX - rightPanelDragStartRef.current.x);
      if (raw < RIGHT_PANEL_COLLAPSE_THRESHOLD) {
        setRightPanelOpen(false);
        setIsRightPanelDragging(false);
        rightPanelDragStartRef.current = null;
        return;
      }
      setRightPanelWidth(clampRightPanelWidth(raw));
    };

    const onUp = () => {
      setIsRightPanelDragging(false);
      rightPanelDragStartRef.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isRightPanelDragging, clampRightPanelWidth, setRightPanelOpen, setRightPanelWidth]);

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
        onToggleRightPanel={toggleRightPanel}
        rightPanelOpen={rightPanelOpen}
      />

      {/* Main area: sidebar + content + right panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — below project tabs */}
        <div
          className="relative shrink-0 overflow-visible"
          style={{
            width: sidebarOpen ? sidebarWidth : 0,
            minWidth: sidebarOpen ? sidebarWidth : 0,
            flexBasis: sidebarOpen ? sidebarWidth : 0,
            maxWidth: sidebarOpen ? sidebarWidth : 0,
          }}
        >
          <Sidebar
            collapsed={!sidebarOpen}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
          {sidebarOpen && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-valuemin={SIDEBAR_MIN_WIDTH}
              aria-valuemax={SIDEBAR_MAX_WIDTH}
              aria-valuenow={Math.round(sidebarWidth)}
              aria-valuetext={`${Math.round(sidebarWidth)} pixels`}
              tabIndex={0}
              aria-label="Resize sidebar"
              className="absolute -right-1.5 top-0 z-50 h-full w-3 cursor-col-resize touch-none"
              onPointerDown={handleSidebarResizeStart}
              onKeyDown={handleSidebarResizeKeyDown}
            >
              <div
                className={`absolute left-1/2 top-0 h-full w-px -translate-x-1/2 ${
                  isSidebarDragging ? "bg-maestro-accent" : "bg-maestro-border/70"
                }`}
              />
            </div>
          )}
        </div>

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
        <div
          className="relative shrink-0 overflow-visible"
          style={{
            width: rightPanelOpen ? rightPanelWidth : 0,
            minWidth: rightPanelOpen ? rightPanelWidth : 0,
            flexBasis: rightPanelOpen ? rightPanelWidth : 0,
            maxWidth: rightPanelOpen ? rightPanelWidth : 0,
          }}
        >
          {rightPanelOpen && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-valuemin={RIGHT_PANEL_MIN_WIDTH}
              aria-valuemax={RIGHT_PANEL_MAX_WIDTH}
              aria-valuenow={Math.round(rightPanelWidth)}
              aria-valuetext={`${Math.round(rightPanelWidth)} pixels`}
              tabIndex={0}
              aria-label="Resize right panel"
              className="absolute -left-1.5 top-0 z-50 h-full w-3 cursor-col-resize touch-none"
              onPointerDown={handleRightPanelResizeStart}
              onKeyDown={handleRightPanelResizeKeyDown}
            >
              <div
                className={`absolute left-1/2 top-0 h-full w-px -translate-x-1/2 ${
                  isRightPanelDragging ? "bg-maestro-accent" : "bg-maestro-border/70"
                }`}
              />
            </div>
          )}
          <RightPanel
            collapsed={!rightPanelOpen}
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
