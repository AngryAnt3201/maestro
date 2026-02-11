import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BranchDropdown } from "../BranchDropdown";

// Mock invoke — return empty branch list by default
const mockInvoke = vi.fn().mockResolvedValue([]);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe("BranchDropdown", () => {
  const defaultProps = {
    repoPath: "/tmp/test-repo",
    currentBranch: "main",
    onSelect: vi.fn(),
    onCreateBranch: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue([
      { name: "main", is_remote: false, is_current: true },
      { name: "develop", is_remote: false, is_current: false },
    ]);
  });

  it("renders 'Create New Branch' button", async () => {
    render(<BranchDropdown {...defaultProps} />);
    expect(screen.getByText("Create New Branch")).toBeInTheDocument();
  });

  it("clicking 'Create New Branch' shows input field with two action buttons", async () => {
    render(<BranchDropdown {...defaultProps} />);

    fireEvent.click(screen.getByText("Create New Branch"));

    expect(screen.getByPlaceholderText("feature/my-branch")).toBeInTheDocument();
    expect(screen.getByTitle("Create branch without switching")).toBeInTheDocument();
    expect(screen.getByTitle("Create branch and switch to it")).toBeInTheDocument();
  });

  it("'Create' button calls onCreateBranch(name, false)", async () => {
    render(<BranchDropdown {...defaultProps} />);

    fireEvent.click(screen.getByText("Create New Branch"));
    fireEvent.change(screen.getByPlaceholderText("feature/my-branch"), {
      target: { value: "feature/test" },
    });
    fireEvent.click(screen.getByTitle("Create branch without switching"));

    await waitFor(() => {
      expect(defaultProps.onCreateBranch).toHaveBeenCalledWith("feature/test", false);
    });
  });

  it("'Create & Switch' button calls onCreateBranch(name, true)", async () => {
    render(<BranchDropdown {...defaultProps} />);

    fireEvent.click(screen.getByText("Create New Branch"));
    fireEvent.change(screen.getByPlaceholderText("feature/my-branch"), {
      target: { value: "feature/switch" },
    });
    fireEvent.click(screen.getByTitle("Create branch and switch to it"));

    await waitFor(() => {
      expect(defaultProps.onCreateBranch).toHaveBeenCalledWith("feature/switch", true);
    });
  });

  it("Enter key triggers onCreateBranch(name, true) (default = switch)", async () => {
    render(<BranchDropdown {...defaultProps} />);

    fireEvent.click(screen.getByText("Create New Branch"));
    const input = screen.getByPlaceholderText("feature/my-branch");
    fireEvent.change(input, { target: { value: "feature/enter" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(defaultProps.onCreateBranch).toHaveBeenCalledWith("feature/enter", true);
    });
  });

  it("Escape key hides the create input", () => {
    render(<BranchDropdown {...defaultProps} />);

    fireEvent.click(screen.getByText("Create New Branch"));
    expect(screen.getByPlaceholderText("feature/my-branch")).toBeInTheDocument();

    const input = screen.getByPlaceholderText("feature/my-branch");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByPlaceholderText("feature/my-branch")).not.toBeInTheDocument();
    expect(screen.getByText("Create New Branch")).toBeInTheDocument();
  });

  it("invalid branch name shows validation error", async () => {
    render(<BranchDropdown {...defaultProps} />);

    fireEvent.click(screen.getByText("Create New Branch"));
    fireEvent.change(screen.getByPlaceholderText("feature/my-branch"), {
      target: { value: "bad name with spaces" },
    });
    fireEvent.click(screen.getByTitle("Create branch and switch to it"));

    await waitFor(() => {
      expect(
        screen.getByText("Invalid branch name. Use only letters, numbers, dots, dashes, and slashes.")
      ).toBeInTheDocument();
    });

    // Should NOT call onCreateBranch
    expect(defaultProps.onCreateBranch).not.toHaveBeenCalled();
  });

  it("empty input disables both action buttons", () => {
    render(<BranchDropdown {...defaultProps} />);

    fireEvent.click(screen.getByText("Create New Branch"));

    const createBtn = screen.getByTitle("Create branch without switching");
    const switchBtn = screen.getByTitle("Create branch and switch to it");

    expect(createBtn).toBeDisabled();
    expect(switchBtn).toBeDisabled();
  });

  it("after successful creation, input resets and hides", async () => {
    render(<BranchDropdown {...defaultProps} />);

    fireEvent.click(screen.getByText("Create New Branch"));
    fireEvent.change(screen.getByPlaceholderText("feature/my-branch"), {
      target: { value: "feature/new" },
    });
    fireEvent.click(screen.getByTitle("Create branch and switch to it"));

    await waitFor(() => {
      expect(defaultProps.onCreateBranch).toHaveBeenCalledWith("feature/new", true);
    });

    // After creation, should show the "Create New Branch" button again
    await waitFor(() => {
      expect(screen.getByText("Create New Branch")).toBeInTheDocument();
    });

    // Input should not be visible
    expect(screen.queryByPlaceholderText("feature/my-branch")).not.toBeInTheDocument();
  });
});
