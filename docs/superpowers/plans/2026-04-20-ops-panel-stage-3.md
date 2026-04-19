# Ops Panel — Stage 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Surface Claude Code's native scheduling primitives (`/loop` and `/schedule`) as first-class options inside the Ops panel. Restructure the right panel so Git and Ops become two top-level domains (matching the left sidebar's Config/Processes pattern) instead of Ops being a tab among Git's sub-tabs.

**Architecture:** Additive to Stage 1 (Maestro driver + tokio scheduler) and Stage 2 (Claude Surfaces + polish). Introduces a third `loop` driver that spawns Claude sessions in worktrees and injects `/loop` slash commands via the existing `write_stdin` terminal command, plus an `interactive` mode for the Claude-trigger driver that creates `/schedule` triggers in a visible Claude session. Keeps everything already shipped.

**Tech Stack:** Same as Stage 1+2. No new crates required. Leverages existing `SessionManager` / `process_manager` / `TranscriptWatcher` / `commands::terminal::write_stdin` from Maestro core.

**Branch:** `feat/ops-panel` — continues from Stage 2 completion marker `93f63828` plus fixes (`bc3ec750`, `608aefb5`).

**Spec:** `docs/superpowers/specs/2026-04-18-ops-panel-design.md` (with augmentations documented here; no separate spec file — this plan is the source of truth for Stage 3 additions).

**Stage 1 plan:** `docs/superpowers/plans/2026-04-18-ops-panel-stage-1.md` — read for code conventions, store layout, driver trait patterns.

**Stage 2 plan:** `docs/superpowers/plans/2026-04-18-ops-panel-stage-2.md` — read for the Surfaces/Secrets/YAML patterns.

---

## Scope decisions (locked)

- **Worktree for loop sessions:** default to dedicated `~/.claude-maestro/worktrees/ops-loops/<loopId>/`. User can override with `{ mode: "existing", path }` and an optional `branch`.
- **Live trigger list:** sub-list inside the existing Jobs section (not a separate top-level section).
- **Autostart:** explicit per-loop `autostart: boolean`. Enabled loops with `autostart=true` respawn on app launch after `SessionManager` is ready.
- **Session topology:** one dedicated Claude session per active loop.
- **Claude-trigger modes:** keep `headless` (existing `claude -p` proxy) as the default; add `interactive` that opens a visible Claude session and types `/schedule create`.
- **UI restructure:** right panel gets a two-item top-level domain switcher (`Git` | `Ops`) matching the Sidebar.tsx `Config/Processes` pattern (bottom-border-on-active, uppercase labels, icon + text). Existing Git sub-tabs (Commits/PRs/Issues/Discussions) become sub-nav under Git. Ops sections move under Ops.

---

## File structure (additions to Stage 1+2)

### New Rust files

```
src-tauri/src/core/ops/drivers/loop_driver.rs   # LoopDriver impl
src-tauri/src/core/ops/session_injector.rs      # helper: spawn session, wait-ready, write_stdin
```

### Modified Rust files

- `src-tauri/src/core/ops/model.rs` — add `JobDriver::Loop`, `LoopPayload`, `WorktreeSpec`, `loop` field on `Job`, `schedule_mode` field on `ClaudeTriggerPayload`
- `src-tauri/src/core/ops/drivers/mod.rs` — register `pub mod loop_driver;`
- `src-tauri/src/commands/ops.rs` — wire `LoopDriver` into `OpsState::new`; autostart hook after scheduler spawn; `interactive` mode branch in `ops_save_job`; refresh live triggers command
- `src-tauri/src/lib.rs` — register new commands; ensure `SessionManager` is available to `OpsState`

### New TypeScript files

```
src/components/right-panel/RightPanelHeader.tsx   # the Git | Ops domain switcher
src/components/right-panel/RightPanel.tsx         # new shell that routes between Git and Ops
src/components/ops/wizard/LoopForm.tsx            # Loop driver form card + fields
src/components/ops/LiveTriggersList.tsx           # live /schedule list sub-view
```

### Modified TypeScript files

- `src/types/ops.ts` — add `LoopPayload`, `WorktreeSpec`, `ScheduleMode`, extend `Job`
- `src/lib/ops.ts` — wrappers for `loop` driver commands, live triggers refresh
- `src/stores/useOpsStore.ts` — loops-by-scope slice (reuses jobsByScope), externalTriggers slice
- `src/components/ops/NewJobWizard.tsx` — third driver card `Loop`
- `src/components/ops/JobRow.tsx` — loop-specific badge, Stop/Restart actions
- `src/components/ops/sections/JobsSection.tsx` — embed `LiveTriggersList` as a collapsible sub-group
- `src/App.tsx` — render `<RightPanel>` instead of `<GitGraphPanel>`

### Deleted / relocated

