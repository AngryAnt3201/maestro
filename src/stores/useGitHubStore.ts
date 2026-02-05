import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

/** GitHub authentication status. */
export interface AuthStatus {
  logged_in: boolean;
  username: string | null;
  scopes: string[];
}

/** Pull request author. */
export interface PrAuthor {
  login: string;
}

/** Pull request label. */
export interface PrLabel {
  name: string;
  color: string;
}

/** Reactions on a comment. */
export interface CommentReactions {
  totalCount: number;
  thumbsUp: number;
  thumbsDown: number;
  laugh: number;
  hooray: number;
  confused: number;
  heart: number;
  rocket: number;
  eyes: number;
}

/** A comment on an issue, PR, or discussion. */
export interface Comment {
  id: string;
  author: PrAuthor;
  body: string;
  createdAt: string;
  updatedAt: string | null;
  reactions: CommentReactions;
  /** For discussions: indicates if this comment is the accepted answer. */
  isAnswer: boolean;
}

/** Pull request information from GitHub. */
export interface PullRequestInfo {
  number: number;
  title: string;
  state: string;
  author: PrAuthor;
  createdAt: string;
  updatedAt: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  additions: number;
  deletions: number;
  url: string;
  labels: PrLabel[];
  mergedAt: string | null;
  closedAt: string | null;
}

/** Detailed pull request info including body. */
export interface PullRequestDetail extends PullRequestInfo {
  body: string;
  changedFiles: number;
  mergeable: string;
  reviewDecision: string | null;
  comments: Comment[];
}

/** Issue information from GitHub. */
export interface IssueInfo {
  number: number;
  title: string;
  state: string;
  author: PrAuthor;
  createdAt: string;
  updatedAt: string;
  url: string;
  labels: PrLabel[];
  closedAt: string | null;
}

/** Discussion category. */
export interface DiscussionCategory {
  name: string;
  emoji: string;
}

/** Discussion information from GitHub. */
export interface DiscussionInfo {
  number: number;
  title: string;
  category: DiscussionCategory;
  author: PrAuthor;
  createdAt: string;
  url: string;
  answerChosenAt: string | null;
}

/** Detailed issue info including body. */
export interface IssueDetail extends IssueInfo {
  body: string;
  comments: Comment[];
}

/** Detailed discussion info including body. */
export interface DiscussionDetail extends DiscussionInfo {
  body: string;
  comments: Comment[];
}

/** Merge method for pull requests. */
export type MergeMethod = "merge" | "squash" | "rebase";

/** Filter state for PRs. */
export type PrFilterState = "open" | "closed" | "merged" | "all";

/** Filter state for issues. */
export type IssueFilterState = "open" | "closed" | "all";

/**
 * Zustand store for GitHub data management.
 *
 * Handles PRs, issues, and discussions with filtering and actions.
 */
interface GitHubState {
  // Authentication
  authStatus: AuthStatus | null;
  isCheckingAuth: boolean;

  // Pull requests
  pullRequests: PullRequestInfo[];
  prFilter: PrFilterState;
  isPRsLoading: boolean;
  prsError: string | null;

  // Selected PR detail
  selectedPR: PullRequestDetail | null;
  isLoadingPRDetail: boolean;

  // Issues
  issues: IssueInfo[];
  issueFilter: IssueFilterState;
  isIssuesLoading: boolean;
  issuesError: string | null;

  // Discussions
  discussions: DiscussionInfo[];
  isDiscussionsLoading: boolean;
  discussionsError: string | null;
  discussionsEnabled: boolean;

  // Selected Issue detail
  selectedIssue: IssueDetail | null;
  isLoadingIssueDetail: boolean;

  // Selected Discussion detail
  selectedDiscussion: DiscussionDetail | null;
  isLoadingDiscussionDetail: boolean;

