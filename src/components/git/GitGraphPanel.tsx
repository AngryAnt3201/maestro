import { GitFork, AlertCircle, Terminal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { GraphNode } from "../../lib/graphLayout";
import { useGitStore } from "../../stores/useGitStore";
import { useGitHubStore } from "../../stores/useGitHubStore";
import { CommitDetailPanel } from "./CommitDetailPanel";
import { GitPanelTabs, type GitPanelTab } from "./GitPanelTabs";
import { GitPanelContent } from "./GitPanelContent";
import { PullRequestDetailPanel } from "./pulls/PullRequestDetailPanel";
import { IssueDetailPanel } from "./issues/IssueDetailPanel";
import { DiscussionDetailPanel } from "./discussions/DiscussionDetailPanel";

interface GitGraphPanelProps {
  open: boolean;
  onClose: () => void;
  repoPath: string | null;
  currentBranch: string | null;
}

export function GitGraphPanel({
  open,
  onClose: _onClose,
  repoPath,
  currentBranch,
}: GitGraphPanelProps) {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedPRNumber, setSelectedPRNumber] = useState<number | null>(null);
  const [selectedIssueNumber, setSelectedIssueNumber] = useState<number | null>(null);
  const [selectedDiscussionNumber, setSelectedDiscussionNumber] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<GitPanelTab>("commits");

  const { checkoutBranch, createBranch } = useGitStore();
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

  // Check auth and fetch data when tab changes or repo changes
  useEffect(() => {
    if (!repoPath) return;

    // Check auth status
    if (!authStatus) {
      checkAuth(repoPath);
    }

    // Fetch data for active tab
    if (activeTab === "prs" && authStatus?.logged_in) {
      fetchPullRequests(repoPath);
    } else if (activeTab === "issues" && authStatus?.logged_in) {
      fetchIssues(repoPath);
    } else if (activeTab === "discussions" && authStatus?.logged_in) {
      fetchDiscussions(repoPath);
    }
  }, [
    repoPath,
    activeTab,
    authStatus,
    checkAuth,
    fetchPullRequests,
    fetchIssues,
    fetchDiscussions,
  ]);

  // Handle PR selection
  const handleSelectPR = useCallback(
    async (prNumber: number) => {
      if (!repoPath) return;
      setSelectedPRNumber(prNumber);
      await fetchPullRequestDetail(repoPath, prNumber);
    },
    [repoPath, fetchPullRequestDetail]
  );

  // Handle closing PR detail panel
  const handleClosePRDetail = useCallback(() => {
    setSelectedPRNumber(null);
    clearSelectedPR();
  }, [clearSelectedPR]);

  // Handle Issue selection
  const handleSelectIssue = useCallback(
    async (issueNumber: number) => {
      if (!repoPath) return;
      setSelectedIssueNumber(issueNumber);
      await fetchIssueDetail(repoPath, issueNumber);
    },
    [repoPath, fetchIssueDetail]
  );

  // Handle closing Issue detail panel
  const handleCloseIssueDetail = useCallback(() => {
    setSelectedIssueNumber(null);
    clearSelectedIssue();
  }, [clearSelectedIssue]);

  // Handle Discussion selection
  const handleSelectDiscussion = useCallback(
    async (discussionNumber: number) => {
      if (!repoPath) return;
      setSelectedDiscussionNumber(discussionNumber);
      await fetchDiscussionDetail(repoPath, discussionNumber);
    },
    [repoPath, fetchDiscussionDetail]
  );

  // Handle closing Discussion detail panel
  const handleCloseDiscussionDetail = useCallback(() => {
    setSelectedDiscussionNumber(null);
    clearSelectedDiscussion();
  }, [clearSelectedDiscussion]);

  // Handle tab change
  const handleTabChange = useCallback((tab: GitPanelTab) => {
    setActiveTab(tab);
    // Clear selections when switching tabs
    setSelectedNode(null);
    setSelectedPRNumber(null);
    setSelectedIssueNumber(null);
    setSelectedDiscussionNumber(null);
    clearSelectedPR();
    clearSelectedIssue();
    clearSelectedDiscussion();
  }, [clearSelectedPR, clearSelectedIssue, clearSelectedDiscussion]);

  // Handle commit selection
  const handleSelectCommit = useCallback((node: GraphNode) => {
    setSelectedNode(node);
  }, []);

  // Handle closing detail panel
  const handleCloseDetail = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Handle create branch at commit
  const handleCreateBranchAtCommit = useCallback(
    async (commitHash: string) => {
      if (!repoPath) return;

      const branchName = window.prompt("Enter new branch name:");
      if (!branchName) return;

      try {
        await createBranch(repoPath, branchName, commitHash);
      } catch (err) {
        console.error("Failed to create branch:", err);
        window.alert(`Failed to create branch: ${err}`);
      }
    },
    [repoPath, createBranch]
  );

  // Handle checkout commit
  const handleCheckoutCommit = useCallback(
    async (commitHash: string) => {
      if (!repoPath) return;

      const confirm = window.confirm(
        "This will checkout a detached HEAD. Continue?"
      );
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

  const hasRepo = Boolean(repoPath);

  // Count open PRs and issues for badges
  const openPRCount = pullRequests.filter((pr) => pr.state === "OPEN").length;
  const openIssueCount = issues.filter((i) => i.state === "OPEN").length;

  // Check for gh CLI not installed or not authenticated
  const isGhError = prsError?.includes("gh") || prsError?.includes("GitHub CLI");
  const showAuthPrompt =
    activeTab !== "commits" && authStatus && !authStatus.logged_in;

  // Show PR detail panel full width when a PR is selected
  const showPRDetail = selectedPRNumber && repoPath && activeTab === "prs";
  // Show Issue detail panel full width when an issue is selected
  const showIssueDetail = selectedIssueNumber && repoPath && activeTab === "issues";
  // Show Discussion detail panel full width when a discussion is selected
  const showDiscussionDetail = selectedDiscussionNumber && repoPath && activeTab === "discussions";

  return (
    <aside
      aria-hidden={!open}
      tabIndex={open ? undefined : -1}
      {...(!open ? ({ inert: "" } as { inert: "" }) : {})}
      className={`relative z-30 flex flex-row border-l border-maestro-border bg-maestro-surface transition-all duration-200 overflow-hidden ${
        open ? "w-[560px]" : "w-0 border-l-0"
      }`}
    >
      {/* PR Detail panel - full width when shown */}
      {showPRDetail ? (
        <div className="flex min-w-[320px] flex-1 flex-col">
          <PullRequestDetailPanel
            repoPath={repoPath}
            onClose={handleClosePRDetail}
          />
        </div>
      ) : showIssueDetail ? (
        <div className="flex min-w-[320px] flex-1 flex-col">
          <IssueDetailPanel
            repoPath={repoPath}
            onClose={handleCloseIssueDetail}
          />
        </div>
      ) : showDiscussionDetail ? (
        <div className="flex min-w-[320px] flex-1 flex-col">
          <DiscussionDetailPanel
            repoPath={repoPath}
            onClose={handleCloseDiscussionDetail}
          />
        </div>
      ) : (
        <>
          {/* Main panel */}
          <div className="flex min-w-[320px] flex-1 flex-col">
            {/* Tabs - only show when repo is available */}
            {hasRepo && (
              <GitPanelTabs
                activeTab={activeTab}
                onTabChange={handleTabChange}
                prCount={openPRCount}
                issueCount={openIssueCount}
              />
            )}

            {/* Content */}
            {!hasRepo ? (
              // Empty state - no repo
              <div className="flex flex-1 items-center justify-center px-4 text-center">
                <div className="flex flex-col items-center gap-3">
                  <GitFork
                    size={32}
                    className="animate-breathe text-maestro-muted/30"
                    strokeWidth={1}
                  />
                  <p className="text-xs text-maestro-muted/60">
                    Open a git repository to view commits
                  </p>
                </div>
              </div>
            ) : isGhError ? (
              // gh CLI not installed
              <div className="flex flex-1 items-center justify-center px-4 text-center">
                <div className="flex flex-col items-center gap-3">
                  <Terminal
                    size={32}
                    className="text-maestro-muted/30"
                    strokeWidth={1}
                  />
                  <p className="text-xs text-maestro-muted/60">
                    GitHub CLI not found
                  </p>
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
              // Not authenticated
              <div className="flex flex-1 items-center justify-center px-4 text-center">
                <div className="flex flex-col items-center gap-3">
                  <AlertCircle
                    size={32}
                    className="text-maestro-yellow/50"
                    strokeWidth={1}
                  />
                  <p className="text-xs text-maestro-muted/60">
                    Not authenticated with GitHub
                  </p>
                  <p className="text-[10px] text-maestro-muted/40">
                    Run <code className="rounded bg-maestro-card px-1 py-0.5">gh auth login</code> in your terminal
                  </p>
                </div>
              </div>
            ) : (
              // Tab content
              <GitPanelContent
                activeTab={activeTab}
                repoPath={repoPath!}
                currentBranch={currentBranch}
                onSelectCommit={handleSelectCommit}
                selectedCommitHash={selectedNode?.commit.hash ?? null}
                onSelectPR={handleSelectPR}
                selectedPRNumber={selectedPRNumber}
                onSelectIssue={handleSelectIssue}
                selectedIssueNumber={selectedIssueNumber}
                onSelectDiscussion={handleSelectDiscussion}
                selectedDiscussionNumber={selectedDiscussionNumber}
              />
            )}
          </div>

          {/* Commit Detail panel */}
          {selectedNode && repoPath && activeTab === "commits" && (
            <div className="w-60 shrink-0">
              <CommitDetailPanel
                node={selectedNode}
                repoPath={repoPath}
                onClose={handleCloseDetail}
                onCreateBranchAtCommit={handleCreateBranchAtCommit}
                onCheckoutCommit={handleCheckoutCommit}
              />
            </div>
          )}
        </>
      )}
    </aside>
  );
}