- `src/components/git/GitGraphPanel.tsx` — **kept** (still used as the Git domain's body) but `App.tsx` no longer imports it directly; `RightPanel` mounts it when domain === "git". No rename needed.

---

## Phase K — Right panel UI restructure

### Task 52: RightPanelHeader (Git | Ops domain switcher)

**Files:**
- Create: `src/components/right-panel/RightPanelHeader.tsx`

- [ ] **Step 52.1: Component**

Create `src/components/right-panel/RightPanelHeader.tsx`:

```tsx
import { GitBranch, Cpu } from "lucide-react";

export type RightPanelDomain = "git" | "ops";

interface Props {
  active: RightPanelDomain;
  onChange: (d: RightPanelDomain) => void;
}

const ITEMS: Array<{ id: RightPanelDomain; label: string; icon: typeof GitBranch }> = [
  { id: "git", label: "Git", icon: GitBranch },
  { id: "ops", label: "Ops", icon: Cpu },
];

export function RightPanelHeader({ active, onChange }: Props) {
  return (
    <div className="flex shrink-0 border-b border-maestro-border">
      {ITEMS.map((i) => {
        const Icon = i.icon;
        const isActive = active === i.id;
        return (
          <button
            key={i.id}
            type="button"
            onClick={() => onChange(i.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide ${
              isActive
                ? "border-b-2 border-maestro-accent text-maestro-accent"
                : "text-maestro-muted hover:text-maestro-text"
            }`}
          >
            <Icon size={12} />
            {i.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 52.2: Verify it renders in isolation**

No test needed for this tiny component (the interaction test lives on `RightPanel` — Task 53).

- [ ] **Step 52.3: Commit**

```bash
git add src/components/right-panel/RightPanelHeader.tsx
git commit -m "feat(ops): add Git|Ops right-panel domain switcher header"
```

---

### Task 53: RightPanel shell routes Git vs Ops

**Files:**
- Create: `src/components/right-panel/RightPanel.tsx`
- Modify: `src/App.tsx` — swap `<GitGraphPanel>` for `<RightPanel>`

- [ ] **Step 53.1: RightPanel component**

Create `src/components/right-panel/RightPanel.tsx`:

```tsx
import { useState } from "react";
import type { RightPanelDomain } from "./RightPanelHeader";
import { RightPanelHeader } from "./RightPanelHeader";
import { GitGraphPanel } from "../git/GitGraphPanel";
import { OpsPanel } from "../ops/OpsPanel";
import type { RepositoryInfo, WorkspaceType } from "@/stores/useWorkspaceStore";

interface Props {
  open: boolean;
  onClose: () => void;
  repoPath: string | null;
  currentBranch: string | null;
  repositories: RepositoryInfo[];
  workspaceType: WorkspaceType;
  onRepoChange: (repoPath: string) => void;
}

export function RightPanel(props: Props) {
  const [domain, setDomain] = useState<RightPanelDomain>("git");

  return (
    <aside
      aria-hidden={!props.open}
      tabIndex={props.open ? undefined : -1}
      {...(!props.open ? ({ inert: "" } as { inert: "" }) : {})}
      className={`relative z-30 flex flex-col border-l border-maestro-border bg-maestro-surface transition-all duration-200 overflow-hidden ${
        props.open ? "w-[560px]" : "w-0 border-l-0"
      }`}
    >
      {props.open && <RightPanelHeader active={domain} onChange={setDomain} />}
      <div className="flex min-h-0 flex-1">
        {domain === "git" ? (
          <GitGraphPanel {...props} embedded />
        ) : (
          props.repoPath ? (
            <OpsPanel repoPath={props.repoPath} />
          ) : (
            <div className="flex flex-1 items-center justify-center px-4 text-center">
              <p className="text-xs text-maestro-muted/60">Open a project to see Ops jobs.</p>
            </div>
          )
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 53.2: Add `embedded` prop to `GitGraphPanel`**

Edit `src/components/git/GitGraphPanel.tsx`. Add `embedded?: boolean` to its `GitGraphPanelProps` interface. When `embedded === true`, skip rendering the outer `<aside>` wrapper (RightPanel already provides it) — return just the inner content (the tabs/content + repo rail) wrapped in a `<div className="flex flex-1 overflow-hidden">`.

Concretely, find:

```tsx
return (
  <aside
    aria-hidden={!open}
    ...
    className={`relative z-30 flex flex-row border-l border-maestro-border bg-maestro-surface transition-all duration-200 overflow-hidden ${
      open ? "w-[560px]" : "w-0 border-l-0"
    }`}
  >
    {/* PR Detail panel - full width when shown */}
```

Replace with:

```tsx
const content = (
  <>
    {/* PR Detail panel - full width when shown */}
```

...and close the conditional before the closing `</aside>`. Wrap:

```tsx
return embedded ? (
  <div className="flex flex-1 overflow-hidden">{content}</div>
) : (
  <aside
    aria-hidden={!open}
    tabIndex={open ? undefined : -1}
    {...(!open ? ({ inert: "" } as { inert: "" }) : {})}
    className={`relative z-30 flex flex-row border-l border-maestro-border bg-maestro-surface transition-all duration-200 overflow-hidden ${
      open ? "w-[560px]" : "w-0 border-l-0"
    }`}
  >
    {content}
  </aside>
);
```

- [ ] **Step 53.3: Remove Ops tab from GitPanelTabs**

Edit `src/components/git/GitPanelTabs.tsx`:

- Remove `"ops"` from the `GitPanelTab` union.
- Remove `Cpu` from the lucide import (no longer needed here).
- Remove the `{ id: "ops", label: "Ops", icon: Cpu }` entry from `TABS`.

Edit `src/components/git/GitPanelContent.tsx`:

- Remove the `import { OpsPanel }` line.
- Remove the `case "ops": return <OpsPanel ... />` branch from the switch.

- [ ] **Step 53.4: Swap App.tsx**

Edit `src/App.tsx`. Replace `<GitGraphPanel .../>` usage with `<RightPanel .../>`, passing the same props. Remove the `GitGraphPanel` import.

- [ ] **Step 53.5: Verify build + commit**

Run: `npm run build`
Expected: clean tsc + Vite.

Commit:

```bash
git add src/components/right-panel/RightPanel.tsx src/components/git/GitGraphPanel.tsx \
        src/components/git/GitPanelTabs.tsx src/components/git/GitPanelContent.tsx \
        src/App.tsx
git commit -m "feat(ops): restructure right panel into Git|Ops top-level domains"
```

---

## Phase L — Loop driver + autostart

### Task 54: Model additions — `loop` driver, worktree spec, schedule mode

**Files:**
- Modify: `src-tauri/src/core/ops/model.rs`
- Modify: `src/types/ops.ts`

- [ ] **Step 54.1: Rust types**

Edit `src-tauri/src/core/ops/model.rs`:

After the existing `JobDriver` enum, extend:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobDriver {
    Maestro,
    ClaudeTrigger,
    Loop,
}
```

After `ClaudeTriggerPayload`, add the schedule mode enum + update payload:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ScheduleMode {
    #[default]
    Headless,
    Interactive,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeTriggerPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trigger_id: Option<String>,
    pub prompt: String,
    #[serde(default)]
    pub mcp_connectors: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_repo: Option<String>,
    #[serde(default)]
    pub mode: ScheduleMode,
}
```

(Replace the existing `ClaudeTriggerPayload` definition entirely — the field order/additions are what changes.)

Add the new worktree spec + loop payload:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum WorktreeSpec {
    /// Maestro creates and owns a scratch worktree at ~/.claude-maestro/worktrees/ops-loops/<loopId>/
    Dedicated,
    /// Reuse an existing path on disk; optional branch checkout.
    Existing {
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        branch: Option<String>,
    },
}

impl Default for WorktreeSpec {
    fn default() -> Self { WorktreeSpec::Dedicated }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LoopPayload {
    pub prompt: String,
    /// /loop interval format — e.g. "5m", "1h", "30s". Passed verbatim to /loop.
    pub interval: String,
    #[serde(default)]
    pub autostart: bool,
    #[serde(default)]
    pub worktree: WorktreeSpec,
    /// Session ID we spawned for this loop (populated after create).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<u32>,
}
```

Add `loop` field to `Job`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    // ... existing fields ...
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "loop")]
    pub loop_: Option<LoopPayload>,
}
```

Find the current `Job` struct and add `pub loop_: Option<LoopPayload>` as a new optional field. Keep everything else exactly as-is.

Note: Rust reserves `loop` as a keyword, hence `loop_` with `#[serde(rename = "loop")]` to match TypeScript's `loop`.

- [ ] **Step 54.2: TS types**

Edit `src/types/ops.ts`:

Update `JobDriver`:

```ts
export type JobDriver = "maestro" | "claude-trigger" | "loop";
```

Add new types:

```ts
export type ScheduleMode = "headless" | "interactive";

export interface ClaudeTriggerPayload {
  triggerId?: string;
  prompt: string;
  mcpConnectors: string[];
  defaultRepo?: string;
  mode: ScheduleMode;
}

export type WorktreeSpec =
  | { mode: "dedicated" }
  | { mode: "existing"; path: string; branch?: string };

export interface LoopPayload {
  prompt: string;
  interval: string;
  autostart: boolean;
  worktree: WorktreeSpec;
  sessionId?: number;
}
```

Extend `Job`:

```ts
export interface Job {
  // ... existing fields ...
  loop?: LoopPayload;
}
```

Replace the existing `ClaudeTriggerPayload` definition with the new one that includes `mode`.

- [ ] **Step 54.3: Keep existing model tests passing**

The `job_round_trips_through_serde_json` test in `model.rs` should still pass (the new fields are all optional with `#[serde(default, skip_serializing_if = "Option::is_none")]`). Run:

