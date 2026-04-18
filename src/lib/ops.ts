import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Dispatch,
  DispatchFinishedEvent,
  DispatchOutputEvent,
  DispatchStartedEvent,
  DriverCapsResponse,
  ExternalJob,
  HooksSnapshot,
  Job,
  Scope,
  SecretEntry,
  Tool,
} from "@/types/ops";

export async function loadJobs(scope: Scope, projectHash?: string): Promise<Job[]> {
  return invoke("ops_load_jobs", { scope, projectHash });
}

export async function saveJob(scope: Scope, job: Job, projectHash?: string): Promise<Job> {
  return invoke("ops_save_job", { scope, projectHash, job });
}

export async function deleteJob(scope: Scope, jobId: string, projectHash?: string): Promise<void> {
  return invoke("ops_delete_job", { scope, projectHash, jobId });
}

export async function runNow(scope: Scope, jobId: string, projectHash?: string): Promise<string> {
  return invoke("ops_run_now", { scope, projectHash, jobId });
}

export async function recentDispatches(
  scope: Scope,
  projectHash?: string,
  limit = 100,
): Promise<Dispatch[]> {
  return invoke("ops_recent_dispatches", { scope, projectHash, limit });
}

export async function loadTools(): Promise<Tool[]> {
  return invoke("ops_load_tools");
}

export async function saveTool(tool: Tool): Promise<Tool> {
  return invoke("ops_save_tool", { tool });
}

export async function deleteTool(toolId: string): Promise<void> {
  return invoke("ops_delete_tool", { toolId });
}

export async function listExternalTriggers(): Promise<ExternalJob[]> {
  return invoke("ops_list_external_triggers");
}

export async function readLogTail(
  scope: Scope,
  dispatchId: string,
  projectHash?: string,
  maxBytes = 64 * 1024,
): Promise<string> {
  return invoke("ops_read_log_tail", { scope, projectHash, dispatchId, maxBytes });
}

export async function projectHash(projectPath: string): Promise<string> {
  return invoke("ops_project_hash", { projectPath });
}

export async function driverCapabilities(): Promise<DriverCapsResponse> {
  return invoke("ops_driver_capabilities");
}

export type OpsEventHandlers = {
  onStarted?: (e: DispatchStartedEvent) => void;
  onOutput?: (e: DispatchOutputEvent) => void;
  onFinished?: (e: DispatchFinishedEvent) => void;
  onJobsUpdated?: () => void;
};

export async function subscribeOpsEvents(h: OpsEventHandlers): Promise<UnlistenFn> {
  const unlisteners: UnlistenFn[] = [];
  if (h.onStarted)
    unlisteners.push(
      await listen<DispatchStartedEvent>("ops://dispatch-started", (e) => h.onStarted?.(e.payload)),
    );
  if (h.onOutput)
    unlisteners.push(
      await listen<DispatchOutputEvent>("ops://dispatch-output", (e) => h.onOutput?.(e.payload)),
    );
  if (h.onFinished)
    unlisteners.push(
      await listen<DispatchFinishedEvent>("ops://dispatch-finished", (e) =>
        h.onFinished?.(e.payload),
      ),
    );
  if (h.onJobsUpdated)
    unlisteners.push(await listen("ops://jobs-updated", () => h.onJobsUpdated?.()));
  return () => { for (const u of unlisteners) u(); };
}

export async function readHooks(projectPath?: string): Promise<HooksSnapshot> {
  return invoke("ops_read_hooks", { projectPath });
}

export async function toggleHook(projectPath: string | undefined, id: string, enable: boolean): Promise<void> {
  return invoke("ops_toggle_hook", { projectPath, id, enable });
}

export async function listSecrets(): Promise<SecretEntry[]> {
  return invoke("ops_list_secrets");
}

export async function putSecret(entry: SecretEntry, value: string): Promise<SecretEntry> {
  return invoke("ops_put_secret", { entry, value });
}

export async function deleteSecret(id: string): Promise<void> {
  return invoke("ops_delete_secret", { id });
}
