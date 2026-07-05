import type { GraphNode } from "../../lib/graphLayout";
import { CommitGraph } from "./CommitGraph";
import { DiscussionList } from "./discussions/DiscussionList";
import type { GitPanelTab } from "./GitPanelTabs";
import { IssueList } from "./issues/IssueList";
import { PullRequestList } from "./pulls/PullRequestList";

interface GitPanelContentProps {
  activeTab: GitPanelTab;
  repoPath: string;
  currentBranch: string | null;
  onSelectCommit: (node: GraphNode) => void;
  selectedCommitHash: string | null;
  onSelectPR: (prNumber: number) => void;
  selectedPRNumber: number | null;
  onSelectIssue: (issueNumber: number) => void;
  selectedIssueNumber: number | null;
  onSelectDiscussion: (discussionNumber: number) => void;
  selectedDiscussionNumber: number | null;
}

export function GitPanelContent({
  activeTab,
  repoPath,
  currentBranch,
  onSelectCommit,
  selectedCommitHash,
  onSelectPR,
  selectedPRNumber,
  onSelectIssue,
  selectedIssueNumber,
  onSelectDiscussion,
  selectedDiscussionNumber,
}: GitPanelContentProps) {
  switch (activeTab) {
    case "commits":
      return (
        <CommitGraph
          repoPath={repoPath}
          onSelectCommit={onSelectCommit}
          selectedCommitHash={selectedCommitHash}
          currentBranch={currentBranch}
        />
      );
    case "prs":
      return (
        <PullRequestList
          repoPath={repoPath}
          onSelectPR={onSelectPR}
          selectedPRNumber={selectedPRNumber}
        />
      );
    case "issues":
      return (
        <IssueList
          repoPath={repoPath}
          onSelectIssue={onSelectIssue}
          selectedIssueNumber={selectedIssueNumber}
        />
      );
    case "discussions":
      return (
        <DiscussionList
          repoPath={repoPath}
          onSelectDiscussion={onSelectDiscussion}
          selectedDiscussionNumber={selectedDiscussionNumber}
        />
      );
    default:
      return null;
  }
}
