import { create } from "zustand";
import type { Dispatch, DriverCapsResponse, Job, Scope, Tool } from "@/types/ops";
import * as api from "@/lib/ops";

interface LiveRun {
  dispatchId: string;
  jobId: string;
  startedAt: number;
  lastLine: string;
}

type ScopeKey = string;
function keyFor(scope: Scope, projectHash?: string): ScopeKey {
  return scope === "global" ? "global" : `project:${projectHash ?? ""}`;
}

interface OpsState {
  jobsByScope: Record<ScopeKey, Job[]>;
  dispatchesByScope: Record<ScopeKey, Dispatch[]>;
  tools: Tool[];
  live: Record<string, LiveRun>;
  caps?: DriverCapsResponse;
  scopeFilter: "all" | "project" | "global";

  loadJobs: (scope: Scope, projectHash?: string) => Promise<void>;
  loadDispatches: (scope: Scope, projectHash?: string) => Promise<void>;
  loadTools: () => Promise<void>;
  loadCapabilities: () => Promise<void>;

  saveJob: (scope: Scope, job: Job, projectHash?: string) => Promise<Job>;
  deleteJob: (scope: Scope, jobId: string, projectHash?: string) => Promise<void>;
  runNow: (scope: Scope, jobId: string, projectHash?: string) => Promise<void>;
  saveTool: (tool: Tool) => Promise<Tool>;
  deleteTool: (toolId: string) => Promise<void>;

  setScopeFilter: (f: "all" | "project" | "global") => void;

  _onStarted: (dispatchId: string, jobId: string) => void;
  _onOutput: (dispatchId: string, chunk: string, isStderr: boolean) => void;
  _onFinished: (dispatchId: string) => void;
}

export const useOpsStore = create<OpsState>((set, get) => ({
  jobsByScope: {},
  dispatchesByScope: {},
  tools: [],
  live: {},
  caps: undefined,
  scopeFilter: "all",

  loadJobs: async (scope, projectHash) => {
    const jobs = await api.loadJobs(scope, projectHash);
    set((s) => ({ jobsByScope: { ...s.jobsByScope, [keyFor(scope, projectHash)]: jobs } }));
  },

  loadDispatches: async (scope, projectHash) => {
    const d = await api.recentDispatches(scope, projectHash, 100);
    set((s) => ({ dispatchesByScope: { ...s.dispatchesByScope, [keyFor(scope, projectHash)]: d } }));
  },

  loadTools: async () => {
    const tools = await api.loadTools();
    if (tools.length === 0) {
      const seeds: Tool[] = [
        { id: "", name: "Claude Code", binary: "claude", icon: "sparkles", defaults: { args: [], env: {} }, createdAt: 0 },
        { id: "", name: "Bash", binary: "bash", icon: "terminal", defaults: { args: ["-lc"], env: {} }, createdAt: 0 },
      ];
      for (const s of seeds) await api.saveTool(s);
      set({ tools: await api.loadTools() });
    } else {
      set({ tools });
    }
  },
  loadCapabilities: async () => set({ caps: await api.driverCapabilities() }),

  saveJob: async (scope, job, projectHash) => {
    const saved = await api.saveJob(scope, job, projectHash);
    await get().loadJobs(scope, projectHash);
    return saved;
  },
  deleteJob: async (scope, jobId, projectHash) => {
    await api.deleteJob(scope, jobId, projectHash);
    await get().loadJobs(scope, projectHash);
  },
  runNow: async (scope, jobId, projectHash) => {
    await api.runNow(scope, jobId, projectHash);
  },
  saveTool: async (tool) => {
    const saved = await api.saveTool(tool);
    await get().loadTools();
    return saved;
  },
  deleteTool: async (id) => {
    await api.deleteTool(id);
    await get().loadTools();
  },

  setScopeFilter: (f) => set({ scopeFilter: f }),

  _onStarted: (dispatchId, jobId) =>
    set((s) => ({
      live: {
        ...s.live,
        [dispatchId]: { dispatchId, jobId, startedAt: Date.now(), lastLine: "" },
      },
    })),
  _onOutput: (dispatchId, chunk) =>
    set((s) => {
      const current = s.live[dispatchId];
      if (!current) return s;
      const lastLine = chunk.trim().split("\n").at(-1) ?? current.lastLine;
      return { live: { ...s.live, [dispatchId]: { ...current, lastLine } } };
    }),
  _onFinished: (dispatchId) =>
    set((s) => {
      const { [dispatchId]: _removed, ...rest } = s.live;
      return { live: rest };
    }),
}));

/** Call once at app startup to wire backend events into the store. */
export async function initOpsEventSubscriptions(): Promise<() => void> {
  return api.subscribeOpsEvents({
    onStarted: (e) => useOpsStore.getState()._onStarted(e.dispatchId, e.jobId),
    onOutput: (e) => useOpsStore.getState()._onOutput(e.dispatchId, e.chunk, e.isStderr),
    onFinished: (e) => useOpsStore.getState()._onFinished(e.dispatchId),
    onJobsUpdated: () => {
      const { jobsByScope } = useOpsStore.getState();
      Object.keys(jobsByScope).forEach((k) => {
        const parts = k.split(":");
        if (parts[0] === "global") useOpsStore.getState().loadJobs("global");
        else if (parts[0] === "project" && parts[1]) useOpsStore.getState().loadJobs("project", parts[1]);
      });
    },
  });
}
