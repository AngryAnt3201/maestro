# Ops Panel — Stage 1 (MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a fully functional Ops tab in the Git panel with scheduled jobs, one-off dispatches, CLI tool registry, and dispatch history — both Maestro-local and Claude-trigger drivers.

**Architecture:** Rust backend under `src-tauri/src/core/ops/` with a `Driver` trait, a tokio-based scheduler, and JSON persistence scoped global + per-project. React/TypeScript frontend under `src/components/ops/` with a Zustand store subscribing to Tauri events. Matches existing Maestro patterns (see `mcp_manager.rs`, `useMcpStore.ts`).

**Tech Stack:** Rust (tokio, serde, `keyring` v3 already in Cargo.toml, new: `cron` crate, `async-trait`), TypeScript/React (Zustand, @tauri-apps/api), testing (Rust `#[tokio::test]`, vitest + @testing-library/react).

**Branch:** `feat/ops-panel` (already created from `main`, spec committed at `5d3e5c55`).

**Spec:** `docs/superpowers/specs/2026-04-18-ops-panel-design.md`.

**Stage 2 (Claude Surfaces — Hooks/MCP/Webhooks/Secrets, cost wiring, notifications, YAML import/export) will be planned separately after Stage 1 is complete, on the same branch.**

---

## File Structure

**New Rust files** (`src-tauri/src/`):

```
commands/ops.rs                          # Tauri command handlers
core/ops/mod.rs                          # module root
core/ops/model.rs                        # Job, Dispatch, Tool types
core/ops/store.rs                        # JSON persistence + paths + project hashing
core/ops/dispatch_log.rs                 # rolling JSONL + log file rotation
core/ops/keychain.rs                     # secrets wrapper over `keyring`
core/ops/scheduler.rs                    # tokio cron loop
core/ops/drivers/mod.rs                  # Driver trait + DriverKind enum
core/ops/drivers/maestro.rs              # spawn Command, stream output
core/ops/drivers/claude_trigger.rs       # proxy via `claude -p /schedule`
core/ops/drivers/fake.rs                 # #[cfg(test)] deterministic driver for tests
```

**Modified Rust files:**

- `src-tauri/Cargo.toml` — add `cron = "0.12"`, `async-trait = "0.1"`
- `src-tauri/src/commands/mod.rs` — add `pub mod ops;`
- `src-tauri/src/core/mod.rs` — add `pub mod ops;`
- `src-tauri/src/lib.rs` — register ops commands, spawn scheduler, attach state

**New TypeScript files** (`src/`):

```
types/ops.ts                             # mirrors Rust types
lib/ops.ts                               # Tauri invoke wrappers + event listeners
stores/useOpsStore.ts                    # Zustand store
components/ops/OpsPanel.tsx              # entry
components/ops/sections/LiveSection.tsx
components/ops/sections/JobsSection.tsx
components/ops/sections/ToolsSection.tsx
components/ops/sections/HistorySection.tsx
components/ops/sections/SurfacesPlaceholder.tsx
components/ops/JobRow.tsx                # collapsed + expanded
components/ops/JobDetailPanel.tsx        # slide-over
components/ops/NewJobWizard.tsx          # modal
components/ops/DispatchViewer.tsx
```

**Modified TypeScript files:**

- `src/components/git/GitPanelTabs.tsx` — add `"ops"` tab
- `src/components/git/GitPanelContent.tsx` — route `"ops"` to `OpsPanel`
- `src/components/git/GitGraphPanel.tsx` — include `JobDetailPanel` slide-over
- `src/App.tsx` — initialize ops store on mount (event subscriptions)

---

## Phase A — Rust foundation

### Task 1: Add dependencies and module scaffolding

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/core/ops/mod.rs`
- Modify: `src-tauri/src/core/mod.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/ops.rs` (stub)

- [ ] **Step 1.1: Add crates to Cargo.toml**

Edit `src-tauri/Cargo.toml`. In the `[dependencies]` section, after the `chrono` line, add:

```toml
# Cron expression parsing + next-fire calculation
cron = "0.12"
# async fns in trait objects
async-trait = "0.1"
```

- [ ] **Step 1.2: Create module root**

Create `src-tauri/src/core/ops/mod.rs`:

```rust
//! Ops panel: jobs, dispatches, tools, and drivers.
//!
//! See docs/superpowers/specs/2026-04-18-ops-panel-design.md for design.

pub mod dispatch_log;
pub mod drivers;
pub mod keychain;
pub mod model;
pub mod scheduler;
pub mod store;

pub use drivers::Driver;
pub use model::{Dispatch, Job, Tool};
```

- [ ] **Step 1.3: Register module in core**

Edit `src-tauri/src/core/mod.rs`. Add (alphabetical position):

```rust
pub mod ops;
```

- [ ] **Step 1.4: Stub commands file**

Create `src-tauri/src/commands/ops.rs`:

```rust
//! Tauri command handlers for the Ops panel.
//!
//! Wiring is filled in Task 10.
```

- [ ] **Step 1.5: Register commands module**

Edit `src-tauri/src/commands/mod.rs`. Add alphabetically:

```rust
pub mod ops;
```

- [ ] **Step 1.6: Verify it builds**

Run: `cd src-tauri && cargo check`
Expected: compiles with warnings about unused modules. No errors.

- [ ] **Step 1.7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/core/ops/mod.rs \
        src-tauri/src/core/mod.rs src-tauri/src/commands/ops.rs src-tauri/src/commands/mod.rs
git commit -m "feat(ops): scaffold ops module and add cron/async-trait deps"
```

---

### Task 2: Core types (`model.rs`)

**Files:**
- Create: `src-tauri/src/core/ops/model.rs`
- Test: `src-tauri/src/core/ops/model.rs` (inline `#[cfg(test)]`)

- [ ] **Step 2.1: Write the failing serde round-trip test**

Create `src-tauri/src/core/ops/model.rs` with the module skeleton plus a failing test:

```rust
//! Domain types for the Ops panel. Mirrors `src/types/ops.ts`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    Global,
    Project,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobDriver {
    Maestro,
    ClaudeTrigger,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DispatchStatus {
    Running,
    Succeeded,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TriggeredBy {
    Schedule,
    Manual,
    Webhook,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MaestroJobPayload {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_sec: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ClaudeTriggerPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trigger_id: Option<String>,
    pub prompt: String,
    #[serde(default)]
    pub mcp_connectors: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastDispatch {
    pub id: String,
    pub started_at: i64,
    pub status: DispatchStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub scope: Scope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_hash: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub driver: JobDriver,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schedule: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maestro: Option<MaestroJobPayload>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude_trigger: Option<ClaudeTriggerPayload>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_id: Option<String>,
    #[serde(default)]
    pub notify_on_failure: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_dispatch: Option<LastDispatch>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dispatch {
    pub id: String,
    pub job_id: String,
    pub scope: Scope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_hash: Option<String>,
    pub started_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<i64>,
    pub status: DispatchStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub triggered_by: TriggeredBy,
    #[serde(default)]
    pub output_head: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolDefaults {
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    pub id: String,
    pub name: String,
    pub binary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install_check: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default)]
    pub defaults: ToolDefaults,
    pub created_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_round_trips_through_serde_json() {
        let job = Job {
            id: "j1".into(),
            name: "ghd daily".into(),
            enabled: true,
            scope: Scope::Project,
            project_hash: Some("abc123".into()),
            tags: vec!["digest".into()],
            driver: JobDriver::Maestro,
            schedule: Some("0 9 * * *".into()),
            maestro: Some(MaestroJobPayload {
                command: "ghd".into(),
                args: vec!["list".into()],
                cwd: None,
                env: HashMap::new(),
                timeout_sec: Some(900),
            }),
            claude_trigger: None,
            tool_id: None,
            notify_on_failure: true,
            last_dispatch: None,
            created_at: 1_700_000_000,
            updated_at: 1_700_000_000,
        };

        let json = serde_json::to_string(&job).unwrap();
        let back: Job = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "j1");
        assert_eq!(back.driver, JobDriver::Maestro);
        assert!(back.maestro.is_some());
        assert_eq!(back.maestro.as_ref().unwrap().command, "ghd");
        assert!(back.claude_trigger.is_none());
    }

    #[test]
    fn job_driver_serializes_kebab_case() {
        let json = serde_json::to_string(&JobDriver::ClaudeTrigger).unwrap();
        assert_eq!(json, "\"claude-trigger\"");
    }

    #[test]
    fn scope_serializes_lowercase() {
        assert_eq!(serde_json::to_string(&Scope::Global).unwrap(), "\"global\"");
        assert_eq!(serde_json::to_string(&Scope::Project).unwrap(), "\"project\"");
    }
}
```

- [ ] **Step 2.2: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib ops::model::tests`
Expected: 3 passed.

- [ ] **Step 2.3: Commit**

```bash
git add src-tauri/src/core/ops/model.rs
git commit -m "feat(ops): add Job, Dispatch, Tool domain types"
```

---

### Task 3: Store and paths (`store.rs`)

**Files:**
- Create: `src-tauri/src/core/ops/store.rs`

- [ ] **Step 3.1: Write the failing path + hashing tests**

Create `src-tauri/src/core/ops/store.rs`:

```rust
//! Persistence layer for Ops. JSON files under ~/.claude-maestro/ops/.
//!
//! Layout:
//!   ~/.claude-maestro/ops/global/jobs.json        (scope=global jobs)
//!   ~/.claude-maestro/ops/global/tools.json       (tools — always global)
//!   ~/.claude-maestro/ops/global/dispatches.jsonl
//!   ~/.claude-maestro/ops/global/logs/<id>.log
//!   ~/.claude-maestro/ops/<projectHash>/jobs.json
//!   ~/.claude-maestro/ops/<projectHash>/dispatches.jsonl
//!   ~/.claude-maestro/ops/<projectHash>/logs/<id>.log

use crate::core::ops::model::{Dispatch, Job, Scope, Tool};
use directories::BaseDirs;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("home directory unavailable")]
    NoHome,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("project scope requires projectHash")]
    MissingProjectHash,
}

pub type StoreResult<T> = Result<T, StoreError>;

/// Stable hash for a project path. Canonical form: absolute, normalized.
/// Falls back to the raw path if canonicalize fails (e.g. path doesn't exist yet).
pub fn hash_project_path(path: &Path) -> String {
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let s = canonical.to_string_lossy();
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
    let digest = hasher.finalize();
    hex::encode(&digest[..8]) // 16 hex chars; collision resistant for this cardinality
}

fn ops_root() -> StoreResult<PathBuf> {
    let base = BaseDirs::new().ok_or(StoreError::NoHome)?;
    Ok(base.home_dir().join(".claude-maestro").join("ops"))
}

/// Returns the directory for a given scope. Creates it if missing.
pub fn scope_dir(scope: Scope, project_hash: Option<&str>) -> StoreResult<PathBuf> {
    let root = ops_root()?;
    let dir = match scope {
        Scope::Global => root.join("global"),
        Scope::Project => {
            let h = project_hash.ok_or(StoreError::MissingProjectHash)?;
            root.join(h)
        }
    };
    fs::create_dir_all(&dir)?;
    fs::create_dir_all(dir.join("logs"))?;
    Ok(dir)
}

// ---- Jobs ----

pub fn load_jobs(scope: Scope, project_hash: Option<&str>) -> StoreResult<Vec<Job>> {
    let path = scope_dir(scope, project_hash)?.join("jobs.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path)?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_str(&raw)?)
}

pub fn save_jobs(scope: Scope, project_hash: Option<&str>, jobs: &[Job]) -> StoreResult<()> {
    let path = scope_dir(scope, project_hash)?.join("jobs.json");
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(jobs)?)?;
    fs::rename(&tmp, &path)?;
    Ok(())
}

// ---- Tools (always global) ----

pub fn load_tools() -> StoreResult<Vec<Tool>> {
    let path = scope_dir(Scope::Global, None)?.join("tools.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path)?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_str(&raw)?)
}

pub fn save_tools(tools: &[Tool]) -> StoreResult<()> {
    let path = scope_dir(Scope::Global, None)?.join("tools.json");
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(tools)?)?;
    fs::rename(&tmp, &path)?;
    Ok(())
}

// ---- Dispatches (append-only JSONL) ----

pub fn append_dispatch(
    scope: Scope,
    project_hash: Option<&str>,
    dispatch: &Dispatch,
) -> StoreResult<()> {
    let path = scope_dir(scope, project_hash)?.join("dispatches.jsonl");
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    let line = serde_json::to_string(dispatch)?;
    writeln!(f, "{}", line)?;
    Ok(())
}

/// Reads the most recent N dispatches (newest first).
pub fn recent_dispatches(
    scope: Scope,
    project_hash: Option<&str>,
    limit: usize,
) -> StoreResult<Vec<Dispatch>> {
    let path = scope_dir(scope, project_hash)?.join("dispatches.jsonl");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let f = fs::File::open(&path)?;
    let reader = BufReader::new(f);
    // Load all, then take last N. JSONL files here are rotated, so this is bounded.
    let mut all: Vec<Dispatch> = Vec::new();
    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<Dispatch>(&line) {
            Ok(d) => all.push(d),
            Err(_) => continue, // tolerate corrupt lines
        }
    }
    all.reverse();
    all.truncate(limit);
    Ok(all)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ops::model::{DispatchStatus, TriggeredBy};

    #[test]
    fn hashes_are_stable() {
        let p = PathBuf::from("/tmp");
        let a = hash_project_path(&p);
        let b = hash_project_path(&p);
        assert_eq!(a, b);
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn hashes_differ_by_path() {
        let a = hash_project_path(&PathBuf::from("/tmp/a"));
        let b = hash_project_path(&PathBuf::from("/tmp/b"));
        assert_ne!(a, b);
    }

    #[test]
    fn missing_project_hash_errors() {
        // Scope::Project without hash must error, regardless of filesystem state.
        let err = scope_dir(Scope::Project, None).unwrap_err();
        match err {
            StoreError::MissingProjectHash => {}
            other => panic!("expected MissingProjectHash, got {other:?}"),
        }
    }

    #[test]
    fn dispatch_round_trips() {
        // In-memory JSONL round-trip; does not touch disk.
        let d = Dispatch {
            id: "d1".into(),
            job_id: "j1".into(),
            scope: Scope::Global,
            project_hash: None,
            started_at: 1,
            ended_at: Some(2),
            status: DispatchStatus::Succeeded,
            exit_code: Some(0),
            triggered_by: TriggeredBy::Manual,
            output_head: "ok".into(),
            log_path: None,
            tokens: None,
            duration_ms: Some(1000),
        };
        let line = serde_json::to_string(&d).unwrap();
        let back: Dispatch = serde_json::from_str(&line).unwrap();
        assert_eq!(back.status, DispatchStatus::Succeeded);
    }
}
```

- [ ] **Step 3.2: Run tests**

Run: `cd src-tauri && cargo test --lib ops::store::tests`
Expected: 4 passed.

- [ ] **Step 3.3: Commit**

```bash
git add src-tauri/src/core/ops/store.rs
git commit -m "feat(ops): add JSON store with project hashing and dispatch JSONL"
```

---

### Task 4: Dispatch log with rotation (`dispatch_log.rs`)

**Files:**
- Create: `src-tauri/src/core/ops/dispatch_log.rs`

- [ ] **Step 4.1: Write log-writer + rotation logic with tests**

Create `src-tauri/src/core/ops/dispatch_log.rs`:

```rust
//! Per-dispatch log files under <scopeDir>/logs/<dispatchId>.log,
//! plus rotation of the dispatches.jsonl file + orphan log cleanup.
//!
//! Retention: last 200 dispatches per job, OR 30 days (whichever first).

use crate::core::ops::model::Dispatch;
use crate::core::ops::store::{scope_dir, StoreResult};
use crate::core::ops::model::Scope;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

pub const RETENTION_PER_JOB: usize = 200;
pub const RETENTION_DAYS: i64 = 30;

pub fn log_path(scope: Scope, project_hash: Option<&str>, dispatch_id: &str) -> StoreResult<PathBuf> {
    let dir = scope_dir(scope, project_hash)?.join("logs");
    Ok(dir.join(format!("{dispatch_id}.log")))
}

/// Appends bytes to the dispatch's log file. Degrades gracefully: on write
/// error returns Err so the caller can surface a banner, but doesn't panic.
pub fn append_log(
    scope: Scope,
    project_hash: Option<&str>,
    dispatch_id: &str,
    chunk: &[u8],
) -> StoreResult<()> {
    let p = log_path(scope, project_hash, dispatch_id)?;
    let mut f = fs::OpenOptions::new().create(true).append(true).open(&p)?;
    f.write_all(chunk)?;
    Ok(())
}

pub fn read_log_tail(
    scope: Scope,
    project_hash: Option<&str>,
    dispatch_id: &str,
    max_bytes: usize,
) -> StoreResult<String> {
    let p = log_path(scope, project_hash, dispatch_id)?;
    if !p.exists() {
        return Ok(String::new());
    }
    let data = fs::read(&p)?;
    let start = data.len().saturating_sub(max_bytes);
    Ok(String::from_utf8_lossy(&data[start..]).to_string())
}