```bash
cd src-tauri && cargo test --lib core::ops::model
```

Expected: 3 passed.

- [ ] **Step 54.4: Commit**

```bash
git add src-tauri/src/core/ops/model.rs src/types/ops.ts
git commit -m "feat(ops): add Loop driver, WorktreeSpec, ScheduleMode to domain model"
```

---

### Task 55: SessionInjector helper

**Files:**
- Create: `src-tauri/src/core/ops/session_injector.rs`
- Modify: `src-tauri/src/core/ops/mod.rs` — register

Purpose: one place that knows how to spawn a Claude session for a loop, wait for it to be ready to accept input (Claude prompt prefix appeared in the transcript), and inject a slash command via `write_stdin`.

- [ ] **Step 55.1: Create the helper**

Create `src-tauri/src/core/ops/session_injector.rs`:

```rust
//! Spawn a Claude session for a loop/schedule job, wait for it to be ready,
//! then inject a slash command via the existing terminal pipe.

use crate::core::ops::model::WorktreeSpec;
use crate::core::process_manager::ProcessManager;
use crate::core::session_manager::SessionManager;
use crate::core::worktree_manager::WorktreeManager;
use anyhow::{anyhow, Result};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

pub struct SessionInjector {
    pub sessions: Arc<SessionManager>,
    pub processes: Arc<ProcessManager>,
    pub worktrees: Arc<WorktreeManager>,
}

impl SessionInjector {
    /// Resolve the on-disk path for a worktree spec, creating a dedicated
    /// worktree under ~/.claude-maestro/worktrees/ops-loops/<loopId>/ if needed.
    pub async fn resolve_worktree(&self, loop_id: &str, spec: &WorktreeSpec) -> Result<PathBuf> {
        match spec {
            WorktreeSpec::Dedicated => {
                let base = directories::BaseDirs::new()
                    .ok_or_else(|| anyhow!("home dir unavailable"))?;
                let dir = base.home_dir()
                    .join(".claude-maestro")
                    .join("worktrees")
                    .join("ops-loops")
                    .join(loop_id);
                std::fs::create_dir_all(&dir)?;
                Ok(dir)
            }
            WorktreeSpec::Existing { path, branch: _ } => {
                let p = PathBuf::from(path);
                if !p.exists() {
                    return Err(anyhow!("worktree path does not exist: {path}"));
                }
                Ok(p)
            }
        }
    }

    /// Spawn a new Claude session in the target directory, wait up to
    /// `ready_timeout` for the session to be ready to accept stdin
    /// (heuristic: first transcript event arrived), return the session id.
    pub async fn spawn_and_wait_ready(
        &self,
        cwd: &std::path::Path,
        ready_timeout: Duration,
    ) -> Result<u32> {
        // Delegate to SessionManager's "spawn claude session" API; signature may
        // vary across the codebase. Prefer the existing helper (if present)
        // that launches a Claude session and returns the session id.
        let session_id = self.sessions.spawn_claude_session(cwd.to_string_lossy().as_ref()).await
            .map_err(|e| anyhow!("spawn session: {e}"))?;

        // Best-effort readiness check: poll session metadata until status is
        // not "Starting" or the timeout elapses. Good enough as a first cut;
        // a more robust check would tail the transcript for Claude's prompt.
        let start = std::time::Instant::now();
        while start.elapsed() < ready_timeout {
            if self.sessions.is_ready(session_id).await { break; }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        Ok(session_id)
    }

    /// Write a line (+ newline) to the given session's PTY.
    pub async fn inject_line(&self, session_id: u32, line: &str) -> Result<()> {
        let data = format!("{line}\n");
        self.processes.write_stdin(session_id, data.as_bytes()).await
            .map_err(|e| anyhow!("write_stdin: {e}"))?;
        Ok(())
    }

    /// Kill the session started for a loop.
    pub async fn kill_session(&self, session_id: u32) -> Result<()> {
        self.processes.kill_session(session_id).await
            .map_err(|e| anyhow!("kill_session: {e}"))?;
        Ok(())
    }
}
```

**Note on method signatures:** `SessionManager::spawn_claude_session`, `SessionManager::is_ready`, `ProcessManager::write_stdin`, `ProcessManager::kill_session` must already exist in the Maestro core. Before compiling, **read `src-tauri/src/core/session_manager.rs` and `src-tauri/src/core/process_manager.rs`** to find the actual method names and adjust the three calls above to match. If `spawn_claude_session` is named differently (e.g. `spawn_session` with a `SessionMode::Claude` arg), use that. If `is_ready` doesn't exist, fall back to `tokio::time::sleep(Duration::from_secs(2))` as a crude fixed wait (document this as a gap to address later).

- [ ] **Step 55.2: Register module**

Edit `src-tauri/src/core/ops/mod.rs`, add:

```rust
pub mod session_injector;
```

- [ ] **Step 55.3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: clean. Fix signature mismatches by reading the actual `SessionManager`/`ProcessManager` APIs.

- [ ] **Step 55.4: Commit**

```bash
git add src-tauri/src/core/ops/session_injector.rs src-tauri/src/core/ops/mod.rs
git commit -m "feat(ops): SessionInjector helper — spawn Claude, wait ready, inject slash command"
```

---

### Task 56: LoopDriver

**Files:**
- Create: `src-tauri/src/core/ops/drivers/loop_driver.rs`
- Modify: `src-tauri/src/core/ops/drivers/mod.rs`

- [ ] **Step 56.1: Driver impl**

Create `src-tauri/src/core/ops/drivers/loop_driver.rs`:

```rust
//! Loop driver: manages a long-running Claude session that has a /loop
//! slash command running inside it.
//!
//! create = spawn session in worktree → /loop <interval> <prompt>
//! delete = kill session
//! run_now = no-op (the loop is continuous); emit a Finished event
//!           so the UI can show confirmation
//! list_external = empty (loops are tracked locally)

use super::{DispatchContext, DispatchEvent, DispatchTx, Driver, DriverCapabilities, DriverMeta, ExternalJob};
use crate::core::ops::model::{DispatchStatus, Job};
use crate::core::ops::session_injector::SessionInjector;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use std::sync::Arc;
use std::time::Duration;

pub struct LoopDriver {
    pub injector: Arc<SessionInjector>,
}

impl LoopDriver {
    pub fn new(injector: Arc<SessionInjector>) -> Self { Self { injector } }
}

#[async_trait]
impl Driver for LoopDriver {
    async fn create(&self, job: &Job) -> Result<DriverMeta> {
        let payload = job.loop_.as_ref()
            .ok_or_else(|| anyhow!("loop driver: job.loop is None"))?;
        let cwd = self.injector.resolve_worktree(&job.id, &payload.worktree).await?;
        let session_id = self.injector.spawn_and_wait_ready(&cwd, Duration::from_secs(10)).await?;
        let command = format!("/loop {} {}", payload.interval, payload.prompt);
        self.injector.inject_line(session_id, &command).await?;
        // Return the session_id via DriverMeta; caller stores it in loop.session_id.
        Ok(DriverMeta { trigger_id: Some(session_id.to_string()) })
    }

    async fn update(&self, job: &Job) -> Result<()> {
        // Simplest update = tear down + respawn.
        self.delete(job).await.ok();
        self.create(job).await?;
        Ok(())
    }

    async fn delete(&self, job: &Job) -> Result<()> {
        if let Some(p) = job.loop_.as_ref() {
            if let Some(sid) = p.session_id {
                self.injector.kill_session(sid).await.ok();
            }
        }
        Ok(())
    }

    async fn run_now(&self, _job: &Job, ctx: DispatchContext, tx: DispatchTx) -> Result<()> {
        // Loops are continuous — "run now" means "ensure it's running".
        let _ = tx.send(DispatchEvent::Output {
            dispatch_id: ctx.dispatch_id.clone(),
            chunk: "loop is managed via /loop inside its Claude session\n".into(),
            is_stderr: false,
        });
        let _ = tx.send(DispatchEvent::Finished {
            dispatch_id: ctx.dispatch_id,
            status: DispatchStatus::Succeeded,
            exit_code: None,
            tokens: None,
        });
        Ok(())
    }

    async fn list_external(&self) -> Result<Vec<ExternalJob>> { Ok(Vec::new()) }

    fn capabilities(&self) -> DriverCapabilities {
        DriverCapabilities {
            supports_delete: true,
            supports_raw_env: false,
            supports_local_logs: true,    // the Claude session's transcript IS the log
            supports_mcp_connectors: false,
            min_interval_seconds: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    // Proper LoopDriver tests need a fake SessionInjector. Defer to integration
    // test in Task 60 — unit testing a driver that only delegates is low value.
}
```

