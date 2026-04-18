import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/ops", () => ({
  loadJobs: vi.fn(async () => []),
  recentDispatches: vi.fn(async () => []),
  loadTools: vi.fn(async () => []),
  driverCapabilities: vi.fn(async () => ({
    maestro: {
      supportsDelete: true,
      supportsRawEnv: true,
      supportsLocalLogs: true,
      supportsMcpConnectors: false,
      minIntervalSeconds: 0,
    },
    claudeTrigger: {
      supportsDelete: false,
      supportsRawEnv: false,
      supportsLocalLogs: false,
      supportsMcpConnectors: true,
      minIntervalSeconds: 3600,
    },
  })),
  saveJob: vi.fn(async (_s, j) => j),
  deleteJob: vi.fn(async () => {}),
  runNow: vi.fn(async () => "d1"),
  saveTool: vi.fn(async (t) => t),
  deleteTool: vi.fn(async () => {}),
  subscribeOpsEvents: vi.fn(async () => () => {}),
}));

import { useOpsStore } from "../useOpsStore";

describe("useOpsStore", () => {
  beforeEach(() => {
    useOpsStore.setState({
      jobsByScope: {},
      dispatchesByScope: {},
      tools: [],
      live: {},
      caps: undefined,
      scopeFilter: "all",
    });
  });

  it("tracks a live run from started to finished", () => {
    useOpsStore.getState()._onStarted("d1", "j1");
    expect(useOpsStore.getState().live["d1"]).toBeDefined();
    useOpsStore.getState()._onOutput("d1", "hello\nworld\n", false);
    expect(useOpsStore.getState().live["d1"].lastLine).toBe("world");
    useOpsStore.getState()._onFinished("d1");
    expect(useOpsStore.getState().live["d1"]).toBeUndefined();
  });
});