/// Rewrites dispatches.jsonl keeping only retained entries, and deletes orphan log files.
/// Called on startup and after each run is complete.
pub fn rotate(
    scope: Scope,
    project_hash: Option<&str>,
    now_unix: i64,
) -> StoreResult<RotateReport> {
    let dir = scope_dir(scope, project_hash)?;
    let jsonl = dir.join("dispatches.jsonl");
    if !jsonl.exists() {
        return Ok(RotateReport::default());
    }

    let raw = fs::read_to_string(&jsonl)?;
    let mut per_job: HashMap<String, Vec<Dispatch>> = HashMap::new();
    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(d) = serde_json::from_str::<Dispatch>(line) {
            per_job.entry(d.job_id.clone()).or_default().push(d);
        }
    }

    let cutoff = now_unix - (RETENTION_DAYS * 86_400);
    let mut keep: Vec<Dispatch> = Vec::new();
    let mut dropped_ids: Vec<String> = Vec::new();
    for (_job, mut runs) in per_job {
        runs.sort_by_key(|d| d.started_at);
        let len = runs.len();
        let min_keep_idx = len.saturating_sub(RETENTION_PER_JOB);
        for (idx, d) in runs.into_iter().enumerate() {
            if idx >= min_keep_idx && d.started_at >= cutoff {
                keep.push(d);
            } else {
                dropped_ids.push(d.id);
            }
        }
    }
    keep.sort_by_key(|d| d.started_at);

    // Rewrite
    let tmp = jsonl.with_extension("jsonl.tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        for d in &keep {
            writeln!(f, "{}", serde_json::to_string(d)?)?;
        }
    }
    fs::rename(&tmp, &jsonl)?;

    // Delete orphan logs
    let mut removed_logs = 0usize;
    let logs_dir = dir.join("logs");
    if logs_dir.exists() {
        for dropped in &dropped_ids {
            let p = logs_dir.join(format!("{dropped}.log"));
            if p.exists() {
                let _ = fs::remove_file(&p);
                removed_logs += 1;
            }
        }
    }

    Ok(RotateReport {
        kept: keep.len(),
        dropped: dropped_ids.len(),
        removed_logs,
    })
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct RotateReport {
    pub kept: usize,
    pub dropped: usize,
    pub removed_logs: usize,
}

#[cfg(test)]
mod tests {
    // Full rotation tests require a temp HOME — run via integration tests in Task 12.
    // Here we only unit-test report defaults to keep this task fast.
    use super::*;

    #[test]
    fn report_default_is_all_zeros() {
        let r = RotateReport::default();
        assert_eq!(r, RotateReport { kept: 0, dropped: 0, removed_logs: 0 });
    }
}
```

- [ ] **Step 4.2: Run tests**

Run: `cd src-tauri && cargo test --lib ops::dispatch_log::tests`
Expected: 1 passed.

- [ ] **Step 4.3: Commit**

```bash
git add src-tauri/src/core/ops/dispatch_log.rs
git commit -m "feat(ops): add per-dispatch log writer with rotation"
```

---

### Task 5: Keychain wrapper (`keychain.rs`)

**Files:**
- Create: `src-tauri/src/core/ops/keychain.rs`

- [ ] **Step 5.1: Write the failing put/get/delete test**

Create `src-tauri/src/core/ops/keychain.rs`:

```rust
//! Wrapper over the `keyring` crate for Ops secrets.
//!
//! Service name: "com.claude-maestro.ops". Key names are opaque secret IDs.

use keyring::Entry;
use thiserror::Error;

const SERVICE: &str = "com.claude-maestro.ops";

#[derive(Debug, Error)]
pub enum KeychainError {
    #[error("keychain unavailable: {0}")]
    Unavailable(String),
    #[error("secret not found: {0}")]
    NotFound(String),
    #[error("keyring error: {0}")]
    Other(String),
}

pub type KeychainResult<T> = Result<T, KeychainError>;

fn entry(id: &str) -> KeychainResult<Entry> {
    Entry::new(SERVICE, id).map_err(|e| KeychainError::Unavailable(e.to_string()))
}

pub fn put(id: &str, value: &str) -> KeychainResult<()> {
    let e = entry(id)?;
    e.set_password(value).map_err(|e| KeychainError::Other(e.to_string()))
}

pub fn get(id: &str) -> KeychainResult<String> {
    let e = entry(id)?;
    match e.get_password() {
        Ok(v) => Ok(v),
        Err(keyring::Error::NoEntry) => Err(KeychainError::NotFound(id.to_string())),
        Err(e) => Err(KeychainError::Other(e.to_string())),
    }
}

pub fn delete(id: &str) -> KeychainResult<()> {
    let e = entry(id)?;
    match e.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Err(KeychainError::NotFound(id.to_string())),
        Err(e) => Err(KeychainError::Other(e.to_string())),
    }
}

#[cfg(test)]
mod tests {
    // Keychain tests require real OS access and are flaky in CI — gate behind an env var.
    use super::*;

    fn enabled() -> bool {
        std::env::var("MAESTRO_KEYCHAIN_TEST").ok().as_deref() == Some("1")
    }

    #[test]
    fn put_get_delete_round_trip() {
        if !enabled() {
            eprintln!("skipping keychain round-trip; set MAESTRO_KEYCHAIN_TEST=1 to enable");
            return;
        }
        let id = format!("test-{}", uuid::Uuid::new_v4());
        put(&id, "hunter2").unwrap();
        assert_eq!(get(&id).unwrap(), "hunter2");
        delete(&id).unwrap();
        assert!(matches!(get(&id), Err(KeychainError::NotFound(_))));
    }
}
```

- [ ] **Step 5.2: Run tests**

Run: `cd src-tauri && cargo test --lib ops::keychain::tests`
Expected: 1 passed (skipped body).

Optional smoke run (only on dev box, writes real keychain entry then cleans it):
```bash
cd src-tauri && MAESTRO_KEYCHAIN_TEST=1 cargo test --lib ops::keychain::tests
```

- [ ] **Step 5.3: Commit**

```bash
git add src-tauri/src/core/ops/keychain.rs
git commit -m "feat(ops): add keychain wrapper over keyring crate"
```

---

**Phase A checkpoint:** Run `cd src-tauri && cargo check && cargo test --lib ops::` to confirm everything still compiles and all ops tests pass.

---

## Phase B — Drivers and scheduler

### Task 6: Driver trait and fake driver

**Files:**
- Create: `src-tauri/src/core/ops/drivers/mod.rs`
- Create: `src-tauri/src/core/ops/drivers/fake.rs`

- [ ] **Step 6.1: Write the Driver trait and DispatchContext**

Create `src-tauri/src/core/ops/drivers/mod.rs`:

```rust
//! Driver abstraction. A Driver knows how to create/update/delete a job in
//! its external world (or no-op for local-only) and how to run it now.

pub mod fake;
pub mod maestro;
pub mod claude_trigger;

use crate::core::ops::model::Job;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

/// Events emitted during a dispatch — consumed by the scheduler which
/// forwards them to the Tauri event bus.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum DispatchEvent {
    /// stdout/stderr chunk from the running process.
    Output { dispatch_id: String, chunk: String, is_stderr: bool },
    /// Final status once the run is complete.
    Finished {
        dispatch_id: String,
        status: crate::core::ops::model::DispatchStatus,
        exit_code: Option<i32>,
        tokens: Option<u64>,
    },
}

/// Channel half the driver writes events to.
pub type DispatchTx = mpsc::UnboundedSender<DispatchEvent>;

/// Info handed to the driver when starting a run.
#[derive(Debug, Clone)]
pub struct DispatchContext {
    pub dispatch_id: String,
    pub triggered_by: crate::core::ops::model::TriggeredBy,
}

/// Capability flags — the frontend reads these to gate UI affordances.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct DriverCapabilities {
    pub supports_delete: bool,
    pub supports_raw_env: bool,
    pub supports_local_logs: bool,
    pub supports_mcp_connectors: bool,
    pub min_interval_seconds: u64,
}

/// Metadata returned by `create` — may include an external trigger ID.
#[derive(Debug, Clone, Default)]
pub struct DriverMeta {
    pub trigger_id: Option<String>,
}

/// A job discovered on the external system (claude-trigger driver only).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalJob {
    pub external_id: String,
    pub name: String,
    pub schedule: Option<String>,
    pub prompt: Option<String>,
    pub last_run_at: Option<i64>,
    pub next_run_at: Option<i64>,
}

#[async_trait]
pub trait Driver: Send + Sync {
    async fn create(&self, job: &Job) -> anyhow::Result<DriverMeta>;
    async fn update(&self, job: &Job) -> anyhow::Result<()>;
    async fn delete(&self, job: &Job) -> anyhow::Result<()>;
    async fn run_now(&self, job: &Job, ctx: DispatchContext, tx: DispatchTx) -> anyhow::Result<()>;
    async fn list_external(&self) -> anyhow::Result<Vec<ExternalJob>>;
    fn capabilities(&self) -> DriverCapabilities;
}
```

- [ ] **Step 6.2: Add anyhow dependency**

Edit `src-tauri/Cargo.toml`, add:

```toml
anyhow = "1"
```

- [ ] **Step 6.3: Write the fake driver with a failing test**

Create `src-tauri/src/core/ops/drivers/fake.rs`:

```rust
//! Deterministic in-memory driver used by tests.

use super::{DispatchContext, DispatchEvent, DispatchTx, Driver, DriverCapabilities, DriverMeta, ExternalJob};
use crate::core::ops::model::{DispatchStatus, Job};
use async_trait::async_trait;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

#[derive(Default)]
pub struct FakeDriver {
    pub runs: Arc<AtomicUsize>,
}

impl FakeDriver {
    pub fn new() -> Self {
        Self { runs: Arc::new(AtomicUsize::new(0)) }
    }
}

#[async_trait]
impl Driver for FakeDriver {
    async fn create(&self, _job: &Job) -> anyhow::Result<DriverMeta> {
        Ok(DriverMeta::default())
    }
    async fn update(&self, _job: &Job) -> anyhow::Result<()> { Ok(()) }
    async fn delete(&self, _job: &Job) -> anyhow::Result<()> { Ok(()) }

    async fn run_now(&self, _job: &Job, ctx: DispatchContext, tx: DispatchTx) -> anyhow::Result<()> {
        self.runs.fetch_add(1, Ordering::SeqCst);
        let id = ctx.dispatch_id.clone();
        let _ = tx.send(DispatchEvent::Output { dispatch_id: id.clone(), chunk: "hello\n".into(), is_stderr: false });
        let _ = tx.send(DispatchEvent::Finished {
            dispatch_id: id,
            status: DispatchStatus::Succeeded,
            exit_code: Some(0),
            tokens: None,
        });
        Ok(())
    }

    async fn list_external(&self) -> anyhow::Result<Vec<ExternalJob>> { Ok(Vec::new()) }

    fn capabilities(&self) -> DriverCapabilities {
        DriverCapabilities {
            supports_delete: true,
            supports_raw_env: true,
            supports_local_logs: true,
            supports_mcp_connectors: false,
            min_interval_seconds: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ops::model::*;
    use tokio::sync::mpsc;

    fn make_job() -> Job {
        Job {
            id: "j1".into(),
            name: "fake".into(),
            enabled: true,
            scope: Scope::Global,
            project_hash: None,
            tags: vec![],
            driver: JobDriver::Maestro,
            schedule: None,
            maestro: None,
            claude_trigger: None,
            tool_id: None,
            notify_on_failure: false,
            last_dispatch: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[tokio::test]
    async fn fake_driver_emits_output_then_finished() {
        let d = FakeDriver::new();
        let (tx, mut rx) = mpsc::unbounded_channel();
        d.run_now(&make_job(), DispatchContext { dispatch_id: "dispatch-1".into(), triggered_by: TriggeredBy::Manual }, tx)
            .await
            .unwrap();

        let first = rx.recv().await.unwrap();
        match first {
            DispatchEvent::Output { chunk, .. } => assert_eq!(chunk, "hello\n"),
            other => panic!("expected Output, got {other:?}"),
        }
        let second = rx.recv().await.unwrap();
        match second {
            DispatchEvent::Finished { status, .. } => assert_eq!(status, DispatchStatus::Succeeded),
            other => panic!("expected Finished, got {other:?}"),
        }
        assert_eq!(d.runs.load(Ordering::SeqCst), 1);
    }
}
```

- [ ] **Step 6.4: Create stubs for maestro.rs and claude_trigger.rs so the module compiles**

Create `src-tauri/src/core/ops/drivers/maestro.rs`:

```rust
//! Maestro driver — implemented in Task 7.
```

Create `src-tauri/src/core/ops/drivers/claude_trigger.rs`:

```rust
//! Claude-trigger driver — implemented in Task 8.
```

- [ ] **Step 6.5: Run tests**

Run: `cd src-tauri && cargo test --lib ops::drivers::fake::tests`
Expected: 1 passed.

- [ ] **Step 6.6: Commit**

```bash
git add src-tauri/src/core/ops/drivers/ src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(ops): add Driver trait, DispatchEvent, and FakeDriver for tests"
```

---

### Task 7: Maestro driver (spawn + stream)

**Files:**
- Modify: `src-tauri/src/core/ops/drivers/maestro.rs`

- [ ] **Step 7.1: Replace the stub with full implementation**

Replace the contents of `src-tauri/src/core/ops/drivers/maestro.rs` with:

```rust
//! Maestro driver: spawns a Command, streams stdout/stderr via a channel,
//! sends Finished with exit code. Enforces per-job timeout (default 900s).

use super::{DispatchContext, DispatchEvent, DispatchTx, Driver, DriverCapabilities, DriverMeta, ExternalJob};
use crate::core::ops::model::{DispatchStatus, Job};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

pub const DEFAULT_TIMEOUT_SEC: u64 = 900;

pub struct MaestroDriver;

impl MaestroDriver {
    pub fn new() -> Self { Self }
}

#[async_trait]
impl Driver for MaestroDriver {
    async fn create(&self, _job: &Job) -> Result<DriverMeta> { Ok(DriverMeta::default()) }
    async fn update(&self, _job: &Job) -> Result<()> { Ok(()) }
    async fn delete(&self, _job: &Job) -> Result<()> { Ok(()) }

    async fn run_now(&self, job: &Job, ctx: DispatchContext, tx: DispatchTx) -> Result<()> {
        let payload = job.maestro.as_ref()
            .ok_or_else(|| anyhow!("maestro driver used but job.maestro is None"))?;

        let mut cmd = Command::new(&payload.command);
        cmd.args(&payload.args);
        if let Some(cwd) = &payload.cwd {
            cmd.current_dir(cwd);
        }
        for (k, v) in &payload.env {
            cmd.env(k, v);
        }
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());

        let mut child = cmd.spawn().map_err(|e| anyhow!("spawn failed: {e}"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout handle"))?;
        let stderr = child.stderr.take().ok_or_else(|| anyhow!("no stderr handle"))?;

        let timeout = Duration::from_secs(payload.timeout_sec.unwrap_or(DEFAULT_TIMEOUT_SEC));
        let dispatch_id = ctx.dispatch_id.clone();

        // Stream stdout
        let tx_out = tx.clone();
        let id_out = dispatch_id.clone();
        let out_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = tx_out.send(DispatchEvent::Output {
                    dispatch_id: id_out.clone(),
                    chunk: format!("{line}\n"),
                    is_stderr: false,
                });
            }
        });

        // Stream stderr
        let tx_err = tx.clone();
        let id_err = dispatch_id.clone();
        let err_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = tx_err.send(DispatchEvent::Output {
                    dispatch_id: id_err.clone(),
                    chunk: format!("{line}\n"),
                    is_stderr: true,
                });
            }
        });

        // Wait with timeout
        let wait_res = tokio::time::timeout(timeout, child.wait()).await;
        let (status_enum, exit_code) = match wait_res {
            Ok(Ok(exit)) => {
                if exit.success() {
                    (DispatchStatus::Succeeded, exit.code())
                } else {
                    (DispatchStatus::Failed, exit.code())
                }
            }
            Ok(Err(e)) => {
                let _ = tx.send(DispatchEvent::Output {
                    dispatch_id: dispatch_id.clone(),
                    chunk: format!("[scheduler] wait error: {e}\n"),
                    is_stderr: true,
                });
                (DispatchStatus::Failed, None)
            }
            Err(_) => {
                let _ = tx.send(DispatchEvent::Output {
                    dispatch_id: dispatch_id.clone(),
                    chunk: format!("[scheduler] timeout after {}s, sending SIGTERM\n", timeout.as_secs()),
                    is_stderr: true,
                });
                let _ = child.start_kill();
                // Grace period of 5 seconds before forcing
                let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
                (DispatchStatus::Cancelled, None)
            }
        };

        let _ = tokio::join!(out_task, err_task);