- [ ] **Step 56.2: Register**

Edit `src-tauri/src/core/ops/drivers/mod.rs`, add near the other `pub mod`:

```rust
pub mod loop_driver;
```

- [ ] **Step 56.3: Verify build + commit**

Run: `cd src-tauri && cargo check`
Expected: clean.

Commit:

```bash
git add src-tauri/src/core/ops/drivers/loop_driver.rs src-tauri/src/core/ops/drivers/mod.rs
git commit -m "feat(ops): LoopDriver — creates and manages /loop inside a Claude session"
```

---

### Task 57: Wire LoopDriver into OpsState + autostart

**Files:**
- Modify: `src-tauri/src/commands/ops.rs`
- Modify: `src-tauri/src/lib.rs` (access `SessionManager`/`ProcessManager`/`WorktreeManager`)

- [ ] **Step 57.1: Extend OpsState**

Edit `src-tauri/src/commands/ops.rs`.

Add import at top:

```rust
use crate::core::ops::drivers::loop_driver::LoopDriver;
use crate::core::ops::session_injector::SessionInjector;
use crate::core::session_manager::SessionManager;
use crate::core::process_manager::ProcessManager;
use crate::core::worktree_manager::WorktreeManager;
```

Add a `loop_driver: Arc<LoopDriver>` field to `OpsState`. Change `OpsState::new` signature to accept the three Maestro managers:

```rust
impl OpsState {
    pub fn new(
        app: AppHandle,
        sessions: Arc<SessionManager>,
        processes: Arc<ProcessManager>,
        worktrees: Arc<WorktreeManager>,
    ) -> Arc<Self> {
        // ... existing scheduler setup stays the same ...

        let injector = Arc::new(SessionInjector { sessions, processes, worktrees });
        let loop_driver = Arc::new(LoopDriver::new(injector.clone()));

        let state = Arc::new(Self {
            maestro_scheduler: scheduler,
            claude_driver,
            loop_driver,
            jobs_by_scope: Mutex::new(HashMap::new()),
            dispatches: Mutex::new(HashMap::new()),
            app: app.clone(),
        });

        // ... event forwarder (unchanged) ...

        state
    }
}
```

- [ ] **Step 57.2: Update `ops_save_job` to route Loop jobs**

In `ops_save_job`, extend the driver match:

```rust
match job.driver {
    JobDriver::Maestro => {}
    JobDriver::ClaudeTrigger => {
        // ... existing claude-trigger creation ...
    }
    JobDriver::Loop => {
        match state.loop_driver.create(&job).await {
            Ok(meta) => {
                if let Some(lp) = job.loop_.as_mut() {
                    if let Some(sid_str) = meta.trigger_id {
                        lp.session_id = sid_str.parse::<u32>().ok();
                    }
                }
            }
            Err(e) => return Err(format!("create loop: {e}")),
        }
    }
}
```

- [ ] **Step 57.3: Update `ops_delete_job` for Loop jobs**

In `ops_delete_job`, before removing from store, if the job is `JobDriver::Loop`, call `state.loop_driver.delete(&job).await.ok();` to kill the session.

- [ ] **Step 57.4: Autostart hook**

Add a helper and call it at the end of `OpsState::new`:

```rust
impl OpsState {
    pub async fn autostart_loops(self: &Arc<Self>) {
        // Walk all loaded jobs across both scopes and respawn enabled autostart loops.
        let mut all_jobs: Vec<(Scope, Option<String>, Job)> = Vec::new();
        if let Ok(global) = store::load_jobs(Scope::Global, None) {
            for j in global { all_jobs.push((Scope::Global, None, j)); }
        }
        // Project-scoped loops are respawned the first time the user opens that project;
        // we don't have a project list at boot, so skip for autostart.
        for (_scope, _ph, mut job) in all_jobs {
            if job.driver != JobDriver::Loop { continue; }
            if !job.enabled { continue; }
            let Some(lp) = job.loop_.as_ref() else { continue; };
            if !lp.autostart { continue; }
            log::info!("[ops] autostarting loop job {}", job.id);
            match self.loop_driver.create(&job).await {
                Ok(meta) => {
                    if let Some(lp) = job.loop_.as_mut() {
                        if let Some(sid_str) = meta.trigger_id {
                            lp.session_id = sid_str.parse::<u32>().ok();
                        }
                    }
                    // Persist updated session_id
                    let mut list = store::load_jobs(Scope::Global, None).unwrap_or_default();
                    list.retain(|j| j.id != job.id);
                    list.push(job);
                    let _ = store::save_jobs(Scope::Global, None, &list);
                }
                Err(e) => log::error!("[ops] autostart loop {} failed: {}", job.id, e),
            }
        }
    }
}
```

Call it from the event-forwarder spawn block (or a separate spawn) to avoid blocking setup:

```rust
let state_auto = state.clone();
tauri::async_runtime::spawn(async move {
    // small delay to let SessionManager warm up
    tokio::time::sleep(Duration::from_secs(3)).await;
    state_auto.autostart_loops().await;
});
```

Add `use std::time::Duration;` if not already imported.

- [ ] **Step 57.5: Update lib.rs to pass managers to `OpsState::new`**

Edit `src-tauri/src/lib.rs`. In the `.setup()` closure, find the existing line:

```rust
let ops = crate::commands::ops::OpsState::new(handle.clone());
```

Replace with:

```rust
let sessions = app.state::<Arc<SessionManager>>().inner().clone();
let processes = app.state::<Arc<ProcessManager>>().inner().clone();
let worktrees = app.state::<Arc<WorktreeManager>>().inner().clone();
let ops = crate::commands::ops::OpsState::new(handle.clone(), sessions, processes, worktrees);
```