  // Actions
  checkAuth: (repoPath: string) => Promise<void>;
  fetchPullRequests: (repoPath: string, state?: PrFilterState) => Promise<void>;
  fetchPullRequestDetail: (repoPath: string, number: number) => Promise<void>;
  createPullRequest: (
    repoPath: string,
    title: string,
    body: string,
    base: string,
    head: string,
    draft: boolean
  ) => Promise<PullRequestInfo>;
  mergePullRequest: (
    repoPath: string,
    number: number,
    method: MergeMethod,
    deleteBranch: boolean
  ) => Promise<void>;
  closePullRequest: (repoPath: string, number: number) => Promise<void>;
  commentPullRequest: (
    repoPath: string,
    number: number,
    body: string
  ) => Promise<void>;
  fetchIssues: (repoPath: string, state?: IssueFilterState) => Promise<void>;
  fetchDiscussions: (repoPath: string) => Promise<void>;
  fetchIssueDetail: (repoPath: string, number: number) => Promise<void>;
  closeIssue: (repoPath: string, number: number) => Promise<void>;
  reopenIssue: (repoPath: string, number: number) => Promise<void>;
  commentIssue: (repoPath: string, number: number, body: string) => Promise<void>;
  clearSelectedIssue: () => void;
  fetchDiscussionDetail: (repoPath: string, number: number) => Promise<void>;
  commentDiscussion: (repoPath: string, number: number, body: string) => Promise<void>;
  clearSelectedDiscussion: () => void;
  setPrFilter: (filter: PrFilterState) => void;
  setIssueFilter: (filter: IssueFilterState) => void;
  clearSelectedPR: () => void;
  reset: () => void;
}

