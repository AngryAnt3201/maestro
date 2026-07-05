import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock modules before imports
const mockOpenProject = vi.fn();
vi.mock("@/stores/useWorkspaceStore", () => ({
  useWorkspaceStore: (selector: (s: { openProject: typeof mockOpenProject }) => unknown) =>
    selector({ openProject: mockOpenProject }),
}));

vi.mock("@/lib/dialog", () => ({
  pickProjectFolder: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  pathRequiresFDA: vi.fn(),
  checkFullDiskAccess: vi.fn(),
  ensurePathAccess: vi.fn(),
}));

import { pickProjectFolder } from "@/lib/dialog";
import { checkFullDiskAccess, pathRequiresFDA } from "@/lib/permissions";
import { useFDAStore } from "@/stores/useFDAStore";
import { useOpenProject } from "../useOpenProject";

const mockPickProjectFolder = vi.mocked(pickProjectFolder);
const mockPathRequiresFDA = vi.mocked(pathRequiresFDA);
const mockCheckFullDiskAccess = vi.mocked(checkFullDiskAccess);

describe("useOpenProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Reset the FDA store between tests
    useFDAStore.setState({
      showDialog: false,
      pendingPath: null,
      pendingCallback: null,
    });
  });

  it("returns the expected shape", () => {
    const { result } = renderHook(() => useOpenProject());
    expect(result.current).toHaveProperty("openProject");
    expect(typeof result.current.openProject).toBe("function");
  });

  it("opens project directly for non-FDA paths", async () => {
    mockPickProjectFolder.mockResolvedValue("/Users/john/Projects/repo");
    mockPathRequiresFDA.mockReturnValue(false);

    const { result } = renderHook(() => useOpenProject());

    await act(async () => {
      await result.current.openProject();
    });

    expect(mockOpenProject).toHaveBeenCalledWith("/Users/john/Projects/repo");
    expect(useFDAStore.getState().showDialog).toBe(false);
  });

  it("opens project directly when FDA path has access", async () => {
    mockPickProjectFolder.mockResolvedValue("/Users/john/Desktop/project");
    mockPathRequiresFDA.mockReturnValue(true);
    mockCheckFullDiskAccess.mockResolvedValue(true);

    const { result } = renderHook(() => useOpenProject());

    await act(async () => {
      await result.current.openProject();
    });

    expect(mockOpenProject).toHaveBeenCalledWith("/Users/john/Desktop/project");
    expect(useFDAStore.getState().showDialog).toBe(false);
  });

  it("shows FDA dialog for FDA paths without access", async () => {
    mockPickProjectFolder.mockResolvedValue("/Users/john/Desktop/project");
    mockPathRequiresFDA.mockReturnValue(true);
    mockCheckFullDiskAccess.mockResolvedValue(false);

    const { result } = renderHook(() => useOpenProject());

    await act(async () => {
      await result.current.openProject();
    });

    expect(mockOpenProject).not.toHaveBeenCalled();
    expect(useFDAStore.getState().showDialog).toBe(true);
    expect(useFDAStore.getState().pendingPath).toBe("/Users/john/Desktop/project");
  });

  it("does nothing when user cancels folder picker", async () => {
    mockPickProjectFolder.mockResolvedValue(null);

    const { result } = renderHook(() => useOpenProject());

    await act(async () => {
      await result.current.openProject();
    });

    expect(mockOpenProject).not.toHaveBeenCalled();
    expect(useFDAStore.getState().showDialog).toBe(false);
  });

  it("dismiss clears state without opening project", async () => {
    // First trigger the dialog
    mockPickProjectFolder.mockResolvedValue("/Users/john/Desktop/project");
    mockPathRequiresFDA.mockReturnValue(true);
    mockCheckFullDiskAccess.mockResolvedValue(false);

    const { result } = renderHook(() => useOpenProject());

    await act(async () => {
      await result.current.openProject();
    });

    expect(useFDAStore.getState().showDialog).toBe(true);

    act(() => {
      useFDAStore.getState().dismiss();
    });

    expect(useFDAStore.getState().showDialog).toBe(false);
    expect(useFDAStore.getState().pendingPath).toBeNull();
    expect(mockOpenProject).not.toHaveBeenCalled();
  });

  it("dismissPermanently sets localStorage flag, clears state, does NOT open project", async () => {
    // First trigger the dialog
    mockPickProjectFolder.mockResolvedValue("/Users/john/Desktop/project");
    mockPathRequiresFDA.mockReturnValue(true);
    mockCheckFullDiskAccess.mockResolvedValue(false);

    const { result } = renderHook(() => useOpenProject());

    await act(async () => {
      await result.current.openProject();
    });

    expect(useFDAStore.getState().showDialog).toBe(true);

    act(() => {
      useFDAStore.getState().dismissPermanently();
    });

    expect(useFDAStore.getState().showDialog).toBe(false);
    expect(useFDAStore.getState().pendingPath).toBeNull();
    expect(localStorage.getItem("maestro:permissions:fda-dismissed")).toBe("true");
    expect(mockOpenProject).not.toHaveBeenCalled();
  });

  it("retryAfterGrant opens project when access is now granted", async () => {
    // Trigger the dialog
    mockPickProjectFolder.mockResolvedValue("/Users/john/Desktop/project");
    mockPathRequiresFDA.mockReturnValue(true);
    mockCheckFullDiskAccess.mockResolvedValue(false);

    const { result } = renderHook(() => useOpenProject());

    await act(async () => {
      await result.current.openProject();
    });

    expect(useFDAStore.getState().showDialog).toBe(true);

    // Now simulate user granting access
    mockCheckFullDiskAccess.mockResolvedValue(true);

    await act(async () => {
      await useFDAStore.getState().retryAfterGrant();
    });

    expect(mockOpenProject).toHaveBeenCalledWith("/Users/john/Desktop/project");
    expect(useFDAStore.getState().showDialog).toBe(false);
    expect(useFDAStore.getState().pendingPath).toBeNull();
  });

  it("retryAfterGrant keeps dialog open when still no access", async () => {
    // Trigger the dialog
    mockPickProjectFolder.mockResolvedValue("/Users/john/Desktop/project");
    mockPathRequiresFDA.mockReturnValue(true);
    mockCheckFullDiskAccess.mockResolvedValue(false);

    const { result } = renderHook(() => useOpenProject());

    await act(async () => {
      await result.current.openProject();
    });

    // Still no access
    mockCheckFullDiskAccess.mockResolvedValue(false);

    await act(async () => {
      await useFDAStore.getState().retryAfterGrant();
    });

    expect(mockOpenProject).not.toHaveBeenCalled();
    expect(useFDAStore.getState().showDialog).toBe(true);
  });

  it("dismissed flag skips dialog on subsequent FDA paths", async () => {
    // Set dismissed flag
    localStorage.setItem("maestro:permissions:fda-dismissed", "true");

    mockPickProjectFolder.mockResolvedValue("/Users/john/Desktop/project");
    mockPathRequiresFDA.mockReturnValue(true);
    mockCheckFullDiskAccess.mockResolvedValue(false);

    const { result } = renderHook(() => useOpenProject());

    await act(async () => {
      await result.current.openProject();
    });

    // Should skip dialog and try to open directly
    expect(useFDAStore.getState().showDialog).toBe(false);
    expect(mockOpenProject).toHaveBeenCalledWith("/Users/john/Desktop/project");
  });

  it("dismissed flag auto-clears when FDA is later granted", async () => {
    // Set dismissed flag
    localStorage.setItem("maestro:permissions:fda-dismissed", "true");

    mockPickProjectFolder.mockResolvedValue("/Users/john/Desktop/project");
    mockPathRequiresFDA.mockReturnValue(true);
    // FDA has been granted since dismissal
    mockCheckFullDiskAccess.mockResolvedValue(true);

    const { result } = renderHook(() => useOpenProject());

    await act(async () => {
      await result.current.openProject();
    });

    // Should clear the dismissed flag
    expect(localStorage.getItem("maestro:permissions:fda-dismissed")).toBeNull();
    // And open the project
    expect(mockOpenProject).toHaveBeenCalledWith("/Users/john/Desktop/project");
  });
});
