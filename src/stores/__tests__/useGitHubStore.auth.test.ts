import { describe, it, expect, beforeEach, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { useGitHubStore } from "../useGitHubStore";

function resetStore() {
  useGitHubStore.getState().reset();
}

describe("useGitHubStore authError handling", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetStore();
  });

  it("populates authError when the auth check throws", async () => {
    const err = "GitHub CLI (gh) not found. Install it from https://cli.github.com";
    invokeMock.mockRejectedValueOnce(err);

    await useGitHubStore.getState().checkAuth("/repo");

    const state = useGitHubStore.getState();
    expect(state.authError).toBe(err);
    expect(state.authStatus).toEqual({ logged_in: false, username: null, scopes: [] });
    expect(state.isCheckingAuth).toBe(false);
  });

  it("clears authError on a successful auth check", async () => {
    useGitHubStore.setState({ authError: "stale error" });
    invokeMock.mockResolvedValueOnce({
      logged_in: true,
      username: "octocat",
      scopes: ["repo"],
    });

    await useGitHubStore.getState().checkAuth("/repo");

    expect(useGitHubStore.getState().authError).toBeNull();
  });

  it("clears authError at the start of a new auth check", async () => {
    useGitHubStore.setState({ authError: "stale error" });
    let observedDuringCheck: string | null | undefined;
    invokeMock.mockImplementationOnce(() => {
      observedDuringCheck = useGitHubStore.getState().authError;
      return Promise.resolve({ logged_in: true, username: null, scopes: [] });
    });

    await useGitHubStore.getState().checkAuth("/repo");

    expect(observedDuringCheck).toBeNull();
  });

  it("clears authError on reset()", () => {
    useGitHubStore.setState({ authError: "some error" });

    useGitHubStore.getState().reset();

    expect(useGitHubStore.getState().authError).toBeNull();
  });
});
