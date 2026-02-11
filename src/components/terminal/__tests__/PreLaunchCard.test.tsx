import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PreLaunchCard, type SessionSlot } from "../PreLaunchCard";

describe("PreLaunchCard branch creation", () => {
  const makeSlot = (overrides?: Partial<SessionSlot>): SessionSlot => ({
    id: "slot-1",
    mode: "Claude",
    branch: null,
    sessionId: null,
    worktreePath: null,
    worktreeWarning: null,
    enabledMcpServers: [],
    enabledSkills: [],
    enabledPlugins: [],
    ...overrides,
  });

  const defaultProps = {
    slot: makeSlot(),
    projectPath: "/tmp/test-repo",
    branches: [
      { name: "main", isRemote: false, isCurrent: true, hasWorktree: false },
      { name: "develop", isRemote: false, isCurrent: false, hasWorktree: false },
    ],
    isLoadingBranches: false,
    isGitRepo: true,
    mcpServers: [],
    skills: [],
    plugins: [],
    onModeChange: vi.fn(),
    onBranchChange: vi.fn(),
    onMcpToggle: vi.fn(),
    onSkillToggle: vi.fn(),
    onPluginToggle: vi.fn(),
    onMcpSelectAll: vi.fn(),
    onMcpUnselectAll: vi.fn(),
    onPluginsSelectAll: vi.fn(),
    onPluginsUnselectAll: vi.fn(),
    onLaunch: vi.fn(),
    onRemove: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Helper to open the branch dropdown */
  function openBranchDropdown() {
    // The branch selector button contains the display branch name ("main")
    // and a GitBranch icon. Find and click it.
    const branchButton = screen.getByText("main").closest("button");
    if (branchButton) fireEvent.click(branchButton);
  }

  it("shows 'Create New Branch' button in branch dropdown when onCreateBranch is provided", () => {
    const onCreateBranch = vi.fn().mockResolvedValue(undefined);
    render(<PreLaunchCard {...defaultProps} onCreateBranch={onCreateBranch} />);

    openBranchDropdown();

    expect(screen.getByText("Create New Branch")).toBeInTheDocument();
  });

  it("does NOT show 'Create New Branch' when onCreateBranch prop is omitted", () => {
    render(<PreLaunchCard {...defaultProps} />);

    openBranchDropdown();

    expect(screen.queryByText("Create New Branch")).not.toBeInTheDocument();
  });

  it("clicking 'Create New Branch' shows input with 'Create' and 'Create & Select' buttons", () => {
    const onCreateBranch = vi.fn().mockResolvedValue(undefined);
    render(<PreLaunchCard {...defaultProps} onCreateBranch={onCreateBranch} />);

    openBranchDropdown();
    fireEvent.click(screen.getByText("Create New Branch"));

    expect(screen.getByPlaceholderText("feature/my-branch")).toBeInTheDocument();
    expect(screen.getByTitle("Create branch without selecting")).toBeInTheDocument();
    expect(screen.getByTitle("Create branch and select it")).toBeInTheDocument();
  });

  it("'Create' calls onCreateBranch(name, false) and does NOT call onBranchChange", async () => {
    const onCreateBranch = vi.fn().mockResolvedValue(undefined);
    render(<PreLaunchCard {...defaultProps} onCreateBranch={onCreateBranch} />);

    openBranchDropdown();
    fireEvent.click(screen.getByText("Create New Branch"));
    fireEvent.change(screen.getByPlaceholderText("feature/my-branch"), {
      target: { value: "feature/test" },
    });
    fireEvent.click(screen.getByTitle("Create branch without selecting"));

    await waitFor(() => {
      expect(onCreateBranch).toHaveBeenCalledWith("feature/test", false);
    });
    // onBranchChange should NOT be called by the "Create" button
    expect(defaultProps.onBranchChange).not.toHaveBeenCalled();
  });

  it("'Create & Select' calls onCreateBranch(name, false) and then onBranchChange(name)", async () => {
    const onCreateBranch = vi.fn().mockResolvedValue(undefined);
    render(<PreLaunchCard {...defaultProps} onCreateBranch={onCreateBranch} />);

    openBranchDropdown();
    fireEvent.click(screen.getByText("Create New Branch"));
    fireEvent.change(screen.getByPlaceholderText("feature/my-branch"), {
      target: { value: "feature/select" },
    });
    fireEvent.click(screen.getByTitle("Create branch and select it"));

    await waitFor(() => {
      expect(onCreateBranch).toHaveBeenCalledWith("feature/select", false);
    });
    await waitFor(() => {
      expect(defaultProps.onBranchChange).toHaveBeenCalledWith("feature/select");
    });
  });

  it("invalid branch name shows validation error", async () => {
    const onCreateBranch = vi.fn().mockResolvedValue(undefined);
    render(<PreLaunchCard {...defaultProps} onCreateBranch={onCreateBranch} />);

    openBranchDropdown();
    fireEvent.click(screen.getByText("Create New Branch"));
    fireEvent.change(screen.getByPlaceholderText("feature/my-branch"), {
      target: { value: "bad name with spaces" },
    });
    fireEvent.click(screen.getByTitle("Create branch and select it"));

    await waitFor(() => {
      expect(
        screen.getByText("Invalid name. Use letters, numbers, dots, dashes, slashes.")
      ).toBeInTheDocument();
    });
    expect(onCreateBranch).not.toHaveBeenCalled();
  });

  it("Escape closes the creation input", () => {
    const onCreateBranch = vi.fn().mockResolvedValue(undefined);
    render(<PreLaunchCard {...defaultProps} onCreateBranch={onCreateBranch} />);

    openBranchDropdown();
    fireEvent.click(screen.getByText("Create New Branch"));

    const input = screen.getByPlaceholderText("feature/my-branch");
    expect(input).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByPlaceholderText("feature/my-branch")).not.toBeInTheDocument();
    expect(screen.getByText("Create New Branch")).toBeInTheDocument();
  });
});