If any of these three managers are not yet registered via `app.manage(Arc::new(...))` before this point in setup, add them. Read the existing setup block to find where `SessionManager`/`ProcessManager`/`WorktreeManager` are actually initialized (they almost certainly are — existing commands depend on them).

- [ ] **Step 57.6: Verify build + commit**

Run: `cd src-tauri && cargo check`
Expected: clean.

Commit:

```bash
git add src-tauri/src/commands/ops.rs src-tauri/src/lib.rs
git commit -m "feat(ops): wire LoopDriver into OpsState with autostart hook"
```

---

### Task 58: Wizard Loop card

**Files:**
- Create: `src/components/ops/wizard/LoopForm.tsx`
- Modify: `src/components/ops/NewJobWizard.tsx`
- Modify: `src/lib/ops.ts` (no new wrappers needed — `saveJob` handles all drivers, but add a sanity re-export of types)

- [ ] **Step 58.1: LoopForm**

Create `src/components/ops/wizard/LoopForm.tsx`:

```tsx
import { useState } from "react";
import type { Job, WorktreeSpec } from "@/types/ops";

interface Props {
  onCancel: () => void;
  onSubmit: (partial: Partial<Job>) => Promise<void>;
}

const INTERVAL_PATTERN = /^\d+\s*(s|m|h)$/i;

function validateInterval(raw: string): string | null {
  if (!raw.trim()) return "Interval is required";
  if (!INTERVAL_PATTERN.test(raw.trim())) return "Format: <N><unit> (e.g. 5m, 1h, 30s)";
  return null;
}

export function LoopForm({ onCancel, onSubmit }: Props) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [interval, setInterval] = useState("5m");
  const [autostart, setAutostart] = useState(true);
  const [worktreeMode, setWorktreeMode] = useState<"dedicated" | "existing">("dedicated");
  const [worktreePath, setWorktreePath] = useState("");
  const [worktreeBranch, setWorktreeBranch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const intervalError = validateInterval(interval);

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError("Name is required");
    if (!prompt.trim()) return setError("Prompt is required");
    if (intervalError) return setError(intervalError);
    if (worktreeMode === "existing" && !worktreePath.trim()) {
      return setError("Path is required when worktree mode is 'existing'");
    }

    const worktree: WorktreeSpec =
      worktreeMode === "dedicated"
        ? { mode: "dedicated" }
        : { mode: "existing", path: worktreePath.trim(), branch: worktreeBranch.trim() || undefined };

    setSubmitting(true);
    await onSubmit({
      name: name.trim(),
      loop: {
        prompt: prompt.trim(),
        interval: interval.trim(),
        autostart,
        worktree,
      },
    });
    setSubmitting(false);
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-maestro-muted">
          Name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. hourly-pr-scan"
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11.5px] text-maestro-text"
        />
      </div>

      <div>
        <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-maestro-muted">
          Prompt (runs on every loop tick)
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. list new PRs since last run and write a summary to /tmp/pr-report.md"
          rows={4}
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11px] text-maestro-text"
        />
      </div>

      <div>
        <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-maestro-muted">
          Interval
        </label>
        <input
          value={interval}
          onChange={(e) => setInterval(e.target.value)}
          className="w-28 rounded border border-maestro-border bg-maestro-card px-2 py-1 font-mono text-[11px] text-maestro-text"
        />
        {intervalError && <p className="mt-1 text-[10.5px] text-maestro-red">{intervalError}</p>}
      </div>

      <div>
        <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-maestro-muted">
          Worktree
        </label>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setWorktreeMode("dedicated")}
            className={`rounded px-3 py-1 text-[11px] ${
              worktreeMode === "dedicated"
                ? "bg-maestro-accent/15 text-maestro-accent"
                : "text-maestro-muted hover:text-maestro-text"
            }`}
          >
            Dedicated (default)
          </button>
          <button
            type="button"
            onClick={() => setWorktreeMode("existing")}
            className={`rounded px-3 py-1 text-[11px] ${
              worktreeMode === "existing"
                ? "bg-maestro-accent/15 text-maestro-accent"
                : "text-maestro-muted hover:text-maestro-text"
            }`}
          >
            Existing path
          </button>
        </div>
        {worktreeMode === "existing" && (
          <div className="mt-2 space-y-1">
            <input
              value={worktreePath}
              onChange={(e) => setWorktreePath(e.target.value)}
              placeholder="/absolute/path/to/repo"
              className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 font-mono text-[11px] text-maestro-text"
            />
            <input
              value={worktreeBranch}
              onChange={(e) => setWorktreeBranch(e.target.value)}
              placeholder="Branch (optional)"
              className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 font-mono text-[11px] text-maestro-text"
            />
          </div>
        )}
      </div>

      <label className="flex cursor-default items-center gap-2 text-[11px] text-maestro-text">
        <input
          type="checkbox"
          checked={autostart}
          onChange={(e) => setAutostart(e.target.checked)}
        />
        Autostart on app launch
      </label>

      {error && <p className="text-[11px] text-maestro-red">{error}</p>}

      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onCancel} className="text-[11px] text-maestro-muted">
          ← Back
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !!intervalError}
          className="ml-auto rounded bg-maestro-accent/20 px-3 py-1.5 text-[11px] text-maestro-accent disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create loop"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 58.2: Add Loop card to NewJobWizard**

Edit `src/components/ops/NewJobWizard.tsx`.

Import the new form:

```ts
import { LoopForm } from "./wizard/LoopForm";
```

In `DriverPicker`, change the grid to three columns and add a third card:

```tsx
<div className="grid grid-cols-3 gap-2">
  <DriverCard
    selected={driver === "maestro"}
    onSelect={() => onDriver("maestro")}
    title="Maestro"
    desc="Runs a local command on schedule while Maestro is open."
  />
  <DriverCard
    selected={driver === "claude-trigger"}
    onSelect={() => onDriver("claude-trigger")}
    title="Claude Trigger"
    desc="Remote Claude agent via /schedule. Runs even when Maestro is closed."
  />
  <DriverCard
    selected={driver === "loop"}
    onSelect={() => onDriver("loop")}
    title="Loop"
    desc="/loop inside a Maestro-managed Claude session. Local, continuous."
  />
