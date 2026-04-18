# Ops Panel Design — Jobs, Cron, Tools, Claude Surfaces

**Date:** 2026-04-18
**Author:** @AngryAnt3201 (brainstormed with Claude)
**Status:** Approved — ready for implementation plan
**Target delivery:** single PR, staged commits (Stage 1 = MVP, Stage 2 = Claude Surfaces + polish)

---

## 1. Goal

Add a new **Ops** tab to the Git panel that gives a visual control surface for:

- Scheduled cron jobs (run arbitrary CLI commands on schedule, or Claude Code's remote triggers)
- One-off dispatches of the same jobs
- A registry of CLI tools used to seed jobs (e.g. the Inflect-Labs `ghd`, `slack-digest`, etc.)
- Read-mostly views for Claude Code's own configurable surfaces: Hooks, MCP servers, Webhooks, Secrets
- A live-run view and full dispatch history with logs

The panel must not hardcode support for any specific CLI tool. Tools are user-registered.

## 2. Non-goals

- Maestro does not become a system-wide scheduler. Scheduled jobs with `driver: maestro` only fire while Maestro is running.
- Maestro does not own Claude Code configuration. Hooks / MCP / Secrets are read and round-tripped to the same files Claude Code reads.
- No custom secret vault — use the OS keychain via a Tauri plugin.

## 3. Data model

Three core entities. TypeScript shapes shown; Rust types in `src-tauri/src/core/ops/model.rs` mirror them.

```ts
type Scope = "global" | "project";
type JobDriver = "maestro" | "claude-trigger";
type DispatchStatus = "running" | "succeeded" | "failed" | "cancelled" | "interrupted";

interface Job {
  id: string;
  name: string;
  enabled: boolean;
  scope: Scope;
  projectHash?: string;       // required when scope === "project"
  tags: string[];
  driver: JobDriver;
  schedule?: string;          // cron expression; absent = manual-only

  // Discriminated payload — exactly one populated
  maestro?: {
    command: string;
    args: string[];
    cwd?: string;             // defaults to project path or $HOME
    env?: Record<string, string>;   // secret IDs, not raw values
    timeoutSec?: number;      // default 900
  };
  claudeTrigger?: {
    triggerId?: string;       // populated after /schedule create
    prompt: string;
    mcpConnectors?: string[]; // e.g. ["gmail", "google-calendar"]
    defaultRepo?: string;
  };

  toolId?: string;            // link back to Tool template
  notifyOnFailure?: boolean;
  lastDispatch?: { id: string; startedAt: number; status: DispatchStatus };
  createdAt: number;
  updatedAt: number;
}

interface Dispatch {
  id: string;
  jobId: string;
  scope: Scope;
  projectHash?: string;
  startedAt: number;
  endedAt?: number;
  status: DispatchStatus;
  exitCode?: number;
  triggeredBy: "schedule" | "manual" | "webhook";
  outputHead: string;         // first ~2 KB of stdout+stderr, inline preview
  logPath?: string;           // full log on disk (maestro driver only)
  tokens?: number;            // claude-trigger driver only
  durationMs?: number;
}

interface Tool {
  id: string;
  name: string;
  binary: string;             // e.g. "ghd"
  installCheck?: string;      // shell command; nonzero = not installed
  docsUrl?: string;
  icon?: string;              // lucide icon name or emoji
  defaults: {
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;             // template: supports "{project}" token
  };
  createdAt: number;
}

interface Secret {
  id: string;
  key: string;                // env var name
  scope: Scope | { kind: "tool"; toolId: string } | { kind: "job"; jobId: string };
  // Value lives in OS keychain; never crosses the Tauri bridge.
}
```

### Scope rules

- Jobs and Tools may be global or project-scoped. Default for new job = project; tools default global.
- Dispatches inherit their job's scope.
- Secrets: `global`, `tool:<toolId>`, or `job:<jobId>`. Resolution order when spawning: job → tool → global.
- Claude-trigger jobs are logically always remote/global at Anthropic's end; we still let users tag them to a project for filtered display.

### Storage

- Global: `~/.claude-maestro/ops/global/{jobs.json,tools.json,dispatches.jsonl}` + `logs/`
- Per-project: `~/.claude-maestro/ops/<projectHash>/{jobs.json,dispatches.jsonl}` + `logs/`
- Log files rotated: last 200 dispatches per job or 30 days, whichever first.
- Secrets: OS keychain via `tauri-plugin-stronghold` (new dependency).

## 4. Architecture

### 4.1 Backend (Rust, `src-tauri/src/`)

```
commands/ops.rs                  # Tauri command handlers
core/ops/
├── mod.rs
├── model.rs                     # Job, Dispatch, Tool, Secret types (serde)
├── store.rs                     # JSON persistence (global + per-project)
├── scheduler.rs                 # tokio cron loop (driver=maestro only)
├── drivers/
│   ├── mod.rs                   # Driver trait
│   ├── maestro.rs               # spawn Command, capture stdout/stderr
│   └── claude_trigger.rs        # proxy via `claude -p /schedule …`
├── dispatch_log.rs              # rolling JSONL + log file rotation
└── keychain.rs                  # secrets via tauri-plugin-stronghold
```

**Driver trait:**

```rust
#[async_trait]
pub trait Driver: Send + Sync {
    async fn create(&self, job: &Job) -> Result<DriverMeta>;
    async fn update(&self, job: &Job) -> Result<()>;
    async fn delete(&self, job: &Job) -> Result<()>;
    async fn run_now(&self, job: &Job, ctx: DispatchContext) -> Result<DispatchId>;
    async fn list_external(&self) -> Result<Vec<ExternalJob>>;  // claude-trigger only
    fn capabilities(&self) -> DriverCapabilities;
}
```

**Capabilities** drive which UI affordances show:

- `maestro`: full CRUD, local run, log streaming, no min-interval, supports secrets-in-env
- `claude-trigger`: create/update/run, no delete (deep link only), 1h min interval, no local log access, no raw env secrets, supports MCP connectors

**Scheduler (maestro driver):** single tokio task; wakes on soonest-next-fire; global concurrency cap (default 4, configurable). On fire: calls driver, emits Tauri events (`ops://dispatch-started`, `ops://dispatch-output`, `ops://dispatch-finished`).

**Claude-trigger proxy:** `claude -p "/schedule …"` spawned as a child process, stdout parsed for trigger IDs and status. Background poller every 5 min calls `list_external()`, merges into local trigger cache, emits `ops://triggers-updated`. Manual refresh available.

**Error handling:**

- Scheduler crash → supervised restart; in-flight dispatches marked `interrupted`.
- Child timeout → SIGTERM → SIGKILL after 5s grace.
- `claude -p /schedule` missing/unauth → actionable banner; affected driver disabled.
- Disk-full on log write → degrade to stderr; banner in UI.
- Repo deleted while job scoped to it → mark job `disabled`.
- Concurrent edit: optimistic lock on `updatedAt`, last-write-wins with toast.

### 4.2 Frontend (TypeScript/React, `src/`)

```
components/ops/
├── OpsPanel.tsx                 # entry; rendered when activeTab === "ops"
├── sections/
│   ├── LiveSection.tsx          # only mounted when running > 0
│   ├── JobsSection.tsx          # scope toggle (All / Project / Global)
│   ├── ToolsSection.tsx
│   ├── SurfacesSection.tsx      # Hooks · MCP · Webhooks · Secrets (Stage 2)
│   └── HistorySection.tsx
├── JobRow.tsx                   # collapsed + inline-expanded states
├── JobDetailPanel.tsx           # slide-over (PR-detail pattern)
├── NewJobWizard.tsx             # driver → command/prompt → schedule
├── DispatchViewer.tsx           # live + past log viewer
└── ClaudeScheduleSyncStatus.tsx
stores/useOpsStore.ts            # Zustand; subscribes to ops://* Tauri events
types/ops.ts                     # mirrors Rust types
```

**Wiring:**

- Extend `GitPanelTab` union with `"ops"`.
- Add tab in `GitPanelTabs.tsx`; new branch in `GitPanelContent.tsx`.
- Slide-over detail reuses the existing `PullRequestDetailPanel` full-width pattern in `GitGraphPanel.tsx`.

**Zustand store:** subscribes once on mount, de-duplicates backend events into reactive state. No frontend polling — backend pushes.

### 4.3 UX flows

- **Create Maestro job:** wizard → optional Tool pick → cwd, env (secret picker), args → optional cron expression → optional failure notifications → Save. Validates cron; runs `installCheck` if Tool-sourced.
- **Create Claude-trigger job:** natural-language prompt field, schedule picker with explicit ≥1h guard, optional MCP connector multi-select, optional default repo. Save runs `claude -p /schedule create` with live stdout in the wizard.
- **Run now:** `▶` on row. Maestro: dispatch starts, row moves to Live section with live duration + last output line. Claude-trigger: `/schedule run`, shows "Queued remotely" status.
- **View history/logs:** `DispatchViewer` opens. Maestro: stream local log. Claude-trigger: cached trigger history + deep-link to claude.ai for full logs.
- **Tools registry:** `+` to register (binary, defaults, icon). Pre-seeded with `claude`, `bash`.
- **Claude Surfaces (Stage 2):**
  - Hooks: round-trip `~/.claude/settings.json` (global) and project `.claude/settings.json`; list with enable/disable toggle.
  - MCP: reuse `useMcpStore`, compact health view + restart button.
  - Webhooks: list via `/schedule list --webhooks` (verify CLI surface); fallback deep-link.
  - Secrets: key list with source badges; `+` to add (writes to keychain).

### 4.4 Testing

- **Rust unit**: cron-next-fire math, store serialization round-trip, driver trait against a fake driver, scheduler event emission.
- **Rust integration**: fake driver that sleeps then emits events; verify lifecycle and concurrency cap.
- **Frontend**: vitest + @testing-library/react. Expanded JobRow snapshot, store reducer under event stream, wizard happy-path + cron validation + ≥1h guard.
- **No real `claude -p` in CI** — shim binary on PATH for test runs.
- **Manual smoke checklist**: `echo hi` on `* * * * *` fires and stops cleanly; Claude-trigger create round-trips; secrets resolve via keychain; project switch swaps scope filter correctly.

## 5. Deliverable plan

Single PR, staged commits reviewable in order.

### Stage 1 — MVP (mergeable as a standalone feature)

1. Rust `core/ops/model.rs` + `store.rs` + keychain scaffolding
2. Driver trait, `drivers/maestro.rs`, scheduler loop, dispatch log, Tauri commands
3. `drivers/claude_trigger.rs` proxy + background trigger poller
4. `useOpsStore`, `types/ops.ts`, event wiring
5. Ops tab registration in `GitPanelTabs` + `GitPanelContent`
6. `OpsPanel` stacked sections: Live, Jobs, Tools, History (Surfaces is a placeholder card in Stage 1)
7. `JobRow` inline expansion + `JobDetailPanel` slide-over
8. `NewJobWizard` for both drivers (Maestro + Claude-trigger)
9. `DispatchViewer`
10. Tests + smoke pass

### Stage 2 — Claude Surfaces + polish (same PR, after Stage 1 commits)

11. `SurfacesSection` with Hooks editor (read + round-trip)
12. MCP compact view reusing `useMcpStore` + restart action
13. Webhooks list / fallback deep-link
14. Secrets manager (list + add via keychain)
15. Cost/usage wiring into Tamagotchi for claude-trigger jobs
16. Notification policies (failure threshold → `PushNotification`)
17. Import/export jobs as YAML
18. Docs pass on website

## 6. Open questions / risks

- **`/schedule list --webhooks`** — verify the skill/CLI supports listing webhooks. If not, the Webhooks sub-surface in Stage 2 falls back to a deep link only.
- **`claude -p` output stability** — `/schedule` output is conversational. Parsing needs regex + tolerance for model variance. Mitigate with structured output mode (`--output-format=json`) and explicit prompt templates we control.
- **Cross-platform `tauri-plugin-stronghold`** — verify it's supported on all three OSes; otherwise fall back to a file-encrypted-at-rest scheme using a per-install key derived from OS keychain.
- **Project-hashing** — use the existing workspace-store hashing if present; otherwise SHA-256 of canonical repo path.

## 7. Out of scope (deferred beyond Stage 2)

- Run-on-event triggers (file watch, GitHub webhook inbound)
- Team-shared jobs via sync backend
- Cross-machine job migration
- Replacing Claude Code as the source of truth for Hooks/MCP
