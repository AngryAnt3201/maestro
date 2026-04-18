export type Scope = "global" | "project";
export type JobDriver = "maestro" | "claude-trigger";
export type DispatchStatus = "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
export type TriggeredBy = "schedule" | "manual" | "webhook";

export interface MaestroJobPayload {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  timeoutSec?: number;
}

export interface ClaudeTriggerPayload {
  triggerId?: string;
  prompt: string;
  mcpConnectors: string[];
  defaultRepo?: string;
}

export interface LastDispatch {
  id: string;
  startedAt: number;
  status: DispatchStatus;
}

export interface Job {
  id: string;
  name: string;
  enabled: boolean;
  scope: Scope;
  projectHash?: string;
  tags: string[];
  driver: JobDriver;
  schedule?: string;
  maestro?: MaestroJobPayload;
  claudeTrigger?: ClaudeTriggerPayload;
  toolId?: string;
  notifyOnFailure: boolean;
  lastDispatch?: LastDispatch;
  createdAt: number;
  updatedAt: number;
}

export interface Dispatch {
  id: string;
  jobId: string;
  scope: Scope;
  projectHash?: string;
  startedAt: number;
  endedAt?: number;
  status: DispatchStatus;
  exitCode?: number;
  triggeredBy: TriggeredBy;
  outputHead: string;
  logPath?: string;
  tokens?: number;
  durationMs?: number;
}

export interface ToolDefaults {
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

export interface Tool {
  id: string;
  name: string;
  binary: string;
  installCheck?: string;
  docsUrl?: string;
  icon?: string;
  defaults: ToolDefaults;
  createdAt: number;
}

export interface ExternalJob {
  externalId: string;
  name: string;
  schedule?: string;
  prompt?: string;
  lastRunAt?: number;
  nextRunAt?: number;
}

export interface DriverCapabilities {
  supportsDelete: boolean;
  supportsRawEnv: boolean;
  supportsLocalLogs: boolean;
  supportsMcpConnectors: boolean;
  minIntervalSeconds: number;
}

export interface DriverCapsResponse {
  maestro: DriverCapabilities;
  claudeTrigger: DriverCapabilities;
}

export interface DispatchStartedEvent {
  dispatchId: string;
  jobId: string;
}
export interface DispatchOutputEvent {
  dispatchId: string;
  chunk: string;
  isStderr: boolean;
}
export interface DispatchFinishedEvent {
  dispatchId: string;
  status: DispatchStatus;
  exitCode?: number;
  tokens?: number;
}

export type HookEvent = "PreToolUse" | "PostToolUse" | "Stop" | "SubagentStop" | "SessionStart" | "SessionEnd" | "UserPromptSubmit" | "PreCompact" | "Notification";

export interface HookEntry {
  id: string;                 // synthesized: `${scope}:${event}:${index}`
  scope: "global" | "project";
  event: HookEvent;
  matcher?: string;           // tool name pattern
  command: string;            // shell command
  enabled: boolean;
}

export interface HooksSnapshot {
  global: HookEntry[];
  project: HookEntry[];
}