</div>
```

In the form-rendering branch of `NewJobWizard`, add the Loop route:

```tsx
{step === "driver" ? (
  <DriverPicker ... />
) : driver === "maestro" ? (
  <MaestroJobForm onCancel={() => setStep("driver")} onSubmit={submit} />
) : driver === "claude-trigger" ? (
  <ClaudeTriggerForm onCancel={() => setStep("driver")} onSubmit={submit} />
) : (
  <LoopForm onCancel={() => setStep("driver")} onSubmit={submit} />
)}
```

- [ ] **Step 58.3: Extend NewJobWizard submit to carry the `loop` field**

In `submit` inside `NewJobWizard.tsx`, the constructed `Job` object must include the new optional `loop` field:

```tsx
const job: Job = {
  id: "",
  name: partial.name ?? "untitled",
  // ... existing fields ...
  loop: partial.loop,
};
```

- [ ] **Step 58.4: Verify build + commit**

Run: `npm run build`
Expected: clean tsc.

Commit:

```bash
git add src/components/ops/wizard/LoopForm.tsx src/components/ops/NewJobWizard.tsx
git commit -m "feat(ops): Loop driver wizard form with worktree config + autostart toggle"
```

---

### Task 59: JobRow loop-specific actions

**Files:**
- Modify: `src/components/ops/JobRow.tsx`

- [ ] **Step 59.1: Loop badge + stop/restart**

In `JobRow.tsx`, update the `driverBadge` helper to handle `loop`:

```tsx
function driverBadge(j: Job) {
  if (j.driver === "claude-trigger") {
    return <span className="rounded bg-[#2b1a35] px-1 py-[1px] text-[9.5px] uppercase tracking-wider text-[#c587e8]">Claude</span>;
  }
  if (j.driver === "loop") {
    return <span className="rounded bg-[#1a2e22] px-1 py-[1px] text-[9.5px] uppercase tracking-wider text-[#7ec988]">Loop</span>;
  }
  return <span className="rounded bg-[#1a2b3a] px-1 py-[1px] text-[9.5px] uppercase tracking-wider text-maestro-accent">Job</span>;
}
```

Update `nextFireLabel` to show loop interval:

```tsx
function nextFireLabel(j: Job): string {
  if (!j.enabled) return "paused";
  if (j.driver === "loop" && j.loop) return `every ${j.loop.interval}`;
  if (!j.schedule) return "manual";
  return `cron: ${j.schedule}`;
}
```

In the expanded-details `<dl>` block, add a loop branch alongside maestro / claude-trigger:

```tsx
{job.driver === "loop" && job.loop && (
  <>
    <dt className="text-maestro-muted/70 uppercase text-[9.5px]">Prompt</dt>
    <dd className="whitespace-pre-wrap text-[10.5px] text-[#7ec988]">{job.loop.prompt}</dd>
    <dt className="text-maestro-muted/70 uppercase text-[9.5px]">Interval</dt>
    <dd className="font-mono">{job.loop.interval}</dd>
    <dt className="text-maestro-muted/70 uppercase text-[9.5px]">Worktree</dt>
    <dd>{job.loop.worktree.mode === "dedicated" ? "dedicated (auto)" : job.loop.worktree.path}</dd>
    <dt className="text-maestro-muted/70 uppercase text-[9.5px]">Session</dt>
    <dd className="font-mono">{job.loop.sessionId ?? "not running"}</dd>
    <dt className="text-maestro-muted/70 uppercase text-[9.5px]">Autostart</dt>
    <dd>{job.loop.autostart ? "on" : "off"}</dd>
  </>
)}
```

- [ ] **Step 59.2: Replace the "Run now" button behavior for loops**

For loops, "Run now" doesn't make sense (the loop runs continuously). Change the header row's play button to conditionally render differently for loops:

```tsx
{job.driver === "loop" ? (
  <span className={`h-1.5 w-1.5 rounded-full ${job.loop?.sessionId ? "bg-maestro-green animate-pulse" : "bg-maestro-muted/40"}`} />
) : (
  <button type="button" onClick={onRun} aria-label="Run now" className="rounded p-0.5 text-maestro-accent hover:bg-maestro-accent/10">
    <Play size={11} />
  </button>
)}
```

This hides the play button for loops (the status dot and "session" field in expanded view convey state instead).

- [ ] **Step 59.3: Verify build + commit**

Run: `npm run build`
Expected: clean.

Commit:

```bash
git add src/components/ops/JobRow.tsx
git commit -m "feat(ops): JobRow loop-specific state display and hide Run-now for loops"
```

---

## Phase M — /schedule enhancements

### Task 60: Interactive /schedule mode

**Files:**
- Modify: `src-tauri/src/core/ops/drivers/claude_trigger.rs`
- Modify: `src-tauri/src/commands/ops.rs`
- Modify: `src/components/ops/wizard/ClaudeTriggerForm.tsx`

The existing `ClaudeTriggerDriver` shells `claude -p /schedule create …` headlessly. Add an alternate code path that, when `mode === "interactive"`, uses the same `SessionInjector` to open a visible Claude session and type `/schedule create …` into it.

- [ ] **Step 60.1: Add interactive branch to ClaudeTriggerDriver**

Modify `claude_trigger.rs`:

Change the struct to hold an optional `SessionInjector`:

```rust
pub struct ClaudeTriggerDriver {
    claude_bin: String,
    injector: Option<Arc<SessionInjector>>,
}
```

Update constructors:

```rust
impl ClaudeTriggerDriver {
    pub fn new() -> Self {
        Self { claude_bin: "claude".to_string(), injector: None }
    }
    pub fn with_injector(injector: Arc<SessionInjector>) -> Self {
        Self { claude_bin: "claude".to_string(), injector: Some(injector) }
    }
    // existing with_binary unchanged
}
```

In the `Driver::create` impl, branch on mode:

```rust
async fn create(&self, job: &Job) -> Result<DriverMeta> {
    let p = job.claude_trigger.as_ref()
        .ok_or_else(|| anyhow!("claude_trigger payload missing"))?;

    match p.mode {
        crate::core::ops::model::ScheduleMode::Headless => {
            self.create_headless(job, p).await
        }
        crate::core::ops::model::ScheduleMode::Interactive => {
            self.create_interactive(job, p).await
        }
    }
}
```

Split existing logic into `async fn create_headless(&self, job, p) -> Result<DriverMeta>` containing the current body. Add a new:

```rust
async fn create_interactive(&self, job: &Job, p: &crate::core::ops::model::ClaudeTriggerPayload) -> Result<DriverMeta> {
    let injector = self.injector.as_ref()
        .ok_or_else(|| anyhow!("interactive /schedule requires SessionInjector; not configured"))?;
    // Use a temp scratch worktree just like loops do.
    let cwd = injector.resolve_worktree(
        &format!("schedule-{}", &job.id[..8.min(job.id.len())]),
        &crate::core::ops::model::WorktreeSpec::Dedicated,
    ).await?;
    let session_id = injector.spawn_and_wait_ready(&cwd, std::time::Duration::from_secs(10)).await?;

    let connectors = if p.mcp_connectors.is_empty() {
        String::new()
    } else {
        format!(" Attach connectors: {}.", p.mcp_connectors.join(", "))
    };
    let schedule = job.schedule.as_deref().unwrap_or("");
    let command = format!(
        "/schedule create a trigger named \"{}\" on cron \"{}\" with prompt: {}.{}",
        job.name.replace('"', "'"),
        schedule,
        p.prompt,
        connectors
    );
    injector.inject_line(session_id, &command).await?;

    // The user will see the trigger-id in the session pane. We can't capture
    // it programmatically here, so return None — a later /schedule list poll
    // will merge it in.
    Ok(DriverMeta { trigger_id: None })
}
```

- [ ] **Step 60.2: Construct driver with injector in OpsState::new**

Edit `src-tauri/src/commands/ops.rs`. Replace the existing `let claude_driver = Arc::new(ClaudeTriggerDriver::new());` with:

```rust
let claude_driver = Arc::new(ClaudeTriggerDriver::with_injector(injector.clone()));
```

(The `injector` var is already created at this point for `LoopDriver`, per Task 57.)

- [ ] **Step 60.3: ClaudeTriggerForm — mode toggle**

Edit `src/components/ops/wizard/ClaudeTriggerForm.tsx`. Add a mode state and toggle:

```tsx
const [mode, setMode] = useState<ScheduleMode>("headless");
```

Import `ScheduleMode` from `@/types/ops`. Add a UI block above the submit button:

```tsx
<div>
  <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-maestro-muted">
    Creation mode
  </label>
  <div className="flex gap-1">
    <button
      type="button"
      onClick={() => setMode("headless")}
      className={`rounded px-3 py-1 text-[10.5px] ${
        mode === "headless"
          ? "bg-maestro-accent/15 text-maestro-accent"
          : "text-maestro-muted"
      }`}
    >
      Headless (default)
    </button>
    <button
      type="button"
      onClick={() => setMode("interactive")}
      className={`rounded px-3 py-1 text-[10.5px] ${
        mode === "interactive"
          ? "bg-maestro-accent/15 text-maestro-accent"
          : "text-maestro-muted"
      }`}
    >
      Interactive (visible session)
    </button>
  </div>
  <p className="mt-1 text-[10.5px] text-maestro-muted/60">
    Interactive opens a Claude session pane so you can confirm the trigger yourself.
  </p>