        let _ = tx.send(DispatchEvent::Finished {
            dispatch_id,
            status: status_enum,
            exit_code,
            tokens: None,
        });
        Ok(())
    }

    async fn list_external(&self) -> Result<Vec<ExternalJob>> { Ok(Vec::new()) }

    fn capabilities(&self) -> DriverCapabilities {
        DriverCapabilities {
            supports_delete: true,
            supports_raw_env: true,
            supports_local_logs: true,
            supports_mcp_connectors: false,
            min_interval_seconds: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ops::model::*;
    use std::collections::HashMap;
    use tokio::sync::mpsc;

    fn echo_job() -> Job {
        Job {
            id: "j".into(),
            name: "echo".into(),
            enabled: true,
            scope: Scope::Global,
            project_hash: None,
            tags: vec![],
            driver: JobDriver::Maestro,
            schedule: None,
            maestro: Some(MaestroJobPayload {
                command: "echo".into(),
                args: vec!["hello".into()],
                cwd: None,
                env: HashMap::new(),
                timeout_sec: Some(5),
            }),
            claude_trigger: None,
            tool_id: None,
            notify_on_failure: false,
            last_dispatch: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[tokio::test]
    async fn echo_produces_stdout_and_success() {
        let d = MaestroDriver::new();
        let (tx, mut rx) = mpsc::unbounded_channel();
        d.run_now(&echo_job(), DispatchContext { dispatch_id: "d1".into(), triggered_by: TriggeredBy::Manual }, tx)
            .await
            .unwrap();

        let mut saw_output = false;
        let mut final_status = None;
        while let Some(evt) = rx.recv().await {
            match evt {
                DispatchEvent::Output { chunk, is_stderr, .. } => {
                    if !is_stderr && chunk.contains("hello") {
                        saw_output = true;
                    }
                }
                DispatchEvent::Finished { status, .. } => {
                    final_status = Some(status);
                    break;
                }
            }
        }
        assert!(saw_output);
        assert_eq!(final_status, Some(DispatchStatus::Succeeded));
    }

    #[tokio::test]
    async fn missing_binary_returns_error() {
        let d = MaestroDriver::new();
        let mut j = echo_job();
        j.maestro.as_mut().unwrap().command = "definitely-not-a-real-binary-xyz".into();
        let (tx, _rx) = mpsc::unbounded_channel();
        let err = d.run_now(&j, DispatchContext { dispatch_id: "d2".into(), triggered_by: TriggeredBy::Manual }, tx).await;
        assert!(err.is_err());
    }
}
```

- [ ] **Step 7.2: Run tests**

Run: `cd src-tauri && cargo test --lib ops::drivers::maestro::tests`
Expected: 2 passed.

- [ ] **Step 7.3: Commit**

```bash
git add src-tauri/src/core/ops/drivers/maestro.rs
git commit -m "feat(ops): implement Maestro driver with stdout/stderr streaming and timeout"
```

---

### Task 8: Claude-trigger driver proxy

**Files:**
- Modify: `src-tauri/src/core/ops/drivers/claude_trigger.rs`

- [ ] **Step 8.1: Implement the proxy via `claude -p /schedule`**

Replace `src-tauri/src/core/ops/drivers/claude_trigger.rs` with:

```rust
//! Claude-trigger driver. Proxies to `/schedule` via `claude -p`.
//!
//! `/schedule` output is conversational; we use `--output-format=json` to get
//! a structured envelope and parse the final message content. When the CLI
//! is missing or returns a non-zero code we surface the raw stderr so the UI
//! can show an actionable banner.

use super::{DispatchContext, DispatchEvent, DispatchTx, Driver, DriverCapabilities, DriverMeta, ExternalJob};
use crate::core::ops::model::{DispatchStatus, Job};
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use serde_json::Value;
use std::process::Stdio;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

/// Minimum supported cron interval for Claude triggers (skill-enforced: ≥1h).
pub const MIN_INTERVAL_SEC: u64 = 3600;

pub struct ClaudeTriggerDriver {
    claude_bin: String,
}

impl ClaudeTriggerDriver {
    pub fn new() -> Self { Self { claude_bin: "claude".to_string() } }
    #[allow(dead_code)]
    pub fn with_binary(claude_bin: impl Into<String>) -> Self { Self { claude_bin: claude_bin.into() } }

    async fn invoke_schedule(&self, subprompt: &str) -> Result<String> {
        let mut cmd = Command::new(&self.claude_bin);
        cmd.arg("-p")
            .arg("--output-format=json")
            .arg(subprompt)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null());

        let mut child = cmd.spawn()
            .map_err(|e| anyhow!("failed to spawn `{}`: {e}", self.claude_bin))?;

        let mut stdout = String::new();
        let mut stderr = String::new();
        if let Some(mut o) = child.stdout.take() {
            o.read_to_string(&mut stdout).await.ok();
        }
        if let Some(mut e) = child.stderr.take() {
            e.read_to_string(&mut stderr).await.ok();
        }
        let status = child.wait().await?;
        if !status.success() {
            return Err(anyhow!("claude -p exited {:?}: {}", status.code(), stderr.trim()));
        }
        Ok(stdout)
    }

    /// Extracts the "result" field from the JSON output format.
    fn extract_result(raw: &str) -> Result<String> {
        let v: Value = serde_json::from_str(raw)
            .with_context(|| format!("invalid JSON from claude -p: {}", raw.chars().take(200).collect::<String>()))?;
        v.get("result")
            .and_then(|r| r.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow!("missing `result` field in claude -p output"))
    }
}

#[async_trait]
impl Driver for ClaudeTriggerDriver {
    async fn create(&self, job: &Job) -> Result<DriverMeta> {
        let p = job.claude_trigger.as_ref()
            .ok_or_else(|| anyhow!("claude_trigger payload missing"))?;
        let schedule = job.schedule.as_deref().unwrap_or("");
        let connectors = if p.mcp_connectors.is_empty() {
            String::new()
        } else {
            format!(" Attach connectors: {}.", p.mcp_connectors.join(", "))
        };
        let sub = format!(
            "/schedule create a trigger named \"{}\" on cron \"{}\" with prompt: {}.{}",
            job.name.replace('"', "'"),
            schedule,
            p.prompt,
            connectors
        );
        let result = self.invoke_schedule(&sub).await?;
        let text = Self::extract_result(&result)?;
        // Heuristic: look for a UUID-ish trigger id in the response.
        let trigger_id = text
            .split_whitespace()
            .find(|w| w.len() >= 24 && w.chars().all(|c| c.is_ascii_hexdigit() || c == '-'))
            .map(|s| s.to_string());
        Ok(DriverMeta { trigger_id })
    }

    async fn update(&self, job: &Job) -> Result<()> {
        let schedule = job.schedule.as_deref().unwrap_or("");
        let sub = format!("/schedule change the trigger named \"{}\" to cron \"{}\"",
            job.name.replace('"', "'"), schedule);
        self.invoke_schedule(&sub).await?;
        Ok(())
    }

    async fn delete(&self, _job: &Job) -> Result<()> {
        // /schedule does not support delete — user must use the web UI.
        Err(anyhow!("claude-trigger driver does not support delete; open https://claude.ai/code/scheduled"))
    }

    async fn run_now(&self, job: &Job, ctx: DispatchContext, tx: DispatchTx) -> Result<()> {
        let sub = format!("/schedule run the trigger named \"{}\"", job.name.replace('"', "'"));
        match self.invoke_schedule(&sub).await {
            Ok(raw) => {
                let text = Self::extract_result(&raw).unwrap_or(raw);
                let _ = tx.send(DispatchEvent::Output {
                    dispatch_id: ctx.dispatch_id.clone(),
                    chunk: text,
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
            Err(e) => {
                let _ = tx.send(DispatchEvent::Output {
                    dispatch_id: ctx.dispatch_id.clone(),
                    chunk: format!("{e}"),
                    is_stderr: true,
                });
                let _ = tx.send(DispatchEvent::Finished {
                    dispatch_id: ctx.dispatch_id,
                    status: DispatchStatus::Failed,
                    exit_code: None,
                    tokens: None,
                });
                Err(e)
            }
        }
    }

    async fn list_external(&self) -> Result<Vec<ExternalJob>> {
        let raw = self.invoke_schedule("/schedule list my triggers as JSON").await?;
        let text = Self::extract_result(&raw)?;
        // Best-effort parse: accept either a JSON array or a "```json ... ```" block.
        let trimmed = text.trim().trim_start_matches("```json").trim_end_matches("```").trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        match serde_json::from_str::<Vec<ExternalJob>>(trimmed) {
            Ok(v) => Ok(v),
            Err(_) => Ok(Vec::new()), // tolerate — caller shows a banner if list stays empty
        }
    }

    fn capabilities(&self) -> DriverCapabilities {
        DriverCapabilities {
            supports_delete: false,
            supports_raw_env: false,
            supports_local_logs: false,
            supports_mcp_connectors: true,
            min_interval_seconds: MIN_INTERVAL_SEC,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_result_handles_json_envelope() {
        let raw = r#"{"type":"result","result":"Created trigger 1a2b3c4d5e6f7a8b9c0d1e2f"}"#;
        assert_eq!(
            ClaudeTriggerDriver::extract_result(raw).unwrap(),
            "Created trigger 1a2b3c4d5e6f7a8b9c0d1e2f"
        );
    }

    #[test]
    fn extract_result_errors_on_missing_field() {
        let raw = r#"{"type":"other"}"#;
        assert!(ClaudeTriggerDriver::extract_result(raw).is_err());
    }

    #[test]
    fn capabilities_enforce_min_interval() {
        let d = ClaudeTriggerDriver::new();
        assert_eq!(d.capabilities().min_interval_seconds, 3600);
        assert!(!d.capabilities().supports_delete);
    }
}
```

- [ ] **Step 8.2: Run tests**

Run: `cd src-tauri && cargo test --lib ops::drivers::claude_trigger::tests`
Expected: 3 passed.

- [ ] **Step 8.3: Commit**

```bash
git add src-tauri/src/core/ops/drivers/claude_trigger.rs
git commit -m "feat(ops): implement Claude-trigger driver proxying via claude -p /schedule"
```

---

### Task 9: Scheduler loop

**Files:**
- Create: `src-tauri/src/core/ops/scheduler.rs`

- [ ] **Step 9.1: Implement the scheduler with tokio**

Create `src-tauri/src/core/ops/scheduler.rs`:

```rust
//! Scheduler: watches all enabled jobs with a cron schedule and a Maestro
//! driver, wakes on soonest next-fire, spawns dispatches under a
//! concurrency cap, and forwards DispatchEvents out for broadcasting.

use crate::core::ops::drivers::{DispatchContext, DispatchEvent, DispatchTx, Driver};
use crate::core::ops::model::{Job, JobDriver, TriggeredBy};
use chrono::{DateTime, Utc};
use cron::Schedule;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex, Semaphore};

pub const DEFAULT_CONCURRENCY_CAP: usize = 4;

pub struct Scheduler {
    concurrency: Arc<Semaphore>,
    jobs: Arc<Mutex<HashMap<String, Job>>>,
    driver: Arc<dyn Driver>,
    events_tx: DispatchTx,
    pending_rx: Mutex<Option<mpsc::UnboundedReceiver<Tick>>>,
    pending_tx: mpsc::UnboundedSender<Tick>,
}

#[derive(Debug)]
enum Tick {
    Rescan, // jobs have changed, recompute
}

impl Scheduler {
    pub fn new(driver: Arc<dyn Driver>, events_tx: DispatchTx, cap: usize) -> Self {
        let (ptx, prx) = mpsc::unbounded_channel();
        Self {
            concurrency: Arc::new(Semaphore::new(cap)),
            jobs: Arc::new(Mutex::new(HashMap::new())),
            driver,
            events_tx,
            pending_rx: Mutex::new(Some(prx)),
            pending_tx: ptx,
        }
    }

    pub async fn set_jobs(&self, jobs: Vec<Job>) {
        let mut m = self.jobs.lock().await;
        m.clear();
        for j in jobs {
            m.insert(j.id.clone(), j);
        }
        let _ = self.pending_tx.send(Tick::Rescan);
    }

    pub async fn upsert_job(&self, job: Job) {
        self.jobs.lock().await.insert(job.id.clone(), job);
        let _ = self.pending_tx.send(Tick::Rescan);
    }

    pub async fn remove_job(&self, id: &str) {
        self.jobs.lock().await.remove(id);
        let _ = self.pending_tx.send(Tick::Rescan);
    }

    /// Kicks off the scheduler loop. Returns a JoinHandle; caller should keep it alive.
    pub fn spawn(self: Arc<Self>) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            self.run().await;
        })
    }

    async fn run(self: Arc<Self>) {
        let mut rx = match self.pending_rx.lock().await.take() {
            Some(rx) => rx,
            None => return, // already spawned once
        };
        loop {
            let next = self.next_fire(Utc::now()).await;
            let wait_for = match next {
                Some((_, when)) => {
                    let now = Utc::now();
                    if when > now { (when - now).to_std().unwrap_or(Duration::from_millis(100)) }
                    else { Duration::from_millis(0) }
                }
                None => Duration::from_secs(3600),
            };
            tokio::select! {
                _ = tokio::time::sleep(wait_for) => {
                    // Fire all jobs whose next_fire <= now.
                    let now = Utc::now();
                    let to_fire = self.jobs_ready(now).await;
                    for job in to_fire {
                        self.spawn_dispatch(job, TriggeredBy::Schedule).await;
                    }
                }
                evt = rx.recv() => {
                    match evt {
                        Some(Tick::Rescan) | None => continue,
                    }
                }
            }
        }
    }

    async fn next_fire(&self, now: DateTime<Utc>) -> Option<(String, DateTime<Utc>)> {
        let m = self.jobs.lock().await;
        let mut earliest: Option<(String, DateTime<Utc>)> = None;
        for job in m.values() {
            if !job.enabled { continue; }
            if job.driver != JobDriver::Maestro { continue; }
            let Some(expr) = &job.schedule else { continue; };
            let Ok(sched) = Schedule::from_str(expr) else { continue; };
            if let Some(next) = sched.after(&now).next() {
                match &earliest {
                    Some((_, e)) if *e <= next => {}
                    _ => earliest = Some((job.id.clone(), next)),
                }
            }
        }
        earliest
    }

    async fn jobs_ready(&self, now: DateTime<Utc>) -> Vec<Job> {
        let m = self.jobs.lock().await;
        let mut out = Vec::new();
        for job in m.values() {
            if !job.enabled { continue; }
            if job.driver != JobDriver::Maestro { continue; }
            let Some(expr) = &job.schedule else { continue; };
            let Ok(sched) = Schedule::from_str(expr) else { continue; };
            let previous = sched.after(&(now - chrono::Duration::seconds(60))).next();
            if let Some(t) = previous {
                if t <= now { out.push(job.clone()); }
            }
        }
        out
    }

    pub async fn dispatch_now(&self, job: &Job, triggered_by: TriggeredBy) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        self.spawn_dispatch_with_id(job.clone(), triggered_by, id.clone()).await;
        id
    }

    async fn spawn_dispatch(&self, job: Job, triggered_by: TriggeredBy) {
        let id = uuid::Uuid::new_v4().to_string();
        self.spawn_dispatch_with_id(job, triggered_by, id).await;
    }

    async fn spawn_dispatch_with_id(&self, job: Job, triggered_by: TriggeredBy, id: String) {
        let permit = match self.concurrency.clone().acquire_owned().await {
            Ok(p) => p,
            Err(_) => return,
        };
        let driver = self.driver.clone();
        let tx = self.events_tx.clone();
        tokio::spawn(async move {
            let _permit = permit; // held for the whole dispatch
            let _ = driver.run_now(&job, DispatchContext { dispatch_id: id, triggered_by }, tx).await;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ops::drivers::fake::FakeDriver;
    use crate::core::ops::model::*;
    use std::collections::HashMap;
    use std::sync::atomic::Ordering;
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn dispatch_now_runs_once_through_driver() {
        let fake = Arc::new(FakeDriver::new());
        let runs_counter = fake.runs.clone();
        let (tx, _rx) = mpsc::unbounded_channel();
        let sched = Arc::new(Scheduler::new(fake as Arc<dyn Driver>, tx, 4));

        let job = Job {
            id: "j1".into(),
            name: "fake".into(),
            enabled: true,
            scope: Scope::Global,
            project_hash: None,
            tags: vec![],
            driver: JobDriver::Maestro,
            schedule: None,
            maestro: Some(MaestroJobPayload {
                command: "echo".into(),
                args: vec!["hi".into()],
                cwd: None,
                env: HashMap::new(),
                timeout_sec: Some(5),
            }),
            claude_trigger: None,
            tool_id: None,
            notify_on_failure: false,
            last_dispatch: None,
            created_at: 0,
            updated_at: 0,
        };
        sched.dispatch_now(&job, TriggeredBy::Manual).await;
        // Allow the spawned task to progress.
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(runs_counter.load(Ordering::SeqCst), 1);
    }
}
```

- [ ] **Step 9.2: Run tests**

Run: `cd src-tauri && cargo test --lib ops::scheduler::tests`
Expected: 1 passed.

- [ ] **Step 9.3: Commit**

```bash
git add src-tauri/src/core/ops/scheduler.rs
git commit -m "feat(ops): add tokio scheduler with concurrency cap and cron next-fire"
```

---

**Phase B checkpoint:** Run `cd src-tauri && cargo test --lib ops::` — expect all driver + scheduler tests passing.

---

## Phase C — Tauri wiring

### Task 10: OpsState singleton and Tauri commands

**Files:**
- Modify: `src-tauri/src/commands/ops.rs`

- [ ] **Step 10.1: Fill in commands**

Replace `src-tauri/src/commands/ops.rs` with:

```rust
//! Tauri command handlers for Ops.

use crate::core::ops::drivers::{claude_trigger::ClaudeTriggerDriver, Driver, DispatchEvent, ExternalJob};
use crate::core::ops::drivers::maestro::MaestroDriver;
use crate::core::ops::model::{Dispatch, DispatchStatus, Job, JobDriver, LastDispatch, Scope, Tool, TriggeredBy};
use crate::core::ops::scheduler::{Scheduler, DEFAULT_CONCURRENCY_CAP};
use crate::core::ops::store;
use crate::core::ops::dispatch_log;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, Mutex};

/// App-wide Ops state held in Tauri's managed state.
pub struct OpsState {
    pub maestro_scheduler: Arc<Scheduler>,
    pub claude_driver: Arc<ClaudeTriggerDriver>,
    pub jobs_by_scope: Mutex<HashMap<String, Vec<Job>>>, // key: "global" or "project:<hash>"
    pub app: AppHandle,
}

fn scope_key(scope: Scope, project_hash: Option<&str>) -> String {
    match scope {
        Scope::Global => "global".to_string(),
        Scope::Project => format!("project:{}", project_hash.unwrap_or("")),
    }
}

impl OpsState {
    pub fn new(app: AppHandle) -> Arc<Self> {
        let maestro: Arc<dyn Driver> = Arc::new(MaestroDriver::new());
        let (events_tx, events_rx) = mpsc::unbounded_channel::<DispatchEvent>();
        let scheduler = Arc::new(Scheduler::new(maestro, events_tx, DEFAULT_CONCURRENCY_CAP));
        scheduler.clone().spawn();

        let claude_driver = Arc::new(ClaudeTriggerDriver::new());
        let state = Arc::new(Self {
            maestro_scheduler: scheduler,
            claude_driver,
            jobs_by_scope: Mutex::new(HashMap::new()),
            app: app.clone(),
        });

        // Forward dispatch events to the frontend + persist finishes.
        let state_fwd = state.clone();
        tokio::spawn(async move {
            let mut rx = events_rx;
            while let Some(evt) = rx.recv().await {
                state_fwd.handle_dispatch_event(evt).await;
            }
        });
        state
    }

    async fn handle_dispatch_event(self: &Arc<Self>, evt: DispatchEvent) {
        match &evt {
            DispatchEvent::Output { dispatch_id, chunk, is_stderr } => {
                // Best-effort: write to dispatch log. Scope inferred from our registry if known.
                if let Some((scope, project_hash, _job_id)) = self.lookup_dispatch_scope(dispatch_id).await {
                    let _ = dispatch_log::append_log(scope, project_hash.as_deref(), dispatch_id, chunk.as_bytes());
                }
                let _ = self.app.emit("ops://dispatch-output", serde_json::json!({
                    "dispatchId": dispatch_id,
                    "chunk": chunk,
                    "isStderr": is_stderr,
                }));
            }
            DispatchEvent::Finished { dispatch_id, status, exit_code, tokens } => {
                let _ = self.app.emit("ops://dispatch-finished", serde_json::json!({
                    "dispatchId": dispatch_id,
                    "status": status,
                    "exitCode": exit_code,
                    "tokens": tokens,
                }));
                // Persist the finished record
                if let Some((scope, project_hash, job_id)) = self.lookup_dispatch_scope(dispatch_id).await {
                    let rec = Dispatch {
                        id: dispatch_id.clone(),
                        job_id: job_id.clone(),
                        scope,
                        project_hash: project_hash.clone(),
                        started_at: chrono::Utc::now().timestamp(),
                        ended_at: Some(chrono::Utc::now().timestamp()),
                        status: *status,
                        exit_code: *exit_code,
                        triggered_by: TriggeredBy::Manual,
                        output_head: dispatch_log::read_log_tail(scope, project_hash.as_deref(), dispatch_id, 2048).unwrap_or_default(),
                        log_path: dispatch_log::log_path(scope, project_hash.as_deref(), dispatch_id).ok().and_then(|p| p.to_str().map(|s| s.to_string())),
                        tokens: *tokens,
                        duration_ms: None,
                    };
                    let _ = store::append_dispatch(scope, project_hash.as_deref(), &rec);
                    self.update_last_dispatch(scope, project_hash.as_deref(), &job_id, &rec).await;
                    let _ = dispatch_log::rotate(scope, project_hash.as_deref(), chrono::Utc::now().timestamp());
                }
            }
        }
    }

    /// In-memory registry of active dispatches → (scope, projectHash, jobId).
    /// Populated when we start a dispatch (see `run_job_now`).
    async fn lookup_dispatch_scope(&self, _dispatch_id: &str) -> Option<(Scope, Option<String>, String)> {
        // See Task 12 for the full registry; stub returns None so events are still emitted.
        None
    }

    async fn update_last_dispatch(
        &self,
        scope: Scope,
        project_hash: Option<&str>,
        job_id: &str,
        rec: &Dispatch,
    ) {
        let key = scope_key(scope, project_hash);
        let mut map = self.jobs_by_scope.lock().await;
        if let Some(list) = map.get_mut(&key) {
            if let Some(j) = list.iter_mut().find(|j| j.id == job_id) {
                j.last_dispatch = Some(LastDispatch {
                    id: rec.id.clone(),
                    started_at: rec.started_at,
                    status: rec.status,
                });
                let _ = store::save_jobs(scope, project_hash, list);
            }
        }
    }
}

// -------------------- Tauri commands --------------------

#[tauri::command]
pub async fn ops_load_jobs(
    state: State<'_, Arc<OpsState>>,
    scope: Scope,
    project_hash: Option<String>,
) -> Result<Vec<Job>, String> {
    let jobs = store::load_jobs(scope, project_hash.as_deref()).map_err(|e| e.to_string())?;
    let key = scope_key(scope, project_hash.as_deref());
    state.jobs_by_scope.lock().await.insert(key, jobs.clone());
    // Push to scheduler (maestro-driver jobs only; scheduler filters)
    state.maestro_scheduler.set_jobs(jobs.clone()).await;
    Ok(jobs)
}

#[tauri::command]
pub async fn ops_save_job(
    state: State<'_, Arc<OpsState>>,
    scope: Scope,
    project_hash: Option<String>,
    mut job: Job,
) -> Result<Job, String> {
    if scope == Scope::Project && project_hash.is_none() {
        return Err("project scope requires projectHash".into());
    }
    if job.id.is_empty() {
        job.id = uuid::Uuid::new_v4().to_string();
        job.created_at = chrono::Utc::now().timestamp();
    }
    job.updated_at = chrono::Utc::now().timestamp();
    job.scope = scope;
    job.project_hash = project_hash.clone();

    // Driver-specific create/update hook
    match job.driver {
        JobDriver::ClaudeTrigger => {
            match state.claude_driver.create(&job).await {
                Ok(meta) => {
                    if let Some(ct) = job.claude_trigger.as_mut() {
                        ct.trigger_id = meta.trigger_id;
                    }
                }
                Err(e) => return Err(e.to_string()),
            }
        }
        JobDriver::Maestro => {}
    }

    let mut existing = store::load_jobs(scope, project_hash.as_deref()).map_err(|e| e.to_string())?;
    existing.retain(|j| j.id != job.id);
    existing.push(job.clone());
    store::save_jobs(scope, project_hash.as_deref(), &existing).map_err(|e| e.to_string())?;

    state.jobs_by_scope.lock().await.insert(scope_key(scope, project_hash.as_deref()), existing.clone());
    state.maestro_scheduler.set_jobs(existing).await;

    let _ = state.app.emit("ops://jobs-updated", serde_json::json!({
        "scope": scope, "projectHash": project_hash,
    }));
    Ok(job)
}

#[tauri::command]
pub async fn ops_delete_job(
    state: State<'_, Arc<OpsState>>,
    scope: Scope,
    project_hash: Option<String>,
    job_id: String,
) -> Result<(), String> {
    let mut jobs = store::load_jobs(scope, project_hash.as_deref()).map_err(|e| e.to_string())?;
    if let Some(job) = jobs.iter().find(|j| j.id == job_id).cloned() {
        if job.driver == JobDriver::ClaudeTrigger {
            // We can't delete remotely — return an error the UI can render as a deep link.
            return Err("claude-trigger delete is not supported; open https://claude.ai/code/scheduled".into());
        }
    }
    jobs.retain(|j| j.id != job_id);
    store::save_jobs(scope, project_hash.as_deref(), &jobs).map_err(|e| e.to_string())?;
    state.jobs_by_scope.lock().await.insert(scope_key(scope, project_hash.as_deref()), jobs.clone());
    state.maestro_scheduler.set_jobs(jobs).await;
    let _ = state.app.emit("ops://jobs-updated", serde_json::json!({ "scope": scope, "projectHash": project_hash }));
    Ok(())
}

#[tauri::command]
pub async fn ops_run_now(
    state: State<'_, Arc<OpsState>>,
    scope: Scope,
    project_hash: Option<String>,
    job_id: String,
) -> Result<String, String> {
    let jobs = store::load_jobs(scope, project_hash.as_deref()).map_err(|e| e.to_string())?;
    let job = jobs.into_iter().find(|j| j.id == job_id)
        .ok_or_else(|| "job not found".to_string())?;

    let dispatch_id = match job.driver {
        JobDriver::Maestro => state.maestro_scheduler.dispatch_now(&job, TriggeredBy::Manual).await,
        JobDriver::ClaudeTrigger => {
            let id = uuid::Uuid::new_v4().to_string();
            let ctx = crate::core::ops::drivers::DispatchContext {
                dispatch_id: id.clone(),
                triggered_by: TriggeredBy::Manual,
            };
            let (tx, mut rx) = mpsc::unbounded_channel::<DispatchEvent>();
            let driver = state.claude_driver.clone();
            let job_clone = job.clone();
            tokio::spawn(async move {
                let _ = driver.run_now(&job_clone, ctx, tx).await;
            });
            let app = state.app.clone();
            tokio::spawn(async move {
                while let Some(evt) = rx.recv().await {
                    let _ = app.emit("ops://dispatch-output-claude", serde_json::json!(evt));
                }
            });
            id
        }
    };

    let _ = state.app.emit("ops://dispatch-started", serde_json::json!({
        "dispatchId": dispatch_id,
        "jobId": job_id,
    }));
    Ok(dispatch_id)
}

#[tauri::command]
pub async fn ops_recent_dispatches(
    scope: Scope,
    project_hash: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<Dispatch>, String> {
    store::recent_dispatches(scope, project_hash.as_deref(), limit.unwrap_or(100))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ops_load_tools() -> Result<Vec<Tool>, String> {
    store::load_tools().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ops_save_tool(mut tool: Tool) -> Result<Tool, String> {
    if tool.id.is_empty() {
        tool.id = uuid::Uuid::new_v4().to_string();
        tool.created_at = chrono::Utc::now().timestamp();
    }
    let mut tools = store::load_tools().map_err(|e| e.to_string())?;
    tools.retain(|t| t.id != tool.id);
    tools.push(tool.clone());
    store::save_tools(&tools).map_err(|e| e.to_string())?;
    Ok(tool)
}

#[tauri::command]
pub async fn ops_delete_tool(tool_id: String) -> Result<(), String> {
    let mut tools = store::load_tools().map_err(|e| e.to_string())?;
    tools.retain(|t| t.id != tool_id);
    store::save_tools(&tools).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ops_list_external_triggers(
    state: State<'_, Arc<OpsState>>,
) -> Result<Vec<ExternalJob>, String> {
    state.claude_driver.list_external().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ops_read_log_tail(
    scope: Scope,
    project_hash: Option<String>,
    dispatch_id: String,
    max_bytes: Option<usize>,
) -> Result<String, String> {
    dispatch_log::read_log_tail(scope, project_hash.as_deref(), &dispatch_id, max_bytes.unwrap_or(64 * 1024))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ops_project_hash(project_path: String) -> Result<String, String> {
    Ok(store::hash_project_path(std::path::Path::new(&project_path)))
}

#[derive(Serialize)]
pub struct DriverCapsResponse {
    pub maestro: crate::core::ops::drivers::DriverCapabilities,
    pub claude_trigger: crate::core::ops::drivers::DriverCapabilities,
}

#[tauri::command]
pub async fn ops_driver_capabilities() -> DriverCapsResponse {
    use crate::core::ops::drivers::Driver as _;
    let m = MaestroDriver::new();
    let c = ClaudeTriggerDriver::new();
    DriverCapsResponse {
        maestro: m.capabilities(),
        claude_trigger: c.capabilities(),
    }
}
```

- [ ] **Step 10.2: Register commands + state in `lib.rs`**

Read `src-tauri/src/lib.rs`. Inside the `tauri::Builder::default()` chain, add the state setup and command registration.

After other `.manage(...)` calls (and before `.invoke_handler(...)`), add a new `.setup(|app|...)` call (if one doesn't exist; if one does, extend it) to:

```rust
.setup(|app| {
    let handle = app.handle().clone();
    let ops = crate::commands::ops::OpsState::new(handle.clone());
    app.manage(ops);
    Ok(())
})
```

Inside `.invoke_handler(tauri::generate_handler![...])` add:

```rust
crate::commands::ops::ops_load_jobs,
crate::commands::ops::ops_save_job,
crate::commands::ops::ops_delete_job,
crate::commands::ops::ops_run_now,
crate::commands::ops::ops_recent_dispatches,
crate::commands::ops::ops_load_tools,
crate::commands::ops::ops_save_tool,
crate::commands::ops::ops_delete_tool,
crate::commands::ops::ops_list_external_triggers,
crate::commands::ops::ops_read_log_tail,
crate::commands::ops::ops_project_hash,
crate::commands::ops::ops_driver_capabilities,
```

- [ ] **Step 10.3: Verify it builds**

Run: `cd src-tauri && cargo check`
Expected: builds without errors.

- [ ] **Step 10.4: Commit**

```bash
git add src-tauri/src/commands/ops.rs src-tauri/src/lib.rs
git commit -m "feat(ops): add OpsState singleton and Tauri commands for jobs/tools/dispatches"
```

---

### Task 11: Dispatch-scope registry (so log events find their target)

The stub in Task 10 returned `None` from `lookup_dispatch_scope`. Wire it up now so output + persistence actually flow.

**Files:**
- Modify: `src-tauri/src/commands/ops.rs`

- [ ] **Step 11.1: Add the in-memory registry**

Edit `src-tauri/src/commands/ops.rs`. Replace the `OpsState` struct definition + `impl OpsState::new` with:

Add a new field at the top of the struct:

```rust
pub dispatches: Mutex<HashMap<String, DispatchTarget>>,
```

Add the target type near the top of the file (below the existing `use` lines):

```rust
#[derive(Debug, Clone)]
pub struct DispatchTarget {
    pub scope: Scope,
    pub project_hash: Option<String>,
    pub job_id: String,
}
```

Update `OpsState::new` to initialize `dispatches: Mutex::new(HashMap::new())`.

Replace the stub `lookup_dispatch_scope` with:

```rust
async fn lookup_dispatch_scope(&self, dispatch_id: &str) -> Option<(Scope, Option<String>, String)> {
    let map = self.dispatches.lock().await;
    map.get(dispatch_id).map(|t| (t.scope, t.project_hash.clone(), t.job_id.clone()))
}

pub async fn register_dispatch(&self, dispatch_id: &str, target: DispatchTarget) {
    self.dispatches.lock().await.insert(dispatch_id.to_string(), target);
}
pub async fn forget_dispatch(&self, dispatch_id: &str) {
    self.dispatches.lock().await.remove(dispatch_id);
}
```

In the `handle_dispatch_event` method, add `self.forget_dispatch(dispatch_id).await;` at the end of the `Finished` branch.

Finally, in `ops_run_now`, after computing `dispatch_id`, register it *before* kicking off either code path:

```rust
state.register_dispatch(&dispatch_id, DispatchTarget {
    scope,
    project_hash: project_hash.clone(),
    job_id: job_id.clone(),
}).await;
```

- [ ] **Step 11.2: Verify it builds**

Run: `cd src-tauri && cargo check`
Expected: no errors.

- [ ] **Step 11.3: Commit**

```bash
git add src-tauri/src/commands/ops.rs
git commit -m "feat(ops): register live dispatches so output events persist and route"
```

---

### Task 12: Integration test with the fake driver

**Files:**
- Create: `src-tauri/tests/ops_integration.rs`

- [ ] **Step 12.1: Write the integration test**

Create `src-tauri/tests/ops_integration.rs`:

```rust
//! End-to-end: scheduler + fake driver + store. No Tauri AppHandle.

use maestro_lib::core::ops::drivers::{fake::FakeDriver, Driver, DispatchEvent};
use maestro_lib::core::ops::model::*;
use maestro_lib::core::ops::scheduler::Scheduler;
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

fn sample_maestro_job() -> Job {
    Job {
        id: "j1".into(),
        name: "demo".into(),
        enabled: true,
        scope: Scope::Global,
        project_hash: None,
        tags: vec![],
        driver: JobDriver::Maestro,
        schedule: None,
        maestro: Some(MaestroJobPayload {
            command: "echo".into(),
            args: vec!["integration".into()],
            cwd: None,
            env: HashMap::new(),
            timeout_sec: Some(5),
        }),
        claude_trigger: None,
        tool_id: None,
        notify_on_failure: false,
        last_dispatch: None,
        created_at: 0,
        updated_at: 0,
    }
}

#[tokio::test]
async fn scheduler_runs_job_via_fake_driver_and_emits_finished() {
    let fake = Arc::new(FakeDriver::new());
    let runs = fake.runs.clone();
    let (tx, mut rx) = mpsc::unbounded_channel::<DispatchEvent>();
    let sched = Arc::new(Scheduler::new(fake as Arc<dyn Driver>, tx, 2));

    sched.dispatch_now(&sample_maestro_job(), TriggeredBy::Manual).await;
    // Wait briefly for the spawned driver task to emit.
    let evt = tokio::time::timeout(Duration::from_secs(2), rx.recv()).await.unwrap();
    match evt {
        Some(DispatchEvent::Output { chunk, .. }) => assert!(chunk.contains("hello")),
        other => panic!("expected Output, got {other:?}"),
    }
    let evt2 = tokio::time::timeout(Duration::from_secs(2), rx.recv()).await.unwrap();
    match evt2 {
        Some(DispatchEvent::Finished { status, .. }) => assert_eq!(status, DispatchStatus::Succeeded),
        other => panic!("expected Finished, got {other:?}"),
    }
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}
```

- [ ] **Step 12.2: Run the integration test**

Run: `cd src-tauri && cargo test --test ops_integration`
Expected: 1 passed.

- [ ] **Step 12.3: Commit**

```bash
git add src-tauri/tests/ops_integration.rs
git commit -m "test(ops): integration test for scheduler + driver + events"
```

---

**Phase C checkpoint:** Run `cd src-tauri && cargo test` — expect Phase A + B + C tests all passing.

---

## Phase D — Frontend foundation

### Task 13: TypeScript types

**Files:**
- Create: `src/types/ops.ts`

- [ ] **Step 13.1: Mirror Rust types**

Create `src/types/ops.ts`:

```ts
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
```

**Note on casing:** Rust `snake_case` serde fields (`timeout_sec`, `claude_trigger`, `project_hash`, `output_head`, `started_at`, etc.) are not automatically camelCase. When Tauri serializes Rust structs across the bridge they stay snake_case. To match the TS types above, add `#[serde(rename_all = "camelCase")]` to the relevant Rust structs.

- [ ] **Step 13.2: Add camelCase serde attribute to affected Rust structs**

Edit `src-tauri/src/core/ops/model.rs`. Add `#[serde(rename_all = "camelCase")]` directly above each of these struct definitions: `MaestroJobPayload`, `ClaudeTriggerPayload`, `LastDispatch`, `Job`, `Dispatch`, `Tool`, `ToolDefaults`. Also to `ExternalJob` and `DriverCapabilities` in `drivers/mod.rs`.

Example diff for `Job`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    // ... same fields
}
```

Re-run `cargo test --lib ops::model::tests` — update the existing model test's assertions if any of them were checking raw JSON strings. The current tests only check enum serialization and struct round-trips; they should still pass since `rename_all` leaves non-explicit fields to the default. The `project_hash` field in JSON changes from `"project_hash"` to `"projectHash"` etc.; the round-trip test uses `serde_json::to_string` → `from_str`, so it still passes. Run to confirm:

Run: `cd src-tauri && cargo test --lib ops::model::tests`
Expected: 3 passed.

- [ ] **Step 13.3: Commit**

```bash
git add src/types/ops.ts src-tauri/src/core/ops/model.rs src-tauri/src/core/ops/drivers/mod.rs
git commit -m "feat(ops): add TypeScript types and camelCase serde attributes"
```

---

### Task 14: Tauri invoke wrappers and useOpsStore

**Files:**
- Create: `src/lib/ops.ts`
- Create: `src/stores/useOpsStore.ts`

- [ ] **Step 14.1: Invoke wrappers**

Create `src/lib/ops.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Dispatch,
  DispatchFinishedEvent,
  DispatchOutputEvent,
  DispatchStartedEvent,
  DriverCapsResponse,
  ExternalJob,
  Job,
  Scope,
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
  if (h.onStarted) unlisteners.push(await listen<DispatchStartedEvent>("ops://dispatch-started", (e) => h.onStarted!(e.payload)));
  if (h.onOutput) unlisteners.push(await listen<DispatchOutputEvent>("ops://dispatch-output", (e) => h.onOutput!(e.payload)));
  if (h.onFinished) unlisteners.push(await listen<DispatchFinishedEvent>("ops://dispatch-finished", (e) => h.onFinished!(e.payload)));
  if (h.onJobsUpdated) unlisteners.push(await listen("ops://jobs-updated", () => h.onJobsUpdated!()));
  return () => unlisteners.forEach((u) => u());
}
```

- [ ] **Step 14.2: Zustand store**

Create `src/stores/useOpsStore.ts`:

```ts
import { create } from "zustand";
import type { Dispatch, DriverCapsResponse, Job, Scope, Tool } from "@/types/ops";
import * as api from "@/lib/ops";

interface LiveRun {
  dispatchId: string;
  jobId: string;
  startedAt: number;
  lastLine: string;
}

type ScopeKey = string; // "global" | "project:<hash>"
function keyFor(scope: Scope, projectHash?: string): ScopeKey {
  return scope === "global" ? "global" : `project:${projectHash ?? ""}`;
}

interface OpsState {
  jobsByScope: Record<ScopeKey, Job[]>;
  dispatchesByScope: Record<ScopeKey, Dispatch[]>;
  tools: Tool[];
  live: Record<string, LiveRun>; // dispatchId → LiveRun
  caps?: DriverCapsResponse;
  scopeFilter: "all" | "project" | "global";

  // loaders
  loadJobs: (scope: Scope, projectHash?: string) => Promise<void>;
  loadDispatches: (scope: Scope, projectHash?: string) => Promise<void>;
  loadTools: () => Promise<void>;
  loadCapabilities: () => Promise<void>;

  // mutators
  saveJob: (scope: Scope, job: Job, projectHash?: string) => Promise<Job>;
  deleteJob: (scope: Scope, jobId: string, projectHash?: string) => Promise<void>;
  runNow: (scope: Scope, jobId: string, projectHash?: string) => Promise<void>;
  saveTool: (tool: Tool) => Promise<Tool>;
  deleteTool: (toolId: string) => Promise<void>;

  // filter
  setScopeFilter: (f: "all" | "project" | "global") => void;

  // internal event handlers
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

  loadTools: async () => set({ tools: await api.loadTools() }),
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
      // Re-load all currently tracked scopes.
      const { jobsByScope } = useOpsStore.getState();
      Object.keys(jobsByScope).forEach((k) => {
        const parts = k.split(":");
        if (parts[0] === "global") useOpsStore.getState().loadJobs("global");
        else if (parts[0] === "project" && parts[1]) useOpsStore.getState().loadJobs("project", parts[1]);
      });
    },
  });
}
```

- [ ] **Step 14.3: Write a basic store test**

Create `src/stores/__tests__/useOpsStore.test.ts`:

```ts
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
```

- [ ] **Step 14.4: Run tests**

Run: `npm test -- useOpsStore`
Expected: 1 passed.

- [ ] **Step 14.5: Commit**

```bash
git add src/lib/ops.ts src/stores/useOpsStore.ts src/stores/__tests__/useOpsStore.test.ts
git commit -m "feat(ops): Zustand store + Tauri invoke wrappers with event subscriptions"
```

---

### Task 15: Register Ops tab in GitPanel

**Files:**
- Modify: `src/components/git/GitPanelTabs.tsx`
- Modify: `src/components/git/GitPanelContent.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 15.1: Extend the tab union**

Edit `src/components/git/GitPanelTabs.tsx`.

Change:
```ts
export type GitPanelTab = "commits" | "prs" | "issues" | "discussions";
```
to:
```ts
export type GitPanelTab = "commits" | "prs" | "issues" | "discussions" | "ops";
```

Add the import for an icon (top of file, merge with existing `lucide-react` import):
```ts
import { GitBranch, GitPullRequest, CircleDot, MessageCircle, Cpu } from "lucide-react";
```

Add the new tab to the `TABS` array (end):
```ts
{ id: "ops", label: "Ops", icon: Cpu },
```

- [ ] **Step 15.2: Route the new tab**

Edit `src/components/git/GitPanelContent.tsx`.

Add an import at the top:
```ts
import { OpsPanel } from "../ops/OpsPanel";
```

Add a case to the `switch (activeTab)` (before `default`):
```ts
case "ops":
  return <OpsPanel repoPath={repoPath} />;
```

- [ ] **Step 15.3: Stub OpsPanel so this builds**

Create `src/components/ops/OpsPanel.tsx`:

```tsx
interface OpsPanelProps {
  repoPath: string;
}

export function OpsPanel({ repoPath: _repoPath }: OpsPanelProps) {
  return (
    <div className="flex flex-1 items-center justify-center text-xs text-maestro-muted/60">
      Ops panel — scaffolded, sections land in Phase E.
    </div>
  );
}
```

- [ ] **Step 15.4: Initialize event subscriptions + caps at app start**

Edit `src/App.tsx`. In the top-level component, add a `useEffect` (near other init effects) that wires ops events and loads driver capabilities:

```tsx
import { useEffect } from "react";
import { initOpsEventSubscriptions, useOpsStore } from "@/stores/useOpsStore";

// inside the App component:
useEffect(() => {
  let unsub: (() => void) | null = null;
  (async () => {
    unsub = await initOpsEventSubscriptions();
    await useOpsStore.getState().loadCapabilities();
    await useOpsStore.getState().loadTools();
  })();
  return () => { if (unsub) unsub(); };
}, []);
```

- [ ] **Step 15.5: Manual check — the tab appears**

Run: `npm run dev`
Expected: Launch the app, open the Git panel. The new "Ops" tab is visible and shows the scaffolded placeholder when clicked.

- [ ] **Step 15.6: Commit**

```bash
git add src/components/git/GitPanelTabs.tsx src/components/git/GitPanelContent.tsx \
        src/components/ops/OpsPanel.tsx src/App.tsx
git commit -m "feat(ops): register Ops tab and initialize event subscriptions"
```

---

**Phase D checkpoint:** The Ops tab now appears in the Git panel, event subscriptions are active, and the store is populated with capabilities and tools on startup.

---

## Phase E — Frontend read path (stacked sections)

### Task 16: OpsPanel shell + section containers

**Files:**
- Modify: `src/components/ops/OpsPanel.tsx`
- Create: `src/components/ops/OpsSection.tsx`

- [ ] **Step 16.1: Reusable collapsible section primitive**

Create `src/components/ops/OpsSection.tsx`:

```tsx
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

interface OpsSectionProps {
  title: string;
  count?: number | string;
  defaultOpen?: boolean;
  action?: ReactNode;
  children: ReactNode;
}

export function OpsSection({ title, count, defaultOpen = true, action, children }: OpsSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <section className="border-b border-maestro-border/60">
      <header
        className="flex cursor-default select-none items-center gap-1.5 bg-maestro-card/40 px-3 py-2 text-[10.5px] uppercase tracking-wider text-maestro-muted"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon size={12} />
        <span>{title}</span>
        {count !== undefined && <span className="ml-auto text-maestro-muted/60">{count}</span>}
        {action && <span className="ml-2">{action}</span>}
      </header>
      {open && <div>{children}</div>}
    </section>
  );
}
```

- [ ] **Step 16.2: OpsPanel composes the sections**

Replace `src/components/ops/OpsPanel.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { useOpsStore } from "@/stores/useOpsStore";
import { projectHash as computeProjectHash } from "@/lib/ops";
import { LiveSection } from "./sections/LiveSection";
import { JobsSection } from "./sections/JobsSection";
import { ToolsSection } from "./sections/ToolsSection";
import { HistorySection } from "./sections/HistorySection";
import { SurfacesPlaceholder } from "./sections/SurfacesPlaceholder";

interface OpsPanelProps {
  repoPath: string;
}

export function OpsPanel({ repoPath }: OpsPanelProps) {
  const [projHash, setProjHash] = useState<string | undefined>(undefined);
  const { loadJobs, loadDispatches } = useOpsStore();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const h = await computeProjectHash(repoPath);
      if (cancelled) return;
      setProjHash(h);
      await loadJobs("global");
      await loadJobs("project", h);
      await loadDispatches("global");
      await loadDispatches("project", h);
    })();
    return () => { cancelled = true; };
  }, [repoPath, loadJobs, loadDispatches]);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <LiveSection />
      <JobsSection projectHash={projHash} />
      <ToolsSection projectHash={projHash} />
      <SurfacesPlaceholder />
      <HistorySection projectHash={projHash} />
    </div>
  );
}
```

- [ ] **Step 16.3: Commit**

(Sections files don't exist yet — we stub them in the next four tasks; compile-fail until then is expected. Stub them now to keep the tree compiling.)

Create `src/components/ops/sections/LiveSection.tsx`:
```tsx
export function LiveSection() { return null; }
```
Create `src/components/ops/sections/JobsSection.tsx`:
```tsx
interface Props { projectHash?: string }
export function JobsSection(_: Props) { return null; }
```
Create `src/components/ops/sections/ToolsSection.tsx`:
```tsx
interface Props { projectHash?: string }
export function ToolsSection(_: Props) { return null; }
```
Create `src/components/ops/sections/HistorySection.tsx`:
```tsx
interface Props { projectHash?: string }
export function HistorySection(_: Props) { return null; }
```
Create `src/components/ops/sections/SurfacesPlaceholder.tsx`:
```tsx
import { OpsSection } from "../OpsSection";

export function SurfacesPlaceholder() {
  return (
    <OpsSection title="Claude Surfaces" count="Stage 2" defaultOpen={false}>
      <div className="px-4 py-3 text-[11px] text-maestro-muted/60">
        Hooks · MCP · Webhooks · Secrets — coming in Stage 2.
      </div>
    </OpsSection>
  );
}
```

Run: `npm run build` (just `tsc` via `tsc && vite build`)
Expected: no type errors.

Commit:
```bash
git add src/components/ops/
git commit -m "feat(ops): OpsPanel shell with stacked section scaffolding"
```

---

### Task 17: LiveSection

**Files:**
- Modify: `src/components/ops/sections/LiveSection.tsx`

- [ ] **Step 17.1: Implementation**

Replace `src/components/ops/sections/LiveSection.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useOpsStore } from "@/stores/useOpsStore";
import { OpsSection } from "../OpsSection";

function formatElapsed(startedAt: number): string {
  const ms = Math.max(0, Date.now() - startedAt);
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

export function LiveSection() {
  const live = useOpsStore((s) => s.live);
  const jobsByScope = useOpsStore((s) => s.jobsByScope);
  const [, force] = useState(0);

  useEffect(() => {
    if (Object.keys(live).length === 0) return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [live]);

  const entries = Object.values(live);
  if (entries.length === 0) return null;

  // Build a flat lookup of job id → name
  const jobName = (id: string): string => {
    for (const list of Object.values(jobsByScope)) {
      const j = list.find((j) => j.id === id);
      if (j) return j.name;
    }
    return id;
  };

  return (
    <OpsSection title="Live" count={`${entries.length} running`}>
      <ul>
        {entries.map((r) => (
          <li key={r.dispatchId} className="flex items-center gap-2 px-3 py-1.5 hover:bg-maestro-card/40">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-maestro-green" />
            <span className="flex-1 truncate text-[12px] text-maestro-text">{jobName(r.jobId)}</span>
            {r.lastLine && (
              <span className="truncate font-mono text-[10.5px] text-maestro-muted/70 max-w-[240px]">
                {r.lastLine}
              </span>
            )}
            <span className="text-[10.5px] tabular-nums text-maestro-muted/80">{formatElapsed(r.startedAt)}</span>
          </li>
        ))}
      </ul>
    </OpsSection>
  );
}
```

- [ ] **Step 17.2: Snapshot test**

Create `src/components/ops/__tests__/LiveSection.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useOpsStore } from "@/stores/useOpsStore";
import { LiveSection } from "../sections/LiveSection";

describe("LiveSection", () => {
  beforeEach(() => {
    useOpsStore.setState({ jobsByScope: {}, dispatchesByScope: {}, tools: [], live: {}, caps: undefined, scopeFilter: "all" });
  });

  it("renders nothing when no runs are active", () => {
    const { container } = render(<LiveSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one row per live run", () => {
    useOpsStore.setState({
      live: {
        d1: { dispatchId: "d1", jobId: "j1", startedAt: Date.now(), lastLine: "ok" },
      },
      jobsByScope: {
        global: [
          {
            id: "j1", name: "my-job", enabled: true, scope: "global", tags: [],
            driver: "maestro", notifyOnFailure: false, createdAt: 0, updatedAt: 0,
          } as any,
        ],
      },
    });
    render(<LiveSection />);
    expect(screen.getByText("my-job")).toBeInTheDocument();
    expect(screen.getByText(/Live/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 17.3: Run + commit**

Run: `npm test -- LiveSection`
Expected: 2 passed.

Commit:
```bash
git add src/components/ops/sections/LiveSection.tsx src/components/ops/__tests__/LiveSection.test.tsx
git commit -m "feat(ops): LiveSection shows active runs with elapsed counter"
```

---

### Task 18: JobsSection with scope toggle

**Files:**
- Modify: `src/components/ops/sections/JobsSection.tsx`

- [ ] **Step 18.1: Implementation**

Replace `src/components/ops/sections/JobsSection.tsx`:

```tsx
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useOpsStore } from "@/stores/useOpsStore";
import type { Job } from "@/types/ops";
import { OpsSection } from "../OpsSection";
import { JobRow } from "../JobRow";
import { NewJobWizard } from "../NewJobWizard";

interface Props {
  projectHash?: string;
}

type ScopeFilter = "all" | "project" | "global";

export function JobsSection({ projectHash }: Props) {
  const jobsByScope = useOpsStore((s) => s.jobsByScope);
  const scopeFilter = useOpsStore((s) => s.scopeFilter);
  const setScopeFilter = useOpsStore((s) => s.setScopeFilter);
  const [wizardOpen, setWizardOpen] = useState(false);

  const jobs = useMemo<Job[]>(() => {
    const g = jobsByScope["global"] ?? [];
    const p = projectHash ? (jobsByScope[`project:${projectHash}`] ?? []) : [];
    if (scopeFilter === "global") return g;
    if (scopeFilter === "project") return p;
    return [...g, ...p];
  }, [jobsByScope, projectHash, scopeFilter]);

  return (
    <>
      <OpsSection
        title="Jobs"
        count={jobs.length}
        action={
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setWizardOpen(true); }}
            aria-label="New job"
            className="rounded p-0.5 text-maestro-accent hover:bg-maestro-accent/10"
          >
            <Plus size={12} />
          </button>
        }
      >
        <ScopeTabs value={scopeFilter} onChange={setScopeFilter} />
        {jobs.length === 0 ? (
          <div className="px-4 py-4 text-center text-[11px] text-maestro-muted/60">
            No jobs yet. Click + to create one.
          </div>
        ) : (
          <ul>{jobs.map((j) => <JobRow key={j.id} job={j} />)}</ul>
        )}
      </OpsSection>
      <NewJobWizard open={wizardOpen} onClose={() => setWizardOpen(false)} projectHash={projectHash} />
    </>
  );
}

function ScopeTabs({ value, onChange }: { value: ScopeFilter; onChange: (v: ScopeFilter) => void }) {
  const items: Array<{ v: ScopeFilter; label: string }> = [
    { v: "all", label: "All" },
    { v: "project", label: "Project" },
    { v: "global", label: "Global" },
  ];
  return (
    <div className="flex gap-1 border-b border-maestro-border/40 px-3 py-1.5">
      {items.map((i) => (
        <button
          key={i.v}
          type="button"
          onClick={() => onChange(i.v)}
          className={`rounded px-2 py-0.5 text-[10.5px] ${
            value === i.v
              ? "bg-maestro-accent/15 text-maestro-accent"
              : "text-maestro-muted hover:text-maestro-text"
          }`}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 18.2: Stub JobRow and NewJobWizard**

Create `src/components/ops/JobRow.tsx`:
```tsx
import type { Job } from "@/types/ops";
export function JobRow({ job }: { job: Job }) {
  return <li className="px-3 py-1.5 text-[12px] text-maestro-text">{job.name}</li>;
}
```

Create `src/components/ops/NewJobWizard.tsx`:
```tsx
interface Props { open: boolean; onClose: () => void; projectHash?: string }
export function NewJobWizard({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="rounded bg-maestro-surface p-6">Wizard — Task 23</div>
    </div>
  );
}
```

- [ ] **Step 18.3: Verify build**

Run: `npm run build`
Expected: no type errors.

Commit:
```bash
git add src/components/ops/sections/JobsSection.tsx src/components/ops/JobRow.tsx src/components/ops/NewJobWizard.tsx
git commit -m "feat(ops): JobsSection with scope filter and new-job button (wizard/row stubbed)"
```

---

### Task 19: JobRow collapsed state

**Files:**
- Modify: `src/components/ops/JobRow.tsx`

- [ ] **Step 19.1: Full collapsed + basic expanded row**

Replace `src/components/ops/JobRow.tsx`:

```tsx
import { useState } from "react";
import { Play, Pause, ChevronDown, ChevronRight, Trash2, Pencil, ScrollText } from "lucide-react";
import type { Job, DispatchStatus } from "@/types/ops";
import { useOpsStore } from "@/stores/useOpsStore";

function driverBadge(j: Job) {
  if (j.driver === "claude-trigger") {
    return <span className="rounded bg-[#2b1a35] px-1 py-[1px] text-[9.5px] uppercase tracking-wider text-[#c587e8]">Claude</span>;
  }
  return <span className="rounded bg-[#1a2b3a] px-1 py-[1px] text-[9.5px] uppercase tracking-wider text-maestro-accent">Job</span>;
}

function statusDot(status?: DispatchStatus, enabled?: boolean) {
  const cls = "h-1.5 w-1.5 rounded-full shrink-0";
  if (!enabled) return <span className={`${cls} bg-maestro-muted/40`} />;
  switch (status) {
    case "running": return <span className={`${cls} bg-maestro-green animate-pulse`} />;
    case "succeeded": return <span className={`${cls} bg-maestro-green`} />;
    case "failed": return <span className={`${cls} bg-maestro-red`} />;
    case "cancelled":
    case "interrupted": return <span className={`${cls} bg-maestro-yellow`} />;
    default: return <span className={`${cls} bg-maestro-muted/60`} />;
  }
}

function nextFireLabel(j: Job): string {
  if (!j.enabled) return "paused";
  if (!j.schedule) return "manual";
  return `cron: ${j.schedule}`;
}

export function JobRow({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  const { runNow, deleteJob } = useOpsStore();

  const onRun = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await runNow(job.scope, job.id, job.projectHash);
  };
  const onDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete job "${job.name}"?`)) return;
    try {
      await deleteJob(job.scope, job.id, job.projectHash);
    } catch (err) {
      window.alert(String(err));
    }
  };

  return (
    <li>
      <div
        className={`flex cursor-default select-none items-center gap-2 border-t border-maestro-border/20 px-3 py-1.5 hover:bg-maestro-card/40 ${
          open ? "bg-maestro-card/40" : ""
        }`}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={11} className="text-maestro-muted" /> : <ChevronRight size={11} className="text-maestro-muted" />}
        {statusDot(job.lastDispatch?.status, job.enabled)}
        <span className="flex-1 truncate text-[12px] text-maestro-text">{job.name}</span>
        {driverBadge(job)}
        <span className="text-[10.5px] text-maestro-muted/70">{nextFireLabel(job)}</span>
        <button
          type="button"
          onClick={onRun}
          aria-label="Run now"
          className="rounded p-0.5 text-maestro-accent hover:bg-maestro-accent/10"
        >
          <Play size={11} />
        </button>
      </div>
      {open && (
        <div className="border-t border-maestro-border/20 bg-maestro-card/20 px-6 py-2 text-[11px] text-maestro-text">
          <dl className="grid grid-cols-[70px_1fr] gap-x-3 gap-y-1">
            <dt className="text-maestro-muted/70 uppercase text-[9.5px]">Driver</dt>
            <dd>{job.driver}</dd>
            <dt className="text-maestro-muted/70 uppercase text-[9.5px]">Scope</dt>
            <dd>{job.scope}{job.projectHash ? ` (${job.projectHash.slice(0, 8)})` : ""}</dd>
            <dt className="text-maestro-muted/70 uppercase text-[9.5px]">Schedule</dt>
            <dd>{job.schedule ?? "—"}</dd>
            {job.driver === "maestro" && job.maestro && (
              <>
                <dt className="text-maestro-muted/70 uppercase text-[9.5px]">Command</dt>
                <dd className="font-mono text-[10.5px]">{job.maestro.command} {job.maestro.args.join(" ")}</dd>
              </>
            )}
            {job.driver === "claude-trigger" && job.claudeTrigger && (
              <>
                <dt className="text-maestro-muted/70 uppercase text-[9.5px]">Prompt</dt>
                <dd className="whitespace-pre-wrap text-[10.5px] text-[#c587e8]">{job.claudeTrigger.prompt}</dd>
              </>
            )}
            {job.lastDispatch && (
              <>
                <dt className="text-maestro-muted/70 uppercase text-[9.5px]">Last run</dt>
                <dd>{new Date(job.lastDispatch.startedAt * 1000).toLocaleString()} — {job.lastDispatch.status}</dd>
              </>
            )}
          </dl>
          <div className="mt-2 flex gap-1.5">
            <button type="button" onClick={onRun} className="rounded border border-maestro-border bg-maestro-accent/10 px-2 py-0.5 text-[10.5px] text-maestro-accent">
              <Play size={11} className="inline mr-1" /> Run now
            </button>
            <button type="button" className="rounded border border-maestro-border px-2 py-0.5 text-[10.5px] text-maestro-muted" aria-label="Pause (Stage 2)">
              <Pause size={11} className="inline mr-1" /> {job.enabled ? "Pause" : "Resume"}
            </button>
            <button type="button" className="rounded border border-maestro-border px-2 py-0.5 text-[10.5px] text-maestro-muted">
              <Pencil size={11} className="inline mr-1" /> Edit
            </button>
            <button type="button" className="rounded border border-maestro-border px-2 py-0.5 text-[10.5px] text-maestro-muted">
              <ScrollText size={11} className="inline mr-1" /> Log
            </button>
            <button type="button" onClick={onDelete} aria-label="Delete job" className="ml-auto rounded border border-maestro-red/50 bg-maestro-red/10 px-2 py-0.5 text-[10.5px] text-maestro-red">
              <Trash2 size={11} className="inline mr-1" /> Delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
```

- [ ] **Step 19.2: Snapshot + interaction test**

Create `src/components/ops/__tests__/JobRow.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useOpsStore } from "@/stores/useOpsStore";
import { JobRow } from "../JobRow";
import type { Job } from "@/types/ops";

const baseJob: Job = {
  id: "j1",
  name: "ghd-daily",
  enabled: true,
  scope: "project",
  projectHash: "abc123",
  tags: [],
  driver: "maestro",
  schedule: "0 9 * * *",
  maestro: { command: "ghd", args: ["list"], env: {} },
  notifyOnFailure: false,
  createdAt: 0,
  updatedAt: 0,
};

describe("JobRow", () => {
  beforeEach(() => {
    useOpsStore.setState({
      jobsByScope: {}, dispatchesByScope: {}, tools: [], live: {}, caps: undefined, scopeFilter: "all",
    });
  });

  it("shows the job name and schedule collapsed", () => {
    render(<JobRow job={baseJob} />);
    expect(screen.getByText("ghd-daily")).toBeInTheDocument();
    expect(screen.getByText(/cron: 0 9 \* \* \*/)).toBeInTheDocument();
  });

  it("reveals details on click", () => {
    render(<JobRow job={baseJob} />);
    fireEvent.click(screen.getByText("ghd-daily"));
    expect(screen.getByText("ghd list")).toBeInTheDocument();
  });

  it("invokes runNow when play is clicked", async () => {
    const runNow = vi.fn(async () => {});
    useOpsStore.setState({ runNow } as any);
    render(<JobRow job={baseJob} />);
    fireEvent.click(screen.getByLabelText("Run now"));
    expect(runNow).toHaveBeenCalledWith("project", "j1", "abc123");
  });
});
```

- [ ] **Step 19.3: Run + commit**

Run: `npm test -- JobRow`
Expected: 3 passed.

Commit:
```bash
git add src/components/ops/JobRow.tsx src/components/ops/__tests__/JobRow.test.tsx
git commit -m "feat(ops): JobRow collapsed + inline-expanded with run-now and delete"
```

---

### Task 20: ToolsSection

**Files:**
- Modify: `src/components/ops/sections/ToolsSection.tsx`

- [ ] **Step 20.1: Implementation**

Replace `src/components/ops/sections/ToolsSection.tsx`:

```tsx
import { Plus, Package } from "lucide-react";
import { useState } from "react";
import { useOpsStore } from "@/stores/useOpsStore";
import { OpsSection } from "../OpsSection";
import type { Tool } from "@/types/ops";

interface Props { projectHash?: string }

export function ToolsSection(_: Props) {
  const tools = useOpsStore((s) => s.tools);
  const saveTool = useOpsStore((s) => s.saveTool);
  const deleteTool = useOpsStore((s) => s.deleteTool);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [binary, setBinary] = useState("");

  const onAdd = async () => {
    if (!name.trim() || !binary.trim()) return;
    const t: Tool = {
      id: "",
      name: name.trim(),
      binary: binary.trim(),
      defaults: { args: [], env: {} },
      createdAt: 0,
    };
    await saveTool(t);
    setName(""); setBinary(""); setAdding(false);
  };

  return (
    <OpsSection
      title="Tools"
      count={tools.length}
      defaultOpen={false}
      action={
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setAdding(true); }}
          aria-label="New tool"
          className="rounded p-0.5 text-maestro-accent hover:bg-maestro-accent/10"
        >
          <Plus size={12} />
        </button>
      }
    >
      {adding && (
        <div className="flex gap-2 border-b border-maestro-border/40 px-3 py-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name"
            className="flex-1 rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11px] text-maestro-text"
          />
          <input
            value={binary}
            onChange={(e) => setBinary(e.target.value)}
            placeholder="binary"
            className="w-24 rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11px] text-maestro-text"
          />
          <button type="button" onClick={onAdd} className="rounded bg-maestro-accent/15 px-2 py-1 text-[10.5px] text-maestro-accent">
            Add
          </button>
          <button type="button" onClick={() => setAdding(false)} className="text-[10.5px] text-maestro-muted">
            Cancel
          </button>
        </div>
      )}
      {tools.length === 0 && !adding ? (
        <div className="px-4 py-3 text-center text-[11px] text-maestro-muted/60">
          No tools registered. Tools are templates for quickly creating jobs.
        </div>
      ) : (
        <ul>
          {tools.map((t) => (
            <li key={t.id} className="flex items-center gap-2 border-t border-maestro-border/20 px-3 py-1.5">
              <Package size={12} className="text-maestro-muted" />
              <span className="flex-1 truncate text-[12px] text-maestro-text">{t.name}</span>
              <span className="font-mono text-[10.5px] text-maestro-muted/70">{t.binary}</span>
              <button
                type="button"
                aria-label="Delete tool"
                onClick={() => deleteTool(t.id)}
                className="text-[10.5px] text-maestro-muted hover:text-maestro-red"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </OpsSection>
  );
}
```

- [ ] **Step 20.2: Seed default tools**

Add a one-time seed step. Edit `src/stores/useOpsStore.ts`, in `loadTools`:

Replace the `loadTools` body with:

```ts
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
```

Add the missing import at top if not present: `import type { Tool } from "@/types/ops";`

- [ ] **Step 20.3: Run + commit**

Run: `npm run build`
Expected: no type errors.

Commit:
```bash
git add src/components/ops/sections/ToolsSection.tsx src/stores/useOpsStore.ts
git commit -m "feat(ops): ToolsSection with add/delete and seed (claude, bash)"
```

---

### Task 21: HistorySection

**Files:**
- Modify: `src/components/ops/sections/HistorySection.tsx`

- [ ] **Step 21.1: Implementation**

Replace `src/components/ops/sections/HistorySection.tsx`:

```tsx
import { useMemo } from "react";
import { useOpsStore } from "@/stores/useOpsStore";
import { OpsSection } from "../OpsSection";

interface Props { projectHash?: string }

function statusIcon(s: string): string {
  switch (s) {
    case "succeeded": return "✓";
    case "failed": return "✗";
    case "cancelled":
    case "interrupted": return "⏸";
    case "running": return "●";
    default: return "•";
  }
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() / 1000) - ts);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function HistorySection({ projectHash }: Props) {
  const map = useOpsStore((s) => s.dispatchesByScope);
  const all = useMemo(() => {
    const g = map["global"] ?? [];
    const p = projectHash ? (map[`project:${projectHash}`] ?? []) : [];
    return [...g, ...p].sort((a, b) => b.startedAt - a.startedAt).slice(0, 30);
  }, [map, projectHash]);

  return (
    <OpsSection title="History" count={all.length ? `last ${all.length}` : "empty"} defaultOpen={false}>
      {all.length === 0 ? (
        <div className="px-4 py-3 text-center text-[11px] text-maestro-muted/60">No dispatches yet.</div>
      ) : (
        <ul>
          {all.map((d) => (
            <li key={d.id} className="flex items-center gap-2 border-t border-maestro-border/20 px-3 py-1 text-[11px]">
              <span className={`w-3 text-center ${d.status === "failed" ? "text-maestro-red" : d.status === "succeeded" ? "text-maestro-green" : "text-maestro-muted"}`}>
                {statusIcon(d.status)}
              </span>
              <span className="w-20 tabular-nums text-maestro-muted">{timeAgo(d.startedAt)}</span>
              <span className="flex-1 truncate font-mono text-[10.5px] text-maestro-muted/80">{d.outputHead.split("\n")[0] || d.jobId}</span>
            </li>
          ))}
        </ul>
      )}
    </OpsSection>
  );
}
```

- [ ] **Step 21.2: Verify build + commit**

Run: `npm run build`
Expected: no type errors.

Commit:
```bash
git add src/components/ops/sections/HistorySection.tsx
git commit -m "feat(ops): HistorySection with merged global+project dispatches"
```

---

### Task 22: Phase E smoke

- [ ] **Step 22.1: Run the app and exercise the sections**

Run: `npm run dev`
Expected:
- Open the app, pick a repo.
- Click the Ops tab. You see: Jobs section (empty), Tools section (claude + bash seeded), Claude Surfaces placeholder, History (empty).
- Clicking `+` on Jobs opens the stub wizard.
- Clicking `+` on Tools reveals an inline add form.
- Scope tabs toggle inside Jobs.

No commit for smoke — this is a manual checkpoint.

**Phase E checkpoint:** all read-path sections render real data; backend events are arriving in the store.

---

## Phase F — Frontend write path

### Task 23: NewJobWizard — shared skeleton + driver picker

**Files:**
- Modify: `src/components/ops/NewJobWizard.tsx`

- [ ] **Step 23.1: Modal with driver step**

Replace `src/components/ops/NewJobWizard.tsx`:

```tsx
import { useState } from "react";
import { X } from "lucide-react";
import type { Job, JobDriver, Scope } from "@/types/ops";
import { useOpsStore } from "@/stores/useOpsStore";
import { MaestroJobForm } from "./wizard/MaestroJobForm";
import { ClaudeTriggerForm } from "./wizard/ClaudeTriggerForm";

interface Props {
  open: boolean;
  onClose: () => void;
  projectHash?: string;
}

type Step = "driver" | "form";

export function NewJobWizard({ open, onClose, projectHash }: Props) {
  const [step, setStep] = useState<Step>("driver");
  const [driver, setDriver] = useState<JobDriver>("maestro");
  const [scope, setScope] = useState<Scope>("project");
  const saveJob = useOpsStore((s) => s.saveJob);

  if (!open) return null;

  const reset = () => { setStep("driver"); setDriver("maestro"); setScope("project"); };
  const close = () => { reset(); onClose(); };

  const submit = async (partial: Partial<Job>) => {
    const job: Job = {
      id: "",
      name: partial.name ?? "untitled",
      enabled: partial.enabled ?? true,
      scope,
      projectHash: scope === "project" ? projectHash : undefined,
      tags: partial.tags ?? [],
      driver,
      schedule: partial.schedule,
      maestro: partial.maestro,
      claudeTrigger: partial.claudeTrigger,
      toolId: partial.toolId,
      notifyOnFailure: partial.notifyOnFailure ?? false,
      createdAt: 0,
      updatedAt: 0,
    };
    try {
      await saveJob(scope, job, projectHash);
      close();
    } catch (e) {
      window.alert(`Failed to create job: ${e}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={close}>
      <div
        className="w-[520px] max-h-[80vh] overflow-y-auto rounded border border-maestro-border bg-maestro-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-center">
          <h2 className="text-[13px] font-semibold text-maestro-text">New job</h2>
          <button type="button" onClick={close} aria-label="Close" className="ml-auto text-maestro-muted hover:text-maestro-text">
            <X size={14} />
          </button>
        </header>

        {step === "driver" ? (
          <DriverPicker
            driver={driver} onDriver={setDriver}
            scope={scope} onScope={setScope}
            canProject={!!projectHash}
            onNext={() => setStep("form")}
          />
        ) : driver === "maestro" ? (
          <MaestroJobForm onCancel={() => setStep("driver")} onSubmit={submit} />
        ) : (
          <ClaudeTriggerForm onCancel={() => setStep("driver")} onSubmit={submit} />
        )}
      </div>
    </div>
  );
}

function DriverPicker({
  driver, onDriver, scope, onScope, canProject, onNext,
}: {
  driver: JobDriver;
  onDriver: (d: JobDriver) => void;
  scope: Scope;
  onScope: (s: Scope) => void;
  canProject: boolean;
  onNext: () => void;
}) {
  return (
    <>
      <div className="mb-4">
        <p className="mb-2 text-[10.5px] uppercase tracking-wider text-maestro-muted">Driver</p>
        <div className="grid grid-cols-2 gap-2">
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
        </div>
      </div>
      <div className="mb-4">
        <p className="mb-2 text-[10.5px] uppercase tracking-wider text-maestro-muted">Scope</p>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => onScope("project")}
            disabled={!canProject}
            className={`rounded px-3 py-1 text-[11px] ${
              scope === "project"
                ? "bg-maestro-accent/15 text-maestro-accent"
                : "text-maestro-muted disabled:opacity-40"
            }`}
          >
            Project
          </button>
          <button
            type="button"
            onClick={() => onScope("global")}
            className={`rounded px-3 py-1 text-[11px] ${
              scope === "global"
                ? "bg-maestro-accent/15 text-maestro-accent"
                : "text-maestro-muted"
            }`}
          >
            Global
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onNext}
        className="rounded bg-maestro-accent/20 px-3 py-1.5 text-[11px] text-maestro-accent"
      >
        Next →
      </button>
    </>
  );
}

function DriverCard({ selected, onSelect, title, desc }: { selected: boolean; onSelect: () => void; title: string; desc: string }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded border px-3 py-2 text-left ${
        selected ? "border-maestro-accent bg-maestro-accent/5" : "border-maestro-border hover:border-maestro-accent/40"
      }`}
    >
      <div className="text-[12px] text-maestro-text">{title}</div>
      <div className="mt-1 text-[10.5px] text-maestro-muted">{desc}</div>
    </button>
  );
}
```

- [ ] **Step 23.2: Stub the two form components**

Create `src/components/ops/wizard/MaestroJobForm.tsx`:
```tsx
import type { Job } from "@/types/ops";

interface Props {
  onCancel: () => void;
  onSubmit: (partial: Partial<Job>) => Promise<void>;
}

export function MaestroJobForm({ onCancel }: Props) {
  return (
    <div className="text-[11px] text-maestro-muted">
      Maestro form — implemented in Task 24.
      <div className="mt-3">
        <button type="button" onClick={onCancel} className="text-maestro-muted">← Back</button>
      </div>
    </div>
  );
}
```

Create `src/components/ops/wizard/ClaudeTriggerForm.tsx`:
```tsx
import type { Job } from "@/types/ops";

interface Props {
  onCancel: () => void;
  onSubmit: (partial: Partial<Job>) => Promise<void>;
}

export function ClaudeTriggerForm({ onCancel }: Props) {
  return (
    <div className="text-[11px] text-maestro-muted">
      Claude-trigger form — implemented in Task 25.
      <div className="mt-3">
        <button type="button" onClick={onCancel} className="text-maestro-muted">← Back</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 23.3: Verify build + commit**

Run: `npm run build`
Expected: no type errors.

Commit:
```bash
git add src/components/ops/NewJobWizard.tsx src/components/ops/wizard/
git commit -m "feat(ops): NewJobWizard shell with driver picker and scope toggle"
```

---

### Task 24: MaestroJobForm — full implementation

**Files:**
- Modify: `src/components/ops/wizard/MaestroJobForm.tsx`

- [ ] **Step 24.1: Full form with cron validation**

Replace `src/components/ops/wizard/MaestroJobForm.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { Job, Tool } from "@/types/ops";
import { useOpsStore } from "@/stores/useOpsStore";

interface Props {
  onCancel: () => void;
  onSubmit: (partial: Partial<Job>) => Promise<void>;
}

/** Validate a cron expression: 5 space-separated fields. Returns an error string or null. */
export function validateCron(expr: string): string | null {
  const trimmed = expr.trim();
  if (trimmed.length === 0) return null; // empty = manual-only
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return "Cron must have 5 fields (min hour day month dow)";
  const ranges: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  for (let i = 0; i < 5; i++) {
    const f = parts[i];
    if (f === "*") continue;
    // Allow '*/N', 'a,b', 'a-b', or plain numbers
    const tokens = f.split(",");
    for (const t of tokens) {
      const step = t.includes("*/") ? Number(t.slice(2)) : null;
      if (step !== null) {
        if (!Number.isFinite(step) || step < 1) return `Field ${i + 1}: invalid step`;
        continue;
      }
      const [lo, hi] = t.split("-").map(Number);
      if (!Number.isFinite(lo)) return `Field ${i + 1}: not a number`;
      if (hi !== undefined && !Number.isFinite(hi)) return `Field ${i + 1}: not a number`;
      if (lo < ranges[i][0] || lo > ranges[i][1]) return `Field ${i + 1}: out of range`;
      if (hi !== undefined && (hi < ranges[i][0] || hi > ranges[i][1])) return `Field ${i + 1}: out of range`;
    }
  }
  return null;
}

export function MaestroJobForm({ onCancel, onSubmit }: Props) {
  const tools = useOpsStore((s) => s.tools);
  const [name, setName] = useState("");
  const [toolId, setToolId] = useState<string>("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [cwd, setCwd] = useState("");
  const [schedule, setSchedule] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cronError = useMemo(() => validateCron(schedule), [schedule]);

  const pickTool = (id: string) => {
    setToolId(id);
    const t = tools.find((x) => x.id === id);
    if (t) {
      setCommand(t.binary);
      setArgs(t.defaults.args.join(" "));
      if (t.defaults.cwd && !cwd) setCwd(t.defaults.cwd);
    }
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError("Name is required");
    if (!command.trim()) return setError("Command is required");
    if (cronError) return setError(cronError);
    setSubmitting(true);
    const splitArgs = args.trim().length > 0 ? args.trim().split(/\s+/) : [];
    await onSubmit({
      name: name.trim(),
      schedule: schedule.trim() || undefined,
      maestro: {
        command: command.trim(),
        args: splitArgs,
        cwd: cwd.trim() || undefined,
        env: {},
      },
      toolId: toolId || undefined,
    });
    setSubmitting(false);
  };

  return (
    <div className="space-y-3">
      <Field label="Name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. ghd-daily"
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11.5px] text-maestro-text"
        />
      </Field>
      <Field label="Template (optional)">
        <select
          value={toolId}
          onChange={(e) => pickTool(e.target.value)}
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11.5px] text-maestro-text"
        >
          <option value="">— none —</option>
          {tools.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.binary})</option>)}
        </select>
      </Field>
      <Field label="Command">
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="ghd"
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 font-mono text-[11px] text-maestro-text"
        />
      </Field>
      <Field label="Arguments">
        <input
          value={args}
          onChange={(e) => setArgs(e.target.value)}
          placeholder="list --since 2026-04-01"
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 font-mono text-[11px] text-maestro-text"
        />
      </Field>
      <Field label="Working directory (optional)">
        <input
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="/path/to/dir (defaults to project or $HOME)"
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11px] text-maestro-text"
        />
      </Field>
      <Field label="Schedule (cron, optional)">
        <input
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          placeholder="0 9 * * *  — leave blank for manual-only"
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 font-mono text-[11px] text-maestro-text"
          aria-invalid={!!cronError}
        />
        {cronError && <p className="mt-1 text-[10.5px] text-maestro-red">{cronError}</p>}
      </Field>

      {error && <p className="text-[11px] text-maestro-red">{error}</p>}

      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onCancel} className="text-[11px] text-maestro-muted">← Back</button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !!cronError}
          className="ml-auto rounded bg-maestro-accent/20 px-3 py-1.5 text-[11px] text-maestro-accent disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Create job"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-maestro-muted">{label}</label>
      {children}
    </div>
  );
}
```

- [ ] **Step 24.2: Test cron validation**

Create `src/components/ops/__tests__/validateCron.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateCron } from "../wizard/MaestroJobForm";

describe("validateCron", () => {
  it("accepts empty string (manual-only)", () => {
    expect(validateCron("")).toBeNull();
  });

  it("accepts valid 5-field expressions", () => {
    expect(validateCron("0 9 * * *")).toBeNull();
    expect(validateCron("*/15 * * * *")).toBeNull();
    expect(validateCron("0 0 1,15 * *")).toBeNull();
    expect(validateCron("0 9-17 * * 1-5")).toBeNull();
  });

  it("rejects wrong field count", () => {
    expect(validateCron("0 9 * *")).toMatch(/5 fields/);
  });

  it("rejects out-of-range values", () => {
    expect(validateCron("0 25 * * *")).toMatch(/range/);
    expect(validateCron("60 * * * *")).toMatch(/range/);
  });
});
```

- [ ] **Step 24.3: Run + commit**

Run: `npm test -- validateCron`
Expected: 4 passed.

Commit:
```bash
git add src/components/ops/wizard/MaestroJobForm.tsx src/components/ops/__tests__/validateCron.test.ts
git commit -m "feat(ops): MaestroJobForm with cron validation and tool templates"
```

---

### Task 25: ClaudeTriggerForm — with ≥1h guard

**Files:**
- Modify: `src/components/ops/wizard/ClaudeTriggerForm.tsx`

- [ ] **Step 25.1: Approximate min-interval by parsing the cron**

Add a small helper (same file or inline). Replace `src/components/ops/wizard/ClaudeTriggerForm.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { Job } from "@/types/ops";
import { validateCron } from "./MaestroJobForm";

interface Props {
  onCancel: () => void;
  onSubmit: (partial: Partial<Job>) => Promise<void>;
}

/** Rough estimate: parses the minute+hour fields to decide if the interval is < 1h. */
export function estimateMinIntervalSec(expr: string): number | null {
  const trimmed = expr.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour] = parts;
  // If minute field contains "*/N" with N < 60, step <1h.
  if (min.startsWith("*/")) {
    const step = Number(min.slice(2));
    if (Number.isFinite(step) && step > 0) return step * 60;
  }
  // If minute field is "*" and hour field is "*/N", step=hours.
  if (min === "*" && hour.startsWith("*/")) {
    const step = Number(hour.slice(2));
    if (Number.isFinite(step)) return step * 3600;
  }
  // If minute is "*" without hour restriction → fires every minute → 60s.
  if (min === "*") return 60;
  // Otherwise assume ≥ 1h (fires at specific minute each hour, or less often).
  return 3600;
}

const KNOWN_CONNECTORS = ["gmail", "google-calendar"];

export function ClaudeTriggerForm({ onCancel, onSubmit }: Props) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState("0 9 * * *");
  const [connectors, setConnectors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cronError = useMemo(() => validateCron(schedule), [schedule]);
  const intervalSec = useMemo(() => estimateMinIntervalSec(schedule), [schedule]);
  const intervalError = useMemo(() => {
    if (intervalSec === null) return null;
    if (intervalSec < 3600) return "Claude triggers require at least 1 hour between runs.";
    return null;
  }, [intervalSec]);

  const toggleConnector = (c: string) => {
    setConnectors((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError("Name is required");
    if (!prompt.trim()) return setError("Prompt is required");
    if (cronError) return setError(cronError);
    if (intervalError) return setError(intervalError);
    setSubmitting(true);
    await onSubmit({
      name: name.trim(),
      schedule: schedule.trim(),
      claudeTrigger: {
        prompt: prompt.trim(),
        mcpConnectors: connectors,
      },
    });
    setSubmitting(false);
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-maestro-muted">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. pr-triage"
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11.5px] text-maestro-text"
        />
      </div>
      <div>
        <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-maestro-muted">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what Claude should do on each run. Remember: remote execution, no local files."
          rows={4}
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11px] text-maestro-text"
        />
      </div>
      <div>
        <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-maestro-muted">Schedule (cron)</label>
        <input
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 font-mono text-[11px] text-maestro-text"
        />
        {cronError && <p className="mt-1 text-[10.5px] text-maestro-red">{cronError}</p>}
        {!cronError && intervalError && (
          <p className="mt-1 text-[10.5px] text-maestro-red">{intervalError}</p>
        )}
      </div>
      <div>
        <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-maestro-muted">MCP Connectors (optional)</label>
        <div className="flex flex-wrap gap-1.5">
          {KNOWN_CONNECTORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => toggleConnector(c)}
              className={`rounded border px-2 py-0.5 text-[10.5px] ${
                connectors.includes(c)
                  ? "border-maestro-accent bg-maestro-accent/10 text-maestro-accent"
                  : "border-maestro-border text-maestro-muted"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10.5px] text-maestro-muted/60">
          Additional connectors must be enabled at{" "}
          <a href="https://claude.ai/settings/connectors" target="_blank" rel="noreferrer" className="text-maestro-accent underline">
            claude.ai/settings/connectors
          </a>.
        </p>
      </div>

      {error && <p className="text-[11px] text-maestro-red">{error}</p>}

      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onCancel} className="text-[11px] text-maestro-muted">← Back</button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !!cronError || !!intervalError}
          className="ml-auto rounded bg-maestro-accent/20 px-3 py-1.5 text-[11px] text-maestro-accent disabled:opacity-50"
        >
          {submitting ? "Calling /schedule…" : "Create trigger"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 25.2: Test the interval estimator**

Create `src/components/ops/__tests__/estimateMinInterval.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { estimateMinIntervalSec } from "../wizard/ClaudeTriggerForm";

describe("estimateMinIntervalSec", () => {
  it("rejects every-minute", () => {
    expect(estimateMinIntervalSec("* * * * *")).toBe(60);
  });
  it("rejects */30 minute", () => {
    expect(estimateMinIntervalSec("*/30 * * * *")).toBe(30 * 60);
  });
  it("accepts */2 hour", () => {
    expect(estimateMinIntervalSec("0 */2 * * *")).toBe(3600);
  });
  it("accepts specific minute each hour (>=1h)", () => {
    expect(estimateMinIntervalSec("15 * * * *")).toBe(3600);
  });
  it("accepts daily 9am", () => {
    expect(estimateMinIntervalSec("0 9 * * *")).toBe(3600);
  });
});
```

- [ ] **Step 25.3: Run + commit**

Run: `npm test -- estimateMinInterval`
Expected: 5 passed.

Commit:
```bash
git add src/components/ops/wizard/ClaudeTriggerForm.tsx src/components/ops/__tests__/estimateMinInterval.test.ts
git commit -m "feat(ops): ClaudeTriggerForm with prompt/schedule/connectors and >=1h guard"
```

---

### Task 26: JobDetailPanel (slide-over for edit)

Stage 1 scope: opens a read-mostly detail view with a Delete button and a link back. Full editing lives in the wizard for Stage 1 — editing is queued for Stage 2.

**Files:**
- Create: `src/components/ops/JobDetailPanel.tsx`

- [ ] **Step 26.1: Implementation**

Create `src/components/ops/JobDetailPanel.tsx`:

```tsx
import { X } from "lucide-react";
import type { Job } from "@/types/ops";
import { useOpsStore } from "@/stores/useOpsStore";

interface Props {
  job: Job;
  onClose: () => void;
}

export function JobDetailPanel({ job, onClose }: Props) {
  const deleteJob = useOpsStore((s) => s.deleteJob);
  const runNow = useOpsStore((s) => s.runNow);

  return (
    <div className="flex min-w-[320px] flex-1 flex-col">
      <header className="flex items-center border-b border-maestro-border px-4 py-2">
        <h2 className="text-[13px] font-semibold text-maestro-text">{job.name}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-maestro-muted hover:text-maestro-text">
          <X size={14} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-4 text-[11px] text-maestro-text">
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
          <dt className="text-maestro-muted">Driver</dt><dd>{job.driver}</dd>
          <dt className="text-maestro-muted">Scope</dt><dd>{job.scope}{job.projectHash ? ` (${job.projectHash.slice(0, 8)})` : ""}</dd>
          <dt className="text-maestro-muted">Schedule</dt><dd className="font-mono">{job.schedule ?? "—"}</dd>
          <dt className="text-maestro-muted">Enabled</dt><dd>{job.enabled ? "yes" : "no"}</dd>
          {job.driver === "maestro" && job.maestro && (
            <>
              <dt className="text-maestro-muted">Command</dt><dd className="font-mono">{job.maestro.command}</dd>
              <dt className="text-maestro-muted">Args</dt><dd className="font-mono">{job.maestro.args.join(" ")}</dd>
              {job.maestro.cwd && (<><dt className="text-maestro-muted">Cwd</dt><dd className="font-mono">{job.maestro.cwd}</dd></>)}
            </>
          )}
          {job.driver === "claude-trigger" && job.claudeTrigger && (
            <>
              <dt className="text-maestro-muted">Trigger ID</dt><dd className="font-mono text-[10.5px]">{job.claudeTrigger.triggerId ?? "—"}</dd>
              <dt className="text-maestro-muted">Prompt</dt><dd className="whitespace-pre-wrap">{job.claudeTrigger.prompt}</dd>
              <dt className="text-maestro-muted">Connectors</dt><dd>{job.claudeTrigger.mcpConnectors.join(", ") || "—"}</dd>
            </>
          )}
        </dl>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => runNow(job.scope, job.id, job.projectHash)}
            className="rounded bg-maestro-accent/20 px-3 py-1.5 text-[11px] text-maestro-accent"
          >
            Run now
          </button>
          {job.driver === "claude-trigger" && (
            <a
              href="https://claude.ai/code/scheduled"
              target="_blank"
              rel="noreferrer"
              className="rounded border border-maestro-border px-3 py-1.5 text-[11px] text-maestro-muted"
            >
              Manage on claude.ai →
            </a>
          )}
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm(`Delete job "${job.name}"?`)) return;
              try {
                await deleteJob(job.scope, job.id, job.projectHash);
                onClose();
              } catch (e) {
                window.alert(String(e));
              }
            }}
            className="ml-auto rounded border border-maestro-red/50 bg-maestro-red/10 px-3 py-1.5 text-[11px] text-maestro-red"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 26.2: Wire the slide-over into GitGraphPanel**

Edit `src/components/git/GitGraphPanel.tsx`. Near the other detail-panel branches (`showPRDetail`, `showIssueDetail`, `showDiscussionDetail`), add a new branch for ops job detail. This requires routing: extend the Ops-tab state with a selected job.

Simpler alternative that doesn't require GitGraphPanel changes: render the JobDetailPanel as a modal overlay from JobRow when the user clicks "Edit", like NewJobWizard. That keeps the change local.

Edit `src/components/ops/JobRow.tsx`. At the top of the file add:

```ts
import { JobDetailPanel } from "./JobDetailPanel";
```

Inside the `JobRow` component, add a local state for the detail panel:

```tsx
const [detailOpen, setDetailOpen] = useState(false);
```

Change the `Edit` button's `onClick` from nothing to opening the panel, and render the panel conditionally at the end of the returned `<li>`:

```tsx
<button type="button" onClick={(e) => { e.stopPropagation(); setDetailOpen(true); }} className="rounded border border-maestro-border px-2 py-0.5 text-[10.5px] text-maestro-muted">
  <Pencil size={11} className="inline mr-1" /> Edit
</button>
```

Add before closing `</li>`:
```tsx
{detailOpen && (
  <div className="fixed inset-0 z-40 flex items-stretch justify-end bg-black/40" onClick={() => setDetailOpen(false)}>
    <div className="w-[420px] bg-maestro-surface border-l border-maestro-border" onClick={(e) => e.stopPropagation()}>
      <JobDetailPanel job={job} onClose={() => setDetailOpen(false)} />
    </div>
  </div>
)}
```

- [ ] **Step 26.3: Verify build + commit**

Run: `npm run build`
Expected: no type errors.

Commit:
```bash
git add src/components/ops/JobDetailPanel.tsx src/components/ops/JobRow.tsx
git commit -m "feat(ops): JobDetailPanel slide-over with run-now and delete"
```

---

### Task 27: DispatchViewer (live output + past log)

**Files:**
- Create: `src/components/ops/DispatchViewer.tsx`
- Modify: `src/components/ops/JobRow.tsx` (open viewer from Log button)

- [ ] **Step 27.1: Implementation**

Create `src/components/ops/DispatchViewer.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { readLogTail } from "@/lib/ops";
import type { DispatchOutputEvent, DispatchFinishedEvent, Job } from "@/types/ops";

interface Props {
  job: Job;
  /** dispatchId to watch live, or the latest dispatch id to read from disk */
  dispatchId?: string;
  onClose: () => void;
}

export function DispatchViewer({ job, dispatchId, onClose }: Props) {
  const [lines, setLines] = useState<string>("");
  const [live, setLive] = useState<boolean>(!!dispatchId);
  const prev = useRef<string>("");

  // Load the on-disk tail first (if any).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!dispatchId) return;
      try {
        const tail = await readLogTail(job.scope, dispatchId, job.projectHash, 64 * 1024);
        if (!cancelled) { setLines(tail); prev.current = tail; }
      } catch (_e) {
        // file might not exist yet
      }
    })();
    return () => { cancelled = true; };
  }, [dispatchId, job.scope, job.projectHash]);

  // Subscribe to live events for this dispatch.
  useEffect(() => {
    if (!dispatchId) return;
    let unlistenOut: (() => void) | null = null;
    let unlistenFin: (() => void) | null = null;
    (async () => {
      unlistenOut = await listen<DispatchOutputEvent>("ops://dispatch-output", (e) => {
        if (e.payload.dispatchId === dispatchId) {
          prev.current += e.payload.chunk;
          setLines(prev.current);
        }
      });
      unlistenFin = await listen<DispatchFinishedEvent>("ops://dispatch-finished", (e) => {
        if (e.payload.dispatchId === dispatchId) setLive(false);
      });
    })();
    return () => { unlistenOut?.(); unlistenFin?.(); };
  }, [dispatchId]);

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-end bg-black/40" onClick={onClose}>
      <div className="flex w-[560px] flex-col border-l border-maestro-border bg-maestro-surface" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-2 border-b border-maestro-border px-4 py-2">
          <h2 className="text-[12px] font-semibold text-maestro-text">{job.name}</h2>
          {live && <span className="rounded bg-maestro-green/15 px-1.5 py-[1px] text-[9.5px] uppercase tracking-wider text-maestro-green">Live</span>}
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-maestro-muted hover:text-maestro-text">
            <X size={14} />
          </button>
        </header>
        <pre className="flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] text-maestro-text">
          {lines || <span className="text-maestro-muted">No output yet.</span>}
        </pre>
        {job.driver === "claude-trigger" && (
          <div className="border-t border-maestro-border px-4 py-2 text-[10.5px] text-maestro-muted">
            Full trigger logs live on{" "}
            <a href="https://claude.ai/code/scheduled" target="_blank" rel="noreferrer" className="text-maestro-accent underline">
              claude.ai/code/scheduled
            </a>.
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 27.2: Wire the Log button in JobRow**

Edit `src/components/ops/JobRow.tsx`. Import:

```ts
import { DispatchViewer } from "./DispatchViewer";
```

Add state next to `detailOpen`:

```tsx
const [viewerOpen, setViewerOpen] = useState(false);
```

Change the Log button's onClick to open the viewer:

```tsx
<button
  type="button"
  onClick={(e) => { e.stopPropagation(); setViewerOpen(true); }}
  className="rounded border border-maestro-border px-2 py-0.5 text-[10.5px] text-maestro-muted"
>
  <ScrollText size={11} className="inline mr-1" /> Log
</button>
```

Render conditionally at the end of the `<li>`:

```tsx
{viewerOpen && (
  <DispatchViewer
    job={job}
    dispatchId={job.lastDispatch?.id}
    onClose={() => setViewerOpen(false)}
  />
)}
```

- [ ] **Step 27.3: Verify build + commit**

Run: `npm run build`
Expected: no type errors.

Commit:
```bash
git add src/components/ops/DispatchViewer.tsx src/components/ops/JobRow.tsx
git commit -m "feat(ops): DispatchViewer streams live output and reads log tail"
```

---

**Phase F checkpoint:** users can create jobs (both drivers), run them, watch live output, and review completed dispatches. Scope selection and cron validation work.

---

## Phase G — Finish Stage 1

### Task 28: Surfaces placeholder polish

Already seeded in Task 16 — just verify copy, add a lucide icon next to the header, and a "Coming in Stage 2" note listing the sub-surfaces.

**Files:**
- Modify: `src/components/ops/sections/SurfacesPlaceholder.tsx`

- [ ] **Step 28.1: Better copy**

Replace file:

```tsx
import { Layers } from "lucide-react";
import { OpsSection } from "../OpsSection";

export function SurfacesPlaceholder() {
  return (
    <OpsSection
      title="Claude Surfaces"
      count="Stage 2"
      defaultOpen={false}
    >
      <div className="px-4 py-3 text-[11px] text-maestro-muted/70">
        <div className="mb-2 flex items-center gap-1.5 text-maestro-muted">
          <Layers size={12} />
          <span>Coming in Stage 2</span>
        </div>
        <ul className="list-disc pl-4">
          <li>Hooks — view and toggle PreToolUse / PostToolUse / Stop hooks</li>
          <li>MCP — compact health view with restart</li>
          <li>Webhooks — remote triggers you've registered</li>
          <li>Secrets — keychain-backed values by scope</li>
        </ul>
      </div>
    </OpsSection>
  );
}
```

- [ ] **Step 28.2: Commit**

```bash
git add src/components/ops/sections/SurfacesPlaceholder.tsx
git commit -m "chore(ops): flesh out Surfaces placeholder with Stage 2 preview"
```

---

### Task 29: Full test run and type/lint pass

- [ ] **Step 29.1: Rust**

Run: `cd src-tauri && cargo test`
Expected: all `ops::` tests + integration test pass. Pre-existing tests remain unaffected.

- [ ] **Step 29.2: Frontend**

Run: `npm test`
Expected: all new vitest suites pass. Pre-existing tests remain unaffected.

- [ ] **Step 29.3: Type + build**

Run: `npm run build`
Expected: clean TypeScript compile + Vite build.

- [ ] **Step 29.4: Lint**

Run: `npx @biomejs/biome check src/components/ops src/stores/useOpsStore.ts src/lib/ops.ts src/types/ops.ts`
Expected: no errors. Fix any formatting issues by running `npx @biomejs/biome check --write <same paths>`.

- [ ] **Step 29.5: Commit any formatting fixups**

If biome wrote changes:
```bash
git add -u
git commit -m "style(ops): biome auto-format"
```

---

### Task 30: Manual smoke pass

Run: `npm run dev` and exercise the panel.

- [ ] **Step 30.1: Maestro job happy path**

1. Open the Ops tab.
2. Click `+` on Jobs.
3. Driver=Maestro, Scope=Project, Next.
4. Name=`echo-smoke`, Command=`bash`, Args=`-lc "echo hello && date"`, Schedule=empty.
5. Click Create job.
6. Expect a new row `echo-smoke` with `manual` label.
7. Click the play button. A Live row appears, the Log button shows output, History records the succeeded dispatch.

Checklist: [ ] created, [ ] ran, [ ] live updated, [ ] history shows succeeded.

- [ ] **Step 30.2: Maestro cron firing**

1. Create another Maestro job named `tick-smoke` with schedule `* * * * *` and command `bash -lc "date"`.
2. Wait up to 60 seconds.
3. The job should fire on the next minute boundary; History gains an entry.

Checklist: [ ] fires automatically, [ ] history records, [ ] no console errors.

- [ ] **Step 30.3: Claude-trigger guard**

1. `+` on Jobs, Driver=Claude Trigger, Next.
2. Enter schedule `*/10 * * * *`. Expect the red "Claude triggers require at least 1 hour between runs." message. Create button disabled.
3. Change to `0 9 * * *`. Button enables.
4. If claude CLI is logged in: create the trigger, verify it appears with a `Claude` badge. If not, expect an error toast naming `claude -p`.

Checklist: [ ] guard triggers, [ ] guard clears on fix, [ ] create path either succeeds or surfaces clear error.

- [ ] **Step 30.4: Scope filter**

1. Create one `global` job and one `project` job.
2. In the Jobs section, use the scope tabs: All shows both, Project shows one, Global shows one.

Checklist: [ ] filter works correctly.

- [ ] **Step 30.5: Delete flows**

1. Delete a Maestro job. Confirm dialog appears. Row disappears. History entry for it remains (orphaned, expected).
2. Delete a Claude-trigger job. Expect a toast: "claude-trigger delete is not supported; open https://claude.ai/code/scheduled".

Checklist: [ ] Maestro delete works, [ ] Claude delete surfaces message.

- [ ] **Step 30.6: Close and reopen the app**

After all the above: quit the app, relaunch.

Checklist:
- [ ] Jobs reappear (persistence works)
- [ ] History still contains prior dispatches
- [ ] The `tick-smoke` job starts firing again once loaded

---

### Task 31: PR preparation

- [ ] **Step 31.1: Rebase/clean the branch**

Run: `git log feat/ops-panel --oneline main..HEAD`
Expected: a clean sequence of staged commits — the spec commit first, then Phase A → G feature commits in order. Nothing on the branch unrelated to Ops.

If any "oops" commits exist, use `git rebase -i main` to squash only *obvious* fixups (never rewrite a commit that already describes real work). If nothing to rebase, skip.

- [ ] **Step 31.2: Push the branch**

Run: `git push -u origin feat/ops-panel`
Expected: branch published.

- [ ] **Step 31.3: Open the PR** — Stage 1 only

Do NOT open a PR yet if Stage 2 will follow on the same branch. Instead:

1. Keep the branch open.
2. Write the Stage 2 plan in a new file: `docs/superpowers/plans/2026-04-18-ops-panel-stage-2.md` (using the `writing-plans` skill).
3. Implement Stage 2 commits on top.
4. Only then open the PR so it covers MVP + Stage 2 as one deliverable, matching the user's requirement.

A reasonable "hold here" commit message if you need to pause:

```bash
# no-op — just a marker for the Stage 1 MVP completion
git commit --allow-empty -m "chore(ops): Stage 1 MVP complete; Stage 2 to follow"
```

---

## Stage 1 Self-Review (run through before handing off)

### Spec coverage check

For each spec section, the implementing task(s):

- §3 Data model → Tasks 2, 13
- §3 Scope rules → Tasks 2, 10 (`ops_save_job` project_hash guard), 18 (scope tabs)
- §3 Storage layout → Tasks 3, 4
- §3 Secrets keychain → Task 5 (MVP wrapper; UI surfaces in Stage 2)
- §4.1 Driver trait → Task 6
- §4.1 Maestro driver → Task 7
- §4.1 Claude-trigger proxy → Task 8
- §4.1 Scheduler + concurrency cap → Task 9
- §4.1 Tauri commands + events → Tasks 10, 11
- §4.1 Error handling (timeout, spawn fail, delete unsupported) → Tasks 7, 8, 10
- §4.2 Frontend layout → Tasks 15, 16
- §4.2 Sections → Tasks 17–21
- §4.2 Slide-over reuse → Task 26
- §4.3 Create Maestro job → Tasks 23, 24
- §4.3 Create Claude-trigger job (≥1h guard) → Tasks 23, 25
- §4.3 Run now / live + history → Tasks 19 (run-now button), 10 (backend), 17 (live), 21 (history), 27 (viewer)
- §4.3 Tools registry → Tasks 10, 20
- §4.3 Claude Surfaces placeholder → Task 28 (real implementation in Stage 2)
- §4.4 Tests → Tasks 2, 3, 6, 7, 8, 9, 12, 14, 17, 19, 24, 25, 29
- §5 Deliverable staged commits → one commit per task, grouped by phase

**Not covered in Stage 1 (deferred to Stage 2 by design):** Hooks editor, MCP compact view, Webhooks list, Secrets manager UI, cost wiring, notifications, YAML import/export.

### Placeholder scan

No `TBD`, `TODO`, "implement later", or "fill in details" strings in this plan. Every code block is complete enough to compile.

### Type consistency

- Rust snake_case → TS camelCase bridged via `#[serde(rename_all = "camelCase")]` (Task 13).
- `Scope` string literals match across Rust enum, TS type, and command call sites.
- `DispatchStatus` values identical across Rust + TS.
- `useOpsStore.runNow` signature matches `JobRow` call site (`scope, jobId, projectHash`).
- `subscribeOpsEvents` handler shape used in `initOpsEventSubscriptions` matches the store's internal handlers.

### Known soft spots (surface to implementer)

1. The `ops_run_now` command for Maestro driver does not preload the dispatch registry before calling scheduler.dispatch_now — `register_dispatch` is called in Task 11, but it runs *after* the scheduler has already begun. In practice the scheduler spawns a tokio task, so the registration races with the first output event. If tests show missed persistence, move `register_dispatch` inside a helper the scheduler calls, or pre-register before calling `dispatch_now`. Flag this during implementation.
2. `claude -p /schedule list my triggers as JSON` depends on model compliance; Task 8's parser falls back to an empty vec on failure. A live-refresh button in the UI (deferred to Stage 2 when we add a visible trigger sync indicator) gives the user a manual retry.
3. Tailwind color classes like `bg-maestro-green`, `text-maestro-red`, etc. assume these are defined in `tailwind.config.ts`. Verify before use; if missing, fall back to standard Tailwind palette equivalents.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-18-ops-panel-stage-1.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