export const useGitHubStore = create<GitHubState>()((set, get) => ({
  // Initial state
  authStatus: null,
  isCheckingAuth: false,
  pullRequests: [],
  prFilter: "open",
  isPRsLoading: false,
  prsError: null,
  selectedPR: null,
  isLoadingPRDetail: false,
  issues: [],
  issueFilter: "open",
  isIssuesLoading: false,
  issuesError: null,
  discussions: [],
  isDiscussionsLoading: false,
  discussionsError: null,
  discussionsEnabled: true,
  selectedIssue: null,
  isLoadingIssueDetail: false,
  selectedDiscussion: null,
  isLoadingDiscussionDetail: false,

  checkAuth: async (repoPath: string) => {
    set({ isCheckingAuth: true });
    try {
      const authStatus = await invoke<AuthStatus>("github_auth_status", {
        repoPath,
      });
      set({ authStatus, isCheckingAuth: false });
    } catch (err) {
      console.error("Failed to check GitHub auth:", err);
      set({
        authStatus: { logged_in: false, username: null, scopes: [] },
        isCheckingAuth: false,
      });
    }
  },

  fetchPullRequests: async (repoPath: string, state?: PrFilterState) => {
    const filter = state ?? get().prFilter;
    set({ isPRsLoading: true, prsError: null, prFilter: filter });
    try {
      const pullRequests = await invoke<PullRequestInfo[]>("github_list_prs", {
        repoPath,
        state: filter === "all" ? null : filter,
        limit: 50,
      });
      set({ pullRequests, isPRsLoading: false });
    } catch (err) {
      console.error("Failed to fetch PRs:", err);
      set({ prsError: String(err), isPRsLoading: false, pullRequests: [] });
    }
  },

  fetchPullRequestDetail: async (repoPath: string, number: number) => {
    set({ isLoadingPRDetail: true });
    try {
      const selectedPR = await invoke<PullRequestDetail>("github_get_pr", {
        repoPath,
        number,
      });
      set({ selectedPR, isLoadingPRDetail: false });
    } catch (err) {
      console.error("Failed to fetch PR detail:", err);
      set({ isLoadingPRDetail: false });
    }
  },

  createPullRequest: async (
    repoPath: string,
    title: string,
    body: string,
    base: string,
    head: string,
    draft: boolean
  ) => {
    const pr = await invoke<PullRequestInfo>("github_create_pr", {
      repoPath,
      title,
      body,
      base,
      head,
      draft,
    });
    // Refresh PR list after creation
    await get().fetchPullRequests(repoPath);
    return pr;
  },

  mergePullRequest: async (
    repoPath: string,
    number: number,
    method: MergeMethod,
    deleteBranch: boolean
  ) => {
    await invoke("github_merge_pr", {
      repoPath,
      number,
      method,
      deleteBranch,
    });
    // Refresh PR list after merge
    await get().fetchPullRequests(repoPath);
    set({ selectedPR: null });
  },

  closePullRequest: async (repoPath: string, number: number) => {
    await invoke("github_close_pr", { repoPath, number });
    // Refresh PR list after close
    await get().fetchPullRequests(repoPath);
    set({ selectedPR: null });
  },

  commentPullRequest: async (
    repoPath: string,
    number: number,
    body: string
  ) => {
    await invoke("github_comment_pr", { repoPath, number, body });
    // Refresh PR detail to show the new comment
    await get().fetchPullRequestDetail(repoPath, number);
  },

  fetchIssues: async (repoPath: string, state?: IssueFilterState) => {
    const filter = state ?? get().issueFilter;
    set({ isIssuesLoading: true, issuesError: null, issueFilter: filter });
    try {
      const issues = await invoke<IssueInfo[]>("github_list_issues", {
        repoPath,
        state: filter === "all" ? null : filter,
        limit: 50,
      });
      set({ issues, isIssuesLoading: false });
    } catch (err) {
      console.error("Failed to fetch issues:", err);
      set({ issuesError: String(err), isIssuesLoading: false, issues: [] });
    }
  },

  fetchDiscussions: async (repoPath: string) => {
    set({ isDiscussionsLoading: true, discussionsError: null });
    try {
      const discussions = await invoke<DiscussionInfo[]>(
        "github_list_discussions",
        { repoPath, limit: 25 }
      );
      set({ discussions, isDiscussionsLoading: false, discussionsEnabled: true });
    } catch (err) {
      const errorStr = String(err);
      console.error("Failed to fetch discussions:", err);
      if (errorStr.includes("not enabled")) {
        set({
          discussionsEnabled: false,
          isDiscussionsLoading: false,
          discussions: [],
        });
      } else {
        set({
          discussionsError: errorStr,
          isDiscussionsLoading: false,
          discussions: [],
        });
      }
    }
  },

  fetchIssueDetail: async (repoPath: string, number: number) => {
    set({ isLoadingIssueDetail: true });
    try {
      const selectedIssue = await invoke<IssueDetail>("github_get_issue", {
        repoPath,
        number,
      });
      set({ selectedIssue, isLoadingIssueDetail: false });
    } catch (err) {
      console.error("Failed to fetch issue detail:", err);
      set({ isLoadingIssueDetail: false });
    }
  },

  closeIssue: async (repoPath: string, number: number) => {
    await invoke("github_close_issue", { repoPath, number });
    // Refresh issue list and detail
    await get().fetchIssues(repoPath);
    await get().fetchIssueDetail(repoPath, number);
  },

  reopenIssue: async (repoPath: string, number: number) => {
    await invoke("github_reopen_issue", { repoPath, number });
    // Refresh issue list and detail
    await get().fetchIssues(repoPath);
    await get().fetchIssueDetail(repoPath, number);
  },

  commentIssue: async (repoPath: string, number: number, body: string) => {
    await invoke("github_comment_issue", { repoPath, number, body });
    // Refresh issue detail to show the new comment
    await get().fetchIssueDetail(repoPath, number);
  },

  clearSelectedIssue: () => {
    set({ selectedIssue: null });
  },

  fetchDiscussionDetail: async (repoPath: string, number: number) => {
    set({ isLoadingDiscussionDetail: true });
    try {
      const selectedDiscussion = await invoke<DiscussionDetail>(
        "github_get_discussion",
        { repoPath, number }
      );
      set({ selectedDiscussion, isLoadingDiscussionDetail: false });
    } catch (err) {
      console.error("Failed to fetch discussion detail:", err);
      set({ isLoadingDiscussionDetail: false });
    }
  },

  commentDiscussion: async (repoPath: string, number: number, body: string) => {
    await invoke("github_comment_discussion", { repoPath, number, body });
    // Refresh discussion detail to show the new comment
    await get().fetchDiscussionDetail(repoPath, number);
  },

  clearSelectedDiscussion: () => {
    set({ selectedDiscussion: null });
  },

  setPrFilter: (filter: PrFilterState) => {
    set({ prFilter: filter });
  },

  setIssueFilter: (filter: IssueFilterState) => {
    set({ issueFilter: filter });
  },

  clearSelectedPR: () => {
    set({ selectedPR: null });
  },

  reset: () => {
    set({
      authStatus: null,
      isCheckingAuth: false,
      pullRequests: [],
      prFilter: "open",
      isPRsLoading: false,
      prsError: null,
      selectedPR: null,
      isLoadingPRDetail: false,
      issues: [],
      issueFilter: "open",
      isIssuesLoading: false,
      issuesError: null,
      discussions: [],
      isDiscussionsLoading: false,
      discussionsError: null,
      discussionsEnabled: true,
      selectedIssue: null,
      isLoadingIssueDetail: false,
      selectedDiscussion: null,
      isLoadingDiscussionDetail: false,
    });
  },
}));