</div>
```

In `submit`, include mode in the payload:

```tsx
await onSubmit({
  name: name.trim(),
  schedule: schedule.trim(),
  claudeTrigger: {
    prompt: prompt.trim(),
    mcpConnectors: connectors,
    mode,
  },
});
```

- [ ] **Step 60.4: Verify build + commit**

Run: `cd src-tauri && cargo check && cd .. && npm run build`
Expected: clean.

Commit:

```bash
git add src-tauri/src/core/ops/drivers/claude_trigger.rs \
        src-tauri/src/commands/ops.rs \
        src/components/ops/wizard/ClaudeTriggerForm.tsx
git commit -m "feat(ops): /schedule interactive mode — inject into visible Claude session"
```

---

### Task 61: Live triggers sub-list inside JobsSection

**Files:**
- Modify: `src/stores/useOpsStore.ts`
- Create: `src/components/ops/LiveTriggersList.tsx`
- Modify: `src/components/ops/sections/JobsSection.tsx`

The existing `ops_list_external_triggers` command calls `/schedule list` via `claude -p`. Wire it into the frontend.

- [ ] **Step 61.1: Store slice**

Edit `src/stores/useOpsStore.ts`. Add to `OpsState` interface:

```ts
externalTriggers: ExternalJob[];
externalTriggersLoadedAt?: number;
loadExternalTriggers: () => Promise<void>;
```

Add to the create factory:

```ts
externalTriggers: [],
externalTriggersLoadedAt: undefined,

loadExternalTriggers: async () => {
  try {
    const triggers = await api.listExternalTriggers();
    set({ externalTriggers: triggers, externalTriggersLoadedAt: Date.now() });
  } catch (_e) {
    // tolerate — CLI might be missing or unauth; list stays empty
    set({ externalTriggersLoadedAt: Date.now() });
  }
},
```

Import `ExternalJob` from `@/types/ops` if not already present.

- [ ] **Step 61.2: LiveTriggersList component**

Create `src/components/ops/LiveTriggersList.tsx`:

```tsx
import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { useOpsStore } from "@/stores/useOpsStore";

