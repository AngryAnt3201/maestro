import {
  Activity,
  AlertCircle,
  ChevronDown,
  GitBranch,
  GitFork,
  ListTodo,
  Loader2,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { GraphNode } from "@/lib/graphLayout";
import { useGitStore } from "@/stores/useGitStore";
import { useGitHubStore } from "@/stores/useGitHubStore";
import { useSessionStore } from "@/stores/useSessionStore";
import { BranchDropdown } from "./BranchDropdown";
import { StatusLegend } from "./StatusLegend";
import { WorktreeCard } from "./WorktreeCard";
import { GitPanelTabs, type GitPanelTab } from "../git/GitPanelTabs";
import { GitPanelContent } from "../git/GitPanelContent";
import { CommitDetailPanel } from "../git/CommitDetailPanel";
import { PullRequestDetailPanel } from "../git/pulls/PullRequestDetailPanel";
import { IssueDetailPanel } from "../git/issues/IssueDetailPanel";
import { DiscussionDetailPanel } from "../git/discussions/DiscussionDetailPanel";
import { TodoPanel } from "../todo/TodoPanel";

type RightPanelTab = "status" | "git" | "todo";

interface RightPanelProps {
  collapsed: boolean;
  branchName?: string;
  repoPath?: string;
  onBranchChanged?: (newBranch: string) => void;
  currentBranch?: string;
  onFocusSession?: (sessionId: number) => void;
  onLaunchSession?: (branch: string, worktreePath: string) => void;
}

export function RightPanel({
  collapsed,
  branchName,
  repoPath,
  onBranchChanged,
  currentBranch,
  onFocusSession,
  onLaunchSession,
}: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<RightPanelTab>("status");

  // ── Branch selector state (from TopBar) ──
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const { checkoutBranch, createBranch, fetchCurrentBranch, commits, fetchCommits } = useGitStore();

  // ── Git panel state (from GitGraphPanel) ──
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedPRNumber, setSelectedPRNumber] = useState<number | null>(null);
  const [selectedIssueNumber, setSelectedIssueNumber] = useState<number | null>(null);
  const [selectedDiscussionNumber, setSelectedDiscussionNumber] = useState<number | null>(null);
  const [activeGitTab, setActiveGitTab] = useState<GitPanelTab>("commits");
  const [isRefreshingGit, setIsRefreshingGit] = useState(false);

  const {
    authStatus,
    pullRequests,
    issues,
    prsError,
    checkAuth,
    fetchPullRequests,
    fetchIssues,
    fetchDiscussions,
    fetchPullRequestDetail,
    fetchIssueDetail,
    fetchDiscussionDetail,
    clearSelectedPR,
    clearSelectedIssue,
    clearSelectedDiscussion,
  } = useGitHubStore();

  // ── Branch selector logic (from TopBar) ──

  const handleBranchSelect = useCallback(
    async (branch: string) => {
      if (!repoPath || branch === branchName) {
        setBranchDropdownOpen(false);
        return;
      }

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
        await fetchCurrentBranch(repoPath);
        onBranchChanged?.(branch);
        setBranchDropdownOpen(false);
      } catch (err) {
        console.error("Failed to switch branch:", err);
        window.alert(`Failed to switch to ${branch}: ${err}`);
      } finally {
        setIsSwitching(false);
      }
    },
    [repoPath, branchName, checkoutBranch, fetchCurrentBranch, onBranchChanged]
  );

  const handleCreateBranch = useCallback(
    async (name: string, andCheckout: boolean) => {
      if (!repoPath) return;
      await createBranch(repoPath, name);
      if (andCheckout) {
        await handleBranchSelect(name);
      }
    },
    [repoPath, createBranch, handleBranchSelect]
  );

  // ── Git panel logic (from GitGraphPanel) ──

  useEffect(() => {
    if (!repoPath || activeGitTab === "commits") return;
    checkAuth(repoPath);
  }, [repoPath, activeGitTab, checkAuth]);

  useEffect(() => {
    if (!repoPath || !authStatus?.logged_in) return;
    if (activeGitTab === "prs") fetchPullRequests(repoPath);
    else if (activeGitTab === "issues") fetchIssues(repoPath);
    else if (activeGitTab === "discussions") fetchDiscussions(repoPath);
  }, [repoPath, activeGitTab, authStatus, fetchPullRequests, fetchIssues, fetchDiscussions]);

  const handleSelectPR = useCallback(
    async (prNumber: number) => {
      if (!repoPath) return;
      setSelectedPRNumber(prNumber);
      await fetchPullRequestDetail(repoPath, prNumber);
    },
    [repoPath, fetchPullRequestDetail]
  );

  const handleClosePRDetail = useCallback(() => {
    setSelectedPRNumber(null);
    clearSelectedPR();
  }, [clearSelectedPR]);

  const handleSelectIssue = useCallback(
    async (issueNumber: number) => {
      if (!repoPath) return;
      setSelectedIssueNumber(issueNumber);
      await fetchIssueDetail(repoPath, issueNumber);
    },
    [repoPath, fetchIssueDetail]
  );

  const handleCloseIssueDetail = useCallback(() => {
    setSelectedIssueNumber(null);
    clearSelectedIssue();
  }, [clearSelectedIssue]);

  const handleSelectDiscussion = useCallback(
    async (discussionNumber: number) => {
      if (!repoPath) return;
      setSelectedDiscussionNumber(discussionNumber);
      await fetchDiscussionDetail(repoPath, discussionNumber);
    },
    [repoPath, fetchDiscussionDetail]
  );

  const handleCloseDiscussionDetail = useCallback(() => {
    setSelectedDiscussionNumber(null);
    clearSelectedDiscussion();
  }, [clearSelectedDiscussion]);

  const handleGitTabChange = useCallback((tab: GitPanelTab) => {
    setActiveGitTab(tab);
    setSelectedNode(null);
    setSelectedPRNumber(null);
    setSelectedIssueNumber(null);
    setSelectedDiscussionNumber(null);
    clearSelectedPR();
    clearSelectedIssue();
    clearSelectedDiscussion();
  }, [clearSelectedPR, clearSelectedIssue, clearSelectedDiscussion]);

  const handleSelectCommit = useCallback((node: GraphNode) => {
    setSelectedNode(node);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const handleCreateBranchAtCommit = useCallback(
    async (commitHash: string) => {
      if (!repoPath) return;
      const name = window.prompt("Enter new branch name:");
      if (!name) return;
      try {
        await createBranch(repoPath, name, commitHash);
      } catch (err) {
        console.error("Failed to create branch:", err);
        window.alert(`Failed to create branch: ${err}`);
      }
    },
    [repoPath, createBranch]
  );

  const handleCheckoutCommit = useCallback(
    async (commitHash: string) => {
      if (!repoPath) return;
      const confirm = window.confirm("This will checkout a detached HEAD. Continue?");
      if (!confirm) return;
      try {
        await checkoutBranch(repoPath, commitHash);
      } catch (err) {
        console.error("Failed to checkout commit:", err);
        window.alert(`Failed to checkout: ${err}`);
      }
    },
    [repoPath, checkoutBranch]
  );

  const handleRefreshGit = useCallback(async () => {
    if (!repoPath) return;
    setIsRefreshingGit(true);
    try {
      await fetchCommits(repoPath);
    } finally {
      setIsRefreshingGit(false);
    }
  }, [repoPath, fetchCommits]);

  const hasRepo = Boolean(repoPath);
  const openPRCount = pullRequests.filter((pr) => pr.state === "OPEN").length;
  const openIssueCount = issues.filter((i) => i.state === "OPEN").length;
  const isGhError = prsError?.includes("gh") || prsError?.includes("GitHub CLI");
  const showPRDetail = selectedPRNumber && repoPath && activeGitTab === "prs";
  const showIssueDetail = selectedIssueNumber && repoPath && activeGitTab === "issues";
  const showDiscussionDetail = selectedDiscussionNumber && repoPath && activeGitTab === "discussions";

  return (
    <aside
      className={`theme-transition no-select relative flex h-full w-full min-w-0 flex-col overflow-hidden border-l border-maestro-border bg-maestro-surface ${
        collapsed ? "overflow-hidden border-l-0 opacity-0" : "opacity-100 transition-all duration-200 ease-out"
      }`}
    >
      {/* Top-level tab switcher (Status / Git) */}
      <div className="flex shrink-0 border-b border-maestro-border">
        <button
          type="button"
          onClick={() => setActiveTab("status")}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold tracking-wide uppercase ${
            activeTab === "status"
              ? "border-b-2 border-maestro-accent text-maestro-accent"
              : "text-maestro-muted hover:text-maestro-text"
          }`}
        >
          <Activity size={12} />
          Status
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("git")}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold tracking-wide uppercase ${
            activeTab === "git"
              ? "border-b-2 border-maestro-accent text-maestro-accent"
              : "text-maestro-muted hover:text-maestro-text"
          }`}
        >
          <GitFork size={12} />
          Git
          {commits.length > 0 && (
            <span className="rounded-full bg-maestro-accent/15 px-1.5 py-px text-[10px] font-medium text-maestro-accent">
              {commits.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("todo")}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold tracking-wide uppercase ${
            activeTab === "todo"
              ? "border-b-2 border-maestro-accent text-maestro-accent"
              : "text-maestro-muted hover:text-maestro-text"
          }`}
        >
          <ListTodo size={12} />
          Todo
        </button>
      </div>

      {/* Scrollable content */}
      {activeTab === "status" ? (
        <div className="flex-1 overflow-y-auto px-2.5 py-3">
          <StatusTab
            branchName={branchName}
            repoPath={repoPath}
            branchDropdownOpen={branchDropdownOpen}
            setBranchDropdownOpen={setBranchDropdownOpen}
            isSwitching={isSwitching}
            onBranchSelect={handleBranchSelect}
            onCreateBranch={handleCreateBranch}
            isVisible={!collapsed && activeTab === "status"}
            onFocusSession={onFocusSession}
            onLaunchSession={onLaunchSession}
          />
        </div>
      ) : activeTab === "todo" ? (
        repoPath ? (
          <TodoPanel projectPath={repoPath} />
        ) : (
          <div className="flex flex-1 items-center justify-center px-4 text-center">
            <p className="text-xs text-maestro-muted/60">
              Open a project to manage todos
            </p>
          </div>
        )
      ) : (
        <GitTab
          repoPath={repoPath}
          currentBranch={currentBranch}
          hasRepo={hasRepo}
          isGhError={!!isGhError}
          showAuthPrompt={!!(activeGitTab !== "commits" && authStatus && !authStatus.logged_in)}
          activeGitTab={activeGitTab}
          onGitTabChange={handleGitTabChange}
          openPRCount={openPRCount}
          openIssueCount={openIssueCount}
          isRefreshingGit={isRefreshingGit}
          onRefreshGit={handleRefreshGit}
          onSelectCommit={handleSelectCommit}
          selectedNode={selectedNode}
          onCloseDetail={handleCloseDetail}
          onCreateBranchAtCommit={handleCreateBranchAtCommit}
          onCheckoutCommit={handleCheckoutCommit}
          showPRDetail={!!showPRDetail}
          onSelectPR={handleSelectPR}
          selectedPRNumber={selectedPRNumber}
          onClosePRDetail={handleClosePRDetail}
          showIssueDetail={!!showIssueDetail}
          onSelectIssue={handleSelectIssue}
          selectedIssueNumber={selectedIssueNumber}
          onCloseIssueDetail={handleCloseIssueDetail}
          showDiscussionDetail={!!showDiscussionDetail}
          onSelectDiscussion={handleSelectDiscussion}
          selectedDiscussionNumber={selectedDiscussionNumber}
          onCloseDiscussionDetail={handleCloseDiscussionDetail}
          checkAuth={checkAuth}
        />
      )}

    </aside>
  );
}

/* ================================================================ */
/*  STATUS TAB                                                       */
/* ================================================================ */

const cardClass =
  "sidebar-card-link rounded-lg border border-maestro-border/60 bg-maestro-card p-3 overflow-hidden shadow-[0_1px_4px_rgb(0_0_0/0.15),0_0_0_1px_rgb(255_255_255/0.03)_inset] transition-shadow hover:shadow-[0_2px_8px_rgb(0_0_0/0.25),0_0_0_1px_rgb(255_255_255/0.05)_inset]";

function StatusTab({
  branchName,
  repoPath,
  branchDropdownOpen,
  setBranchDropdownOpen,
  isSwitching,
  onBranchSelect,
  onCreateBranch,
  isVisible,
  onFocusSession,
  onLaunchSession,
}: {
  branchName?: string;
  repoPath?: string;
  branchDropdownOpen: boolean;
  setBranchDropdownOpen: (open: boolean) => void;
  isSwitching: boolean;
  onBranchSelect: (branch: string) => void;
  onCreateBranch: (name: string, andCheckout: boolean) => void;
  isVisible: boolean;
  onFocusSession?: (sessionId: number) => void;
  onLaunchSession?: (branch: string, worktreePath: string) => void;
}) {
  return (
    <div className="space-y-3">
      {/* Branch selector card */}
      {branchName && repoPath && (
        <div className={cardClass}>
          <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-maestro-muted">
            <GitBranch size={13} className="text-maestro-green" />
            <span className="flex-1">Branch</span>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => !isSwitching && setBranchDropdownOpen(!branchDropdownOpen)}
              disabled={isSwitching}
              aria-haspopup="listbox"
              aria-expanded={branchDropdownOpen}
              aria-label="Select branch"
              className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 transition-colors hover:bg-maestro-border/40 disabled:opacity-70"
            >
              {isSwitching ? (
                <Loader2 size={13} className="animate-spin text-maestro-accent" />
              ) : (
                <GitBranch size={13} className="text-maestro-muted" />
              )}
              <span className="flex-1 truncate text-xs font-medium text-maestro-text text-left">
                {branchName}
              </span>
              <ChevronDown size={11} className="text-maestro-muted" />
            </button>

            {branchDropdownOpen && (
              <BranchDropdown
                repoPath={repoPath}
                currentBranch={branchName}
                onSelect={onBranchSelect}
                onCreateBranch={onCreateBranch}
                onClose={() => setBranchDropdownOpen(false)}
              />
            )}
          </div>
        </div>
      )}

      {/* Worktree card */}
      {repoPath && onFocusSession && onLaunchSession && (
        <WorktreeCard
          repoPath={repoPath}
          isVisible={isVisible}
          onFocusSession={onFocusSession}
          onLaunchSession={onLaunchSession}
        />
      )}

      {/* Status legend card */}
      <div className={cardClass}>
        <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-maestro-muted">
          <Activity size={13} className="text-maestro-accent" />
          <span className="flex-1">Session Status</span>
        </div>
        <div className="px-1">
          <StatusLegend direction="vertical" />
        </div>
      </div>
    </div>
  );
}

/* ================================================================ */
/*  GIT TAB                                                          */
/* ================================================================ */

function GitTab({
  repoPath,
  currentBranch,
  hasRepo,
  isGhError,
  showAuthPrompt,
  activeGitTab,
  onGitTabChange,
  openPRCount,
  openIssueCount,
  isRefreshingGit,
  onRefreshGit,
  onSelectCommit,
  selectedNode,
  onCloseDetail,
  onCreateBranchAtCommit,
  onCheckoutCommit,
  showPRDetail,
  onSelectPR,
  selectedPRNumber,
  onClosePRDetail,
  showIssueDetail,
  onSelectIssue,
  selectedIssueNumber,
  onCloseIssueDetail,
  showDiscussionDetail,
  onSelectDiscussion,
  selectedDiscussionNumber,
  onCloseDiscussionDetail,
  checkAuth,
}: {
  repoPath?: string;
  currentBranch?: string;
  hasRepo: boolean;
  isGhError: boolean;
  showAuthPrompt: boolean;
  activeGitTab: GitPanelTab;
  onGitTabChange: (tab: GitPanelTab) => void;
  openPRCount: number;
  openIssueCount: number;
  isRefreshingGit: boolean;
  onRefreshGit: () => void;
  onSelectCommit: (node: GraphNode) => void;
  selectedNode: GraphNode | null;
  onCloseDetail: () => void;
  onCreateBranchAtCommit: (commitHash: string) => void;
  onCheckoutCommit: (commitHash: string) => void;
  showPRDetail: boolean;
  onSelectPR: (prNumber: number) => void;
  selectedPRNumber: number | null;
  onClosePRDetail: () => void;
  showIssueDetail: boolean;
  onSelectIssue: (issueNumber: number) => void;
  selectedIssueNumber: number | null;
  onCloseIssueDetail: () => void;
  showDiscussionDetail: boolean;
  onSelectDiscussion: (discussionNumber: number) => void;
  selectedDiscussionNumber: number | null;
  onCloseDiscussionDetail: () => void;
  checkAuth: (repoPath: string) => void;
}) {
  // Show PR detail panel full width when a PR is selected
  if (showPRDetail && repoPath) {
    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <PullRequestDetailPanel repoPath={repoPath} onClose={onClosePRDetail} />
      </div>
    );
  }

  if (showIssueDetail && repoPath) {
    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <IssueDetailPanel repoPath={repoPath} onClose={onCloseIssueDetail} />
      </div>
    );
  }

  if (showDiscussionDetail && repoPath) {
    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <DiscussionDetailPanel repoPath={repoPath} onClose={onCloseDiscussionDetail} />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Git sub-tabs + refresh button */}
      {hasRepo && (
        <div className="flex items-center">
          <div className="flex-1">
            <GitPanelTabs
              activeTab={activeGitTab}
              onTabChange={onGitTabChange}
              prCount={openPRCount}
              issueCount={openIssueCount}
            />
          </div>
          {repoPath && (
            <button
              type="button"
              onClick={onRefreshGit}
              disabled={isRefreshingGit}
              className="mr-2 rounded p-1 text-maestro-muted transition-colors hover:bg-maestro-card hover:text-maestro-text disabled:opacity-50"
              aria-label="Refresh"
            >
              <RefreshCw size={13} className={isRefreshingGit ? "animate-spin" : ""} />
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {!hasRepo ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center">
          <div className="flex flex-col items-center gap-3">
            <GitFork size={32} className="animate-breathe text-maestro-muted/30" strokeWidth={1} />
            <p className="text-xs text-maestro-muted/60">Open a git repository to view commits</p>
          </div>
        </div>
      ) : isGhError ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center">
          <div className="flex flex-col items-center gap-3">
            <Terminal size={32} className="text-maestro-muted/30" strokeWidth={1} />
            <p className="text-xs text-maestro-muted/60">GitHub CLI not found</p>
            <a
              href="https://cli.github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-maestro-accent hover:underline"
            >
              Install GitHub CLI
            </a>
          </div>
        </div>
      ) : showAuthPrompt ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center">
          <div className="flex flex-col items-center gap-3">
            <AlertCircle size={32} className="text-maestro-yellow/50" strokeWidth={1} />
            <p className="text-xs text-maestro-muted/60">Not authenticated with GitHub</p>
            <p className="text-[10px] text-maestro-muted/40">
              Run <code className="rounded bg-maestro-card px-1 py-0.5">gh auth login</code> in your terminal
            </p>
            <button
              type="button"
              onClick={() => repoPath && checkAuth(repoPath)}
              className="mt-1 rounded bg-maestro-card px-3 py-1 text-xs text-maestro-muted/60 transition-colors hover:bg-maestro-border hover:text-maestro-text"
            >
              Retry
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <GitPanelContent
            activeTab={activeGitTab}
            repoPath={repoPath!}
            currentBranch={currentBranch ?? null}
            onSelectCommit={onSelectCommit}
            selectedCommitHash={selectedNode?.commit.hash ?? null}
            onSelectPR={onSelectPR}
            selectedPRNumber={selectedPRNumber}
            onSelectIssue={onSelectIssue}
            selectedIssueNumber={selectedIssueNumber}
            onSelectDiscussion={onSelectDiscussion}
            selectedDiscussionNumber={selectedDiscussionNumber}
          />

          {/* Commit Detail panel */}
          {selectedNode && repoPath && activeGitTab === "commits" && (
            <div className="w-60 shrink-0">
              <CommitDetailPanel
                node={selectedNode}
                repoPath={repoPath}
                onClose={onCloseDetail}
                onCreateBranchAtCommit={onCreateBranchAtCommit}
                onCheckoutCommit={onCheckoutCommit}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
