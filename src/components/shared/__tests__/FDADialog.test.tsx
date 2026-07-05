import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FDADialog } from "../FDADialog";

// Mock the permissions module
const mockRequestFullDiskAccess = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/permissions", () => ({
  requestFullDiskAccess: (...args: unknown[]) => mockRequestFullDiskAccess(...args),
}));

describe("FDADialog", () => {
  const defaultProps = {
    path: "/Users/john/Desktop/my-project",
    onDismiss: vi.fn(),
    onDismissPermanently: vi.fn(),
    onRetry: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the title", () => {
    render(<FDADialog {...defaultProps} />);
    expect(screen.getByText("Full Disk Access Required")).toBeInTheDocument();
  });

  it("shows the folder name from path prop", () => {
    render(<FDADialog {...defaultProps} />);
    expect(screen.getByText("my-project")).toBeInTheDocument();
  });

  it("shows the full path in mono display", () => {
    render(<FDADialog {...defaultProps} />);
    expect(screen.getByText("/Users/john/Desktop/my-project")).toBeInTheDocument();
  });

  it("shows fallback folder name when path is null", () => {
    render(<FDADialog {...defaultProps} path={null} />);
    expect(screen.getByText("this folder")).toBeInTheDocument();
  });

  it("'Open System Settings' button calls requestFullDiskAccess", async () => {
    render(<FDADialog {...defaultProps} />);

    const button = screen.getByText("Open System Settings");
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockRequestFullDiskAccess).toHaveBeenCalledTimes(1);
    });
  });

  it("'I've Granted Access' button calls onRetry", async () => {
    render(<FDADialog {...defaultProps} />);

    const button = screen.getByText("I've Granted Access");
    fireEvent.click(button);

    await waitFor(() => {
      expect(defaultProps.onRetry).toHaveBeenCalledTimes(1);
    });
  });

  it("'I've Granted Access' button shows spinner while retrying", async () => {
    // Make onRetry hang so we can observe the spinner state
    let resolveRetry!: () => void;
    const retryPromise = new Promise<void>((resolve) => {
      resolveRetry = resolve;
    });
    const onRetry = vi.fn().mockReturnValue(retryPromise);

    render(<FDADialog {...defaultProps} onRetry={onRetry} />);

    const button = screen.getByText("I've Granted Access");
    fireEvent.click(button);

    // Should show "Checking..." while in progress
    await waitFor(() => {
      expect(screen.getByText("Checking...")).toBeInTheDocument();
    });

    // Resolve and verify it goes back to normal
    resolveRetry();
    await waitFor(() => {
      expect(screen.getByText("I've Granted Access")).toBeInTheDocument();
    });
  });

  it("close button calls onDismiss", () => {
    render(<FDADialog {...defaultProps} />);

    const closeButton = screen.getByLabelText("Close");
    fireEvent.click(closeButton);

    expect(defaultProps.onDismiss).toHaveBeenCalledTimes(1);
  });

  it("'Don't ask again' button calls onDismissPermanently", () => {
    render(<FDADialog {...defaultProps} />);

    const button = screen.getByText("Don't ask again");
    fireEvent.click(button);

    expect(defaultProps.onDismissPermanently).toHaveBeenCalledTimes(1);
  });

  it("mentions external drives don't need permission", () => {
    render(<FDADialog {...defaultProps} />);
    expect(screen.getByText("external drives")).toBeInTheDocument();
    expect(screen.getByText("network mounts")).toBeInTheDocument();
  });
});