function timeAgo(ms: number): string {
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function LiveTriggersList() {
  const triggers = useOpsStore((s) => s.externalTriggers);
  const loadedAt = useOpsStore((s) => s.externalTriggersLoadedAt);
  const load = useOpsStore((s) => s.loadExternalTriggers);
  const jobsByScope = useOpsStore((s) => s.jobsByScope);

  useEffect(() => {
    if (!loadedAt) load();
    const iv = globalThis.setInterval(() => load(), 5 * 60 * 1000);
    return () => globalThis.clearInterval(iv);
  }, [loadedAt, load]);

  // IDs of triggers we already manage locally — hide duplicates.
  const locallyKnown = new Set<string>();
  for (const list of Object.values(jobsByScope)) {
    for (const j of list) {
      if (j.driver === "claude-trigger" && j.claudeTrigger?.triggerId) {
        locallyKnown.add(j.claudeTrigger.triggerId);
      }
    }
  }
  const unmanaged = triggers.filter((t) => !locallyKnown.has(t.externalId));

  return (
    <div className="border-b border-maestro-border/20">
      <div className="flex items-center gap-2 px-3 py-1.5 text-[10.5px] uppercase tracking-wider text-maestro-muted">
        <span>Live /schedule triggers</span>
        <span className="text-maestro-muted/60">{triggers.length}</span>
        <button
          type="button"
          onClick={() => load()}
          aria-label="Refresh triggers"
          className="ml-auto rounded p-0.5 text-maestro-accent hover:bg-maestro-accent/10"
        >
          <RefreshCw size={11} />
        </button>
        {loadedAt && <span className="text-maestro-muted/50">{timeAgo(loadedAt)}</span>}
      </div>
      {triggers.length === 0 ? (
        <p className="px-4 pb-2 text-[10.5px] text-maestro-muted/60">No remote triggers.</p>
      ) : (
        <ul>
          {unmanaged.map((t) => (
            <li key={t.externalId} className="flex items-center gap-2 px-3 py-1 text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#c587e8]" />
              <span className="flex-1 truncate text-maestro-text">{t.name}</span>
              <span className="font-mono text-[10.5px] text-maestro-muted/70">
                {t.schedule ?? "—"}
              </span>
              <span className="text-[9.5px] uppercase tracking-wider text-maestro-muted/60">
                unmanaged
              </span>
            </li>
          ))}
          {locallyKnown.size > 0 && (
            <li className="px-3 py-1 text-[10.5px] text-maestro-muted/50">
              {locallyKnown.size} trigger{locallyKnown.size === 1 ? "" : "s"} shown above as managed jobs
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 61.3: Embed in JobsSection**

Edit `src/components/ops/sections/JobsSection.tsx`. Import:

```ts
import { LiveTriggersList } from "../LiveTriggersList";
```

Above the existing `<ul>{jobs.map(...)}</ul>`, add the sub-list:

```tsx
<LiveTriggersList />
{jobs.length === 0 ? (
  <div className="px-4 py-4 text-center text-[11px] text-maestro-muted/60">
    No jobs yet. Click + to create one.
  </div>
) : (
  <ul>{jobs.map((j) => <JobRow key={j.id} job={j} />)}</ul>
)}
```

- [ ] **Step 61.4: Verify build + commit**

Run: `npm run build`
Expected: clean.

Commit:

```bash
git add src/stores/useOpsStore.ts src/components/ops/LiveTriggersList.tsx \
        src/components/ops/sections/JobsSection.tsx
git commit -m "feat(ops): embed live /schedule triggers list inside Jobs section"
```

---

## Phase N — Finishing

### Task 62: Tests + smoke pass

- [ ] **Step 62.1: Rust**

```bash
cd src-tauri && cargo test
```

Expected: all existing tests pass (146 + 1 integration). No new backend tests added (LoopDriver delegates to SessionInjector which depends on managers that aren't mockable without refactoring — acceptable for Stage 3).

- [ ] **Step 62.2: Frontend**

```bash
npm test -- --run src/components/ops src/stores/__tests__/useOpsStore
```

Expected: existing 15 ops tests pass. Add a JobRow test for the loop badge if time permits (optional).

- [ ] **Step 62.3: Build**

```bash
npm run build
```

Expected: clean.

- [ ] **Step 62.4: Biome**

```bash
npx @biomejs/biome check --write src/components/ops src/components/right-panel \
    src/stores/useOpsStore.ts src/lib/ops.ts src/types/ops.ts
```

Commit any auto-fixes:

```bash
git add -u
git commit -m "style(ops): biome auto-format Stage 3 additions"
```

- [ ] **Step 62.5: Manual smoke**

Relaunch dev (`npm run tauri dev`) and verify:

- [ ] Right panel shows `Git` | `Ops` at the top
- [ ] Clicking `Git` shows Commits/PRs/Issues/Discussions sub-tabs (existing behavior)
- [ ] Clicking `Ops` shows Live/Jobs/Tools/Surfaces/History
- [ ] Wizard `+` opens with three driver cards (Maestro/Claude Trigger/Loop)
- [ ] Create a Loop job: name `echo-loop`, prompt `print the current time`, interval `30s`, autostart=on. A new Claude pane appears, the `/loop 30s …` command is typed into it
- [ ] Delete the Loop job: the session is killed
- [ ] Close and relaunch the app: the `echo-loop` session respawns with `/loop` re-injected (autostart)
- [ ] Toggle a Claude-trigger job's mode to `interactive` and save: a visible Claude session opens and `/schedule create …` is typed
- [ ] Live triggers sub-list shows the user's actual `/schedule list` entries; managed ones are suppressed, unmanaged ones display

### Task 63: Stage 3 completion marker + PR open

- [ ] **Step 63.1: Completion marker**

```bash
git commit --allow-empty -m "chore(ops): Stage 3 complete — Loop driver + right-panel restructure"
```

- [ ] **Step 63.2: Push**

```bash
git push -u origin feat/ops-panel
```

- [ ] **Step 63.3: Open PR**

```bash
gh pr create --title "feat: Ops panel — jobs, schedules, loops, Claude surfaces" --body "$(cat <<'EOF'
## Summary

Adds an **Ops** domain to the right side panel covering three cron-ish patterns:

- **Maestro driver** — local tokio scheduler runs arbitrary CLIs on cron while Maestro is open
- **Claude-trigger driver** — remote `/schedule` triggers persisted on Anthropic's cloud (runs even when the app is closed). Supports both headless creation (via `claude -p`) and interactive creation (opens a visible Claude pane so you see the conversational confirmation)
- **Loop driver (Stage 3)** — `/loop` running inside a Maestro-managed Claude session, in a configurable worktree, with autostart-on-app-open

Plus:

- Tool registry for reusable CLI templates
- Secrets via OS keychain
- Claude Surfaces sub-panel (Hooks editor, MCP compact view, Webhooks deep-link, Secrets manager)
- YAML import/export of jobs
- System notification on failure
- Live view of user's actual `/schedule` triggers merged with managed jobs

The right panel also restructures from Git-tabs-with-Ops-appended to two top-level domains (**Git** | **Ops**) matching the left sidebar's Config/Processes pattern.

**Staged delivery on this branch:**

- Stage 1 — MVP (jobs, schedulers, Maestro + claude-trigger drivers, UI scaffolding)
- Stage 2 — Claude Surfaces + polish (Hooks, MCP, Secrets, YAML, notifications)
- Stage 3 — Loop driver, interactive `/schedule`, live triggers, right-panel restructure

**Spec:** [docs/superpowers/specs/2026-04-18-ops-panel-design.md](./docs/superpowers/specs/2026-04-18-ops-panel-design.md)
**Stage plans:** [stage 1](./docs/superpowers/plans/2026-04-18-ops-panel-stage-1.md), [stage 2](./docs/superpowers/plans/2026-04-18-ops-panel-stage-2.md), [stage 3](./docs/superpowers/plans/2026-04-20-ops-panel-stage-3.md)

## Test plan

- [ ] Right panel switches between Git and Ops domains; existing Git tabs still work
- [ ] Maestro job runs a local shell command on cron + captures output
- [ ] Claude-trigger job (headless) creates a remote trigger via `claude -p /schedule`
- [ ] Claude-trigger job (interactive) opens a visible Claude session and types `/schedule create`
- [ ] Loop job spawns a Claude session, types `/loop N prompt`, session survives across app restart when autostart=on
- [ ] Secrets, YAML import/export, failure notifications round-trip
- [ ] `useOpenProject.test.tsx` failure is pre-existing (unrelated)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Stage 3 Self-Review

**Spec coverage check:**

- User's top-level ask ("see current /loop loops and /schedule cron jobs + auto-spawn by clicking a button + autostart on open") → Tasks 56-59 (Loop driver + wizard) + Task 57 (autostart) + Task 61 (live triggers list)
- UI restructure ("top header like left panel's Config/Processes") → Tasks 52-53
- Worktree configurable, default dedicated → Task 58 form + Task 55 `SessionInjector::resolve_worktree`
- Live triggers within same UI → Task 61 inside JobsSection
- Use all of Claude Code's capabilities → `/loop` via LoopDriver, `/schedule` via existing ClaudeTriggerDriver (now with interactive mode)

**Placeholder scan:** None. Every step has concrete code. Three soft spots flagged inline:

1. Task 55.1: `SessionManager::spawn_claude_session` / `is_ready` method names need verification against the actual codebase. Implementer reads the source and adjusts.
2. Task 57.5: `SessionManager`/`ProcessManager`/`WorktreeManager` must already be in Tauri's managed state before `OpsState::new` runs. Almost certainly true (other commands use them), but implementer verifies.
3. Task 57.4: Autostart skips project-scoped loops on boot because the project list isn't available that early. Project-scoped loops respawn when the user opens that project — note this in the autostart log.

**Type consistency:**

- `JobDriver` values match exactly across Rust (`Maestro | ClaudeTrigger | Loop`, kebab-case serialization) and TS (`"maestro" | "claude-trigger" | "loop"`).
- `WorktreeSpec` Rust enum uses `#[serde(tag = "mode", rename_all = "lowercase")]`; TS union uses `{ mode: "dedicated" }` / `{ mode: "existing", path, branch? }`. Tauri bridge sends `{"mode":"dedicated"}` → matches the discriminated union.
- `ScheduleMode` values (`"headless" | "interactive"`) match Rust enum (`Headless | Interactive`) with `#[serde(rename_all = "lowercase")]`.

---

## Execution

Subagent-driven execution, same as Stages 1 and 2. Dispatch one task at a time; the fresh-context agent reads this plan's relevant section plus Stage 1+2 plans for convention reference.

**Agent entry prompt template** (for the fresh session that picks this up):

> You are executing Stage 3 of the Ops panel feature. Plan: `/Users/jackwakem/Desktop/Maestro Projects/claude-maestro/docs/superpowers/plans/2026-04-20-ops-panel-stage-3.md`. Branch: `feat/ops-panel` (Stage 1 + Stage 2 already committed on top of `main`). Read the plan's "Scope decisions" and "File structure" sections first, then execute tasks in order using the subagent-driven-development skill. Each task has exact file paths and code blocks — don't invent. Before Task 55's `session_injector.rs` file, read the actual `SessionManager` / `ProcessManager` APIs in `src-tauri/src/core/` to verify method names. After Task 63, report back with the PR URL.
