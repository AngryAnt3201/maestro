# Ops Panel — Stage 2 (Claude Surfaces + Polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Complete the Ops panel by adding Claude Surfaces (Hooks, MCP, Webhooks, Secrets) plus polish (cost/usage integration, notifications, YAML import/export, docs).

**Architecture:** Builds on Stage 1 (`feat/ops-panel` branch, 31 commits). Extends the existing `core/ops/`, `useOpsStore`, and `SurfacesPlaceholder.tsx` with real implementations. Reuses existing `useMcpStore`, `tamagotchi` widget, and Claude Code's `~/.claude/settings.json` / project `.claude/settings.json` for Hooks.

**Tech Stack:** Same as Stage 1. Adds `serde_yaml = "0.9"` for YAML import/export. Notifications go through the existing `tauri-plugin-notification` (already a Tauri built-in).

**Spec:** `docs/superpowers/specs/2026-04-18-ops-panel-design.md` §5 Stage 2 + §4.3 Claude Surfaces.

**Stage 1 plan:** `docs/superpowers/plans/2026-04-18-ops-panel-stage-1.md` (reference for conventions).

---

## File Structure (additions to Stage 1)

**New Rust files:**

```
src-tauri/src/core/ops/secrets.rs        # secret metadata persistence (keys only; values in keychain)
src-tauri/src/core/ops/hooks_reader.rs   # read + round-trip ~/.claude/settings.json + project .claude/settings.json
src-tauri/src/core/ops/yaml_io.rs        # jobs ↔ YAML import/export
```

**Modified Rust files:**

- `src-tauri/src/commands/ops.rs` — new commands: `ops_read_hooks`, `ops_toggle_hook`, `ops_list_secrets`, `ops_put_secret`, `ops_delete_secret`, `ops_export_jobs_yaml`, `ops_import_jobs_yaml`
- `src-tauri/src/lib.rs` — register new commands
- `src-tauri/Cargo.toml` — add `serde_yaml = "0.9"`

**New TypeScript files:**

```
src/components/ops/sections/SurfacesSection.tsx       # replaces SurfacesPlaceholder
src/components/ops/surfaces/HooksSubSection.tsx
src/components/ops/surfaces/McpSubSection.tsx
src/components/ops/surfaces/WebhooksSubSection.tsx
src/components/ops/surfaces/SecretsSubSection.tsx
src/components/ops/ImportExportMenu.tsx               # import/export YAML
```

**Modified TypeScript files:**

- `src/components/ops/OpsPanel.tsx` — swap `SurfacesPlaceholder` for real `SurfacesSection`
- `src/components/ops/sections/JobsSection.tsx` — add import/export menu next to `+` button
- `src/types/ops.ts` — new types for `HookEntry`, `SecretEntry`, `NotifyPolicy`
- `src/lib/ops.ts` — invoke wrappers for new commands
- `src/stores/useOpsStore.ts` — hooks / secrets slice
- `src/components/ops/JobRow.tsx` — notification policy toggle in expanded view
- `src/components/tamagotchi/*` — small wire-in if clean (TBD — inspect first; if messy, skip cost integration)

**Deletion:**

- `src/components/ops/sections/SurfacesPlaceholder.tsx` — superseded by `SurfacesSection`

---

## Phase H — Surfaces

### Task 32: SurfacesSection shell with 4 sub-accordions

**Files:**
- Create: `src/components/ops/sections/SurfacesSection.tsx`
- Create: `src/components/ops/surfaces/HooksSubSection.tsx` (stub)
- Create: `src/components/ops/surfaces/McpSubSection.tsx` (stub)
- Create: `src/components/ops/surfaces/WebhooksSubSection.tsx` (stub)
- Create: `src/components/ops/surfaces/SecretsSubSection.tsx` (stub)
- Modify: `src/components/ops/OpsPanel.tsx` — swap out placeholder
- Delete: `src/components/ops/sections/SurfacesPlaceholder.tsx`

- [ ] **Step 32.1: Create SurfacesSection**

Create `src/components/ops/sections/SurfacesSection.tsx`:

```tsx
import { OpsSection } from "../OpsSection";
import { HooksSubSection } from "../surfaces/HooksSubSection";
import { McpSubSection } from "../surfaces/McpSubSection";
import { WebhooksSubSection } from "../surfaces/WebhooksSubSection";
import { SecretsSubSection } from "../surfaces/SecretsSubSection";

interface Props {
  projectPath?: string;
  projectHash?: string;
}

export function SurfacesSection({ projectPath, projectHash }: Props) {
  return (
    <OpsSection title="Claude Surfaces" count="Hooks · MCP · Webhooks · Secrets" defaultOpen={false}>
      <div className="divide-y divide-maestro-border/20">
        <HooksSubSection projectPath={projectPath} />
        <McpSubSection projectPath={projectPath} />
        <WebhooksSubSection />
        <SecretsSubSection projectHash={projectHash} />
      </div>
    </OpsSection>
  );
}
```

- [ ] **Step 32.2: Create 4 sub-section stubs**

Each file:

```tsx
// HooksSubSection.tsx
interface Props { projectPath?: string }
export function HooksSubSection(_: Props) {
  return <div className="px-4 py-2 text-[11px] text-maestro-muted/60">Hooks — Task 33.</div>;
}
```

Same pattern for McpSubSection (takes `projectPath`), WebhooksSubSection (no props), SecretsSubSection (takes `projectHash`).

- [ ] **Step 32.3: Swap in OpsPanel**

Edit `src/components/ops/OpsPanel.tsx`. Replace the import and usage of `SurfacesPlaceholder` with `SurfacesSection` and pass `repoPath` as `projectPath`:

```tsx
import { SurfacesSection } from "./sections/SurfacesSection";
// ...
<SurfacesSection projectPath={repoPath} projectHash={projHash} />
```

- [ ] **Step 32.4: Delete placeholder**

```bash
git rm src/components/ops/sections/SurfacesPlaceholder.tsx
```

- [ ] **Step 32.5: Build + commit**

Run: `npm run build`
Expected: no errors.

Commit:
```bash
git add src/components/ops/
git commit -m "feat(ops): SurfacesSection shell with Hooks/MCP/Webhooks/Secrets sub-sections"
```

---

### Task 33: Hooks editor (read + toggle)

Claude Code hooks live in `~/.claude/settings.json` (global) and `<repo>/.claude/settings.json` (project). Both files have a `hooks` key with event types (`PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreCompact`, `Notification`). Each event maps to an array of hook entries with `matcher` and `hooks`.

**Files:**
- Create: `src-tauri/src/core/ops/hooks_reader.rs`
- Modify: `src-tauri/src/core/ops/mod.rs` — add `pub mod hooks_reader;`
- Modify: `src-tauri/src/commands/ops.rs` — add `ops_read_hooks`, `ops_toggle_hook` commands
- Modify: `src-tauri/src/lib.rs` — register new commands
- Modify: `src/lib/ops.ts` — add invoke wrappers
- Modify: `src/types/ops.ts` — add `HookEntry` type
- Modify: `src/components/ops/surfaces/HooksSubSection.tsx` — full implementation

- [ ] **Step 33.1: Add HookEntry type to src/types/ops.ts**

Append to `src/types/ops.ts`:

```ts
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
```

- [ ] **Step 33.2: Create hooks_reader.rs**

Create `src-tauri/src/core/ops/hooks_reader.rs`:

```rust
//! Reader/writer for Claude Code hooks across global + project settings.
//!
//! Hooks live under `hooks.<EventName>` in each settings.json as an array of
//! `{ matcher, hooks }` objects. "Disabled" is modeled by moving the entry
//! into a sibling `disabledHooks.<EventName>` array — we don't delete user
//! config.

use directories::BaseDirs;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum HooksError {
    #[error("io: {0}")] Io(#[from] std::io::Error),
    #[error("json: {0}")] Json(#[from] serde_json::Error),
    #[error("home directory unavailable")] NoHome,
    #[error("not found: {0}")] NotFound(String),
}

pub type HooksResult<T> = Result<T, HooksError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookEntry {
    pub id: String,
    pub scope: String,          // "global" | "project"
    pub event: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matcher: Option<String>,
    pub command: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HooksSnapshot {
    pub global: Vec<HookEntry>,
    pub project: Vec<HookEntry>,
}

fn global_settings_path() -> HooksResult<PathBuf> {
    let base = BaseDirs::new().ok_or(HooksError::NoHome)?;
    Ok(base.home_dir().join(".claude").join("settings.json"))
}

fn project_settings_path(project: &Path) -> PathBuf {
    project.join(".claude").join("settings.json")
}

fn read_json(path: &Path) -> HooksResult<Option<Value>> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path)?;
    if raw.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_str(&raw)?))
}

fn write_json(path: &Path, v: &Value) -> HooksResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(v)?)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

fn extract_entries(settings: &Value, scope: &str, key: &str, enabled: bool) -> Vec<HookEntry> {
    let mut out = Vec::new();
    let Some(hooks) = settings.get(key).and_then(|v| v.as_object()) else { return out; };
    for (event, entries) in hooks {
        let Some(list) = entries.as_array() else { continue; };
        for (idx, entry) in list.iter().enumerate() {
            let matcher = entry.get("matcher").and_then(|v| v.as_str()).map(|s| s.to_string());
            let command = entry.get("hooks").and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .and_then(|h| h.get("command"))
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();
            out.push(HookEntry {
                id: format!("{}:{}:{}:{}", scope, key, event, idx),
                scope: scope.into(),
                event: event.clone(),
                matcher,
                command,
                enabled,
            });
        }
    }
    out
}

fn read_scope(path: &Path, scope: &str) -> HooksResult<Vec<HookEntry>> {
    let Some(v) = read_json(path)? else { return Ok(Vec::new()); };
    let mut all = extract_entries(&v, scope, "hooks", true);
    all.extend(extract_entries(&v, scope, "disabledHooks", false));
    Ok(all)
}

pub fn snapshot(project: Option<&Path>) -> HooksResult<HooksSnapshot> {
    let global = read_scope(&global_settings_path()?, "global").unwrap_or_default();
    let project = match project {
        Some(p) => read_scope(&project_settings_path(p), "project").unwrap_or_default(),
        None => Vec::new(),
    };
    Ok(HooksSnapshot { global, project })
}

pub fn toggle(project: Option<&Path>, id: &str, enable: bool) -> HooksResult<()> {
    let parts: Vec<&str> = id.splitn(4, ':').collect();
    if parts.len() != 4 {
        return Err(HooksError::NotFound(id.to_string()));
    }
    let [scope, source_key, event, idx_str] = [parts[0], parts[1], parts[2], parts[3]];
    let idx: usize = idx_str.parse().map_err(|_| HooksError::NotFound(id.to_string()))?;
    let path = match scope {
        "global" => global_settings_path()?,
        "project" => project_settings_path(project.ok_or(HooksError::NotFound("project".into()))?),
        _ => return Err(HooksError::NotFound(id.to_string())),
    };
    let mut v = read_json(&path)?.unwrap_or(Value::Object(Map::new()));
    let dest_key = if enable { "hooks" } else { "disabledHooks" };
    if source_key == dest_key {
        return Ok(()); // already in the requested state
    }

    // Remove from source
    let removed = {
        let obj = v.as_object_mut().ok_or(HooksError::NotFound("root object".into()))?;
        let source = obj.get_mut(source_key).and_then(|s| s.as_object_mut())
            .ok_or(HooksError::NotFound(source_key.into()))?;
        let arr = source.get_mut(event).and_then(|a| a.as_array_mut())
            .ok_or(HooksError::NotFound(event.into()))?;
        if idx >= arr.len() { return Err(HooksError::NotFound(id.into())); }
        arr.remove(idx)
    };

    // Insert into dest
    let obj = v.as_object_mut().unwrap();
    let dest = obj.entry(dest_key).or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut().ok_or(HooksError::NotFound(dest_key.into()))?;
    let arr = dest.entry(event.to_string()).or_insert_with(|| Value::Array(Vec::new()))
        .as_array_mut().unwrap();
    arr.push(removed);

    write_json(&path, &v)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn write(dir: &Path, rel: &str, body: &str) -> PathBuf {
        let p = dir.join(rel);
        if let Some(parent) = p.parent() { fs::create_dir_all(parent).unwrap(); }
        fs::write(&p, body).unwrap();
        p
    }

    #[test]
    fn extracts_hooks_from_settings() {
        let settings = serde_json::json!({
            "hooks": {
                "PreToolUse": [
                    { "matcher": "Bash", "hooks": [{ "command": "echo pre" }] }
                ]
            }
        });
        let entries = extract_entries(&settings, "project", "hooks", true);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].event, "PreToolUse");
        assert_eq!(entries[0].command, "echo pre");
        assert!(entries[0].enabled);
    }

    #[test]
    fn toggle_moves_entry_between_hooks_and_disabledHooks() {
        let tmp = tempdir().unwrap();
        let project = tmp.path();
        let settings = serde_json::json!({
            "hooks": {
                "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "command": "x" }] }]
            }
        });
        write(project, ".claude/settings.json", &settings.to_string());
        toggle(Some(project), "project:hooks:PreToolUse:0", false).unwrap();
        let after: Value = serde_json::from_str(&fs::read_to_string(project.join(".claude/settings.json")).unwrap()).unwrap();
        assert!(after.get("hooks").and_then(|h| h.get("PreToolUse")).and_then(|a| a.as_array()).map_or(true, |a| a.is_empty()));
        assert_eq!(after.get("disabledHooks").and_then(|d| d.get("PreToolUse")).and_then(|a| a.as_array()).map(|a| a.len()).unwrap_or(0), 1);
    }
}
```

- [ ] **Step 33.3: Register module + commands**

Edit `src-tauri/src/core/ops/mod.rs`, add `pub mod hooks_reader;` at the top with the other modules.

Edit `src-tauri/src/commands/ops.rs`, add two new commands:

```rust
#[tauri::command]
pub async fn ops_read_hooks(project_path: Option<String>) -> Result<crate::core::ops::hooks_reader::HooksSnapshot, String> {
    let path = project_path.map(std::path::PathBuf::from);
    crate::core::ops::hooks_reader::snapshot(path.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ops_toggle_hook(project_path: Option<String>, id: String, enable: bool) -> Result<(), String> {
    let path = project_path.map(std::path::PathBuf::from);
    crate::core::ops::hooks_reader::toggle(path.as_deref(), &id, enable)
        .map_err(|e| e.to_string())
}
```

In `src-tauri/src/lib.rs`, add to the `invoke_handler!` list:
```rust
crate::commands::ops::ops_read_hooks,
crate::commands::ops::ops_toggle_hook,
```

Run: `cd src-tauri && cargo test --lib core::ops::hooks_reader::tests`
Expected: 2 passed.

- [ ] **Step 33.4: Add invoke wrappers**

Edit `src/lib/ops.ts`, append:

```ts
import type { HooksSnapshot } from "@/types/ops";

export async function readHooks(projectPath?: string): Promise<HooksSnapshot> {
  return invoke("ops_read_hooks", { projectPath });
}

export async function toggleHook(projectPath: string | undefined, id: string, enable: boolean): Promise<void> {
  return invoke("ops_toggle_hook", { projectPath, id, enable });
}
```

And in `src/types/ops.ts`, add the `HooksSnapshot` wrapper:

```ts
export interface HooksSnapshot {
  global: HookEntry[];
  project: HookEntry[];
}
```

(Use the `HookEntry` type already added in Step 33.1.)

- [ ] **Step 33.5: Implement HooksSubSection**

Replace `src/components/ops/surfaces/HooksSubSection.tsx`:

```tsx
import { useEffect, useState, useCallback } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { HookEntry, HooksSnapshot } from "@/types/ops";
import { readHooks, toggleHook } from "@/lib/ops";

interface Props { projectPath?: string }

export function HooksSubSection({ projectPath }: Props) {
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState<HooksSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSnap(await readHooks(projectPath));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [projectPath]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const all: HookEntry[] = snap ? [...snap.global, ...snap.project] : [];

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-default items-center gap-1.5 px-4 py-1.5 text-left text-[11px] text-maestro-muted hover:bg-maestro-card/30"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="flex-1">Hooks</span>
        <span className="text-[10.5px] text-maestro-muted/60">{snap ? all.length : "…"}</span>
      </button>
      {open && (
        <div>
          {error && <p className="px-4 py-1 text-[10.5px] text-maestro-red">{error}</p>}
          {snap && all.length === 0 && (
            <p className="px-4 py-2 text-[10.5px] text-maestro-muted/60">No hooks configured.</p>
          )}
          <ul>
            {all.map((h) => (
              <li key={h.id} className="flex items-center gap-2 border-t border-maestro-border/10 px-4 py-1">
                <span className={`h-1.5 w-1.5 rounded-full ${h.enabled ? "bg-maestro-green" : "bg-maestro-muted/40"}`} />
                <span className="w-16 text-[9.5px] uppercase tracking-wider text-maestro-muted">{h.scope}</span>
                <span className="w-28 text-[10.5px] text-maestro-text">{h.event}</span>
                <span className="flex-1 truncate font-mono text-[10.5px] text-maestro-muted/80">{h.command}</span>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await toggleHook(h.scope === "project" ? projectPath : undefined, h.id, !h.enabled);
                      await load();
                    } catch (e) {
                      window.alert(String(e));
                    }
                  }}
                  className="text-[10.5px] text-maestro-accent hover:underline"
                >
                  {h.enabled ? "disable" : "enable"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 33.6: Build + commit**

Run: `npm run build` and `cd src-tauri && cargo test --lib core::ops::hooks_reader`
Expected: all pass.

Commit:
```bash
git add src-tauri/src/core/ops/hooks_reader.rs src-tauri/src/core/ops/mod.rs \
        src-tauri/src/commands/ops.rs src-tauri/src/lib.rs \
        src/types/ops.ts src/lib/ops.ts src/components/ops/surfaces/HooksSubSection.tsx
git commit -m "feat(ops): Hooks editor with read + toggle across global/project settings.json"
```

---

### Task 34: MCP compact view

Reuses existing `useMcpStore`. No backend changes.

**Files:**
- Modify: `src/components/ops/surfaces/McpSubSection.tsx`

- [ ] **Step 34.1: Implementation**

Replace `src/components/ops/surfaces/McpSubSection.tsx`:

```tsx
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, RotateCw } from "lucide-react";
import { useMcpStore } from "@/stores/useMcpStore";

interface Props { projectPath?: string }

export function McpSubSection({ projectPath }: Props) {
  const [open, setOpen] = useState(false);
  const fetchServers = useMcpStore((s) => s.fetchProjectServers);
  const refresh = useMcpStore((s) => s.refreshProjectServers);
  const servers = useMcpStore((s) => (projectPath ? s.projectServers[projectPath] ?? [] : []));
  const loading = useMcpStore((s) => (projectPath ? s.isLoading[projectPath] ?? false : false));

  useEffect(() => {
    if (open && projectPath) fetchServers(projectPath);
  }, [open, projectPath, fetchServers]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-default items-center gap-1.5 px-4 py-1.5 text-left text-[11px] text-maestro-muted hover:bg-maestro-card/30"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="flex-1">MCP</span>
        <span className="text-[10.5px] text-maestro-muted/60">{servers.length}</span>
      </button>
      {open && (
        <div>
          {!projectPath && (
            <p className="px-4 py-2 text-[10.5px] text-maestro-muted/60">Open a project to see MCP servers.</p>
          )}
          {projectPath && (
            <>
              <div className="flex items-center gap-2 border-b border-maestro-border/20 px-4 py-1">
                <button
                  type="button"
                  onClick={() => refresh(projectPath)}
                  disabled={loading}
                  className="flex items-center gap-1 text-[10.5px] text-maestro-accent disabled:opacity-50"
                >
                  <RotateCw size={10} className={loading ? "animate-spin" : ""} /> Refresh
                </button>
              </div>
              {servers.length === 0 ? (
                <p className="px-4 py-2 text-[10.5px] text-maestro-muted/60">No MCP servers configured.</p>
              ) : (
                <ul>
                  {servers.map((s) => (
                    <li key={s.name} className="flex items-center gap-2 border-t border-maestro-border/10 px-4 py-1">
                      <span className="w-16 text-[9.5px] uppercase tracking-wider text-maestro-muted">{s.source}</span>
                      <span className="flex-1 truncate text-[11px] text-maestro-text">{s.name}</span>
                      <span className="truncate font-mono text-[10.5px] text-maestro-muted/70">
                        {"command" in s.server_type ? s.server_type.command : s.server_type.url}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

**Note on McpServerConfig shape:** The existing `useMcpStore` exposes `McpServerConfig` which has `server_type` as a discriminated union (`{ type: "stdio", command, args, env }` vs `{ type: "http", url }`). Verify the actual field names by reading `src/lib/mcp.ts` — adjust the render if needed. The code above uses `"command" in s.server_type` as a runtime discriminator.

- [ ] **Step 34.2: Build + commit**

Run: `npm run build`
Expected: no errors.

Commit:
```bash
git add src/components/ops/surfaces/McpSubSection.tsx
git commit -m "feat(ops): MCP compact view with refresh action reusing useMcpStore"
```

---

### Task 35: Webhooks sub-section

`/schedule list --webhooks` doesn't exist; verified in spec §6 as an open question. Ship a deep-link fallback only for Stage 2.

**Files:**
- Modify: `src/components/ops/surfaces/WebhooksSubSection.tsx`

- [ ] **Step 35.1: Implementation**

Replace file:

```tsx
import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";

export function WebhooksSubSection() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-default items-center gap-1.5 px-4 py-1.5 text-left text-[11px] text-maestro-muted hover:bg-maestro-card/30"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="flex-1">Webhooks</span>
        <span className="text-[10.5px] text-maestro-muted/60">remote</span>
      </button>
      {open && (
        <div className="px-4 py-3 text-[10.5px] text-maestro-muted/70">
          <p className="mb-2">
            Claude Code remote triggers and webhooks are managed at claude.ai. Local listing is not exposed
            by the `claude` CLI yet — manage them directly in the dashboard.
          </p>
          <a
            href="https://claude.ai/code/scheduled"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-maestro-accent hover:underline"
          >
            Open Claude Code scheduled <ExternalLink size={10} />
          </a>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 35.2: Build + commit**

Run: `npm run build`
Expected: no errors.

Commit:
```bash
git add src/components/ops/surfaces/WebhooksSubSection.tsx
git commit -m "feat(ops): Webhooks sub-section with deep-link fallback"
```

---

### Task 36: Secrets manager

**Files:**
- Create: `src-tauri/src/core/ops/secrets.rs`
- Modify: `src-tauri/src/core/ops/mod.rs`
- Modify: `src-tauri/src/commands/ops.rs` — new commands
- Modify: `src-tauri/src/lib.rs` — register commands
- Modify: `src/types/ops.ts` — add `SecretEntry`
- Modify: `src/lib/ops.ts` — wrappers
- Modify: `src/components/ops/surfaces/SecretsSubSection.tsx` — full impl

- [ ] **Step 36.1: Rust secrets metadata store**

Create `src-tauri/src/core/ops/secrets.rs`:

```rust
//! Secret metadata persistence. Values live in the OS keychain (see keychain.rs).
//!
//! File layout: ~/.claude-maestro/ops/global/secrets.json  (global + project metadata; scope is tagged)

use crate::core::ops::keychain;
use crate::core::ops::store::{scope_dir, StoreResult};
use crate::core::ops::model::Scope;
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretEntry {
    pub id: String,
    pub key: String,                     // env var name
    pub scope: Scope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_hash: Option<String>,
    pub created_at: i64,
}

fn path() -> StoreResult<std::path::PathBuf> {
    Ok(scope_dir(Scope::Global, None)?.join("secrets.json"))
}

pub fn list() -> StoreResult<Vec<SecretEntry>> {
    let p = path()?;
    if !p.exists() { return Ok(Vec::new()); }
    let raw = fs::read_to_string(&p)?;
    if raw.trim().is_empty() { return Ok(Vec::new()); }
    Ok(serde_json::from_str(&raw)?)
}

pub fn save_all(entries: &[SecretEntry]) -> StoreResult<()> {
    let p = path()?;
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(entries)?)?;
    fs::rename(&tmp, &p)?;
    Ok(())
}

pub fn put(entry: SecretEntry, value: &str) -> Result<SecretEntry, String> {
    keychain::put(&entry.id, value).map_err(|e| e.to_string())?;
    let mut all = list().map_err(|e| e.to_string())?;
    all.retain(|s| s.id != entry.id);
    all.push(entry.clone());
    save_all(&all).map_err(|e| e.to_string())?;
    Ok(entry)
}

pub fn delete(id: &str) -> Result<(), String> {
    // Ignore NotFound on the keychain side (secret metadata may exist without a keychain value).
    if let Err(e) = keychain::delete(id) {
        if !e.to_string().contains("not found") { return Err(e.to_string()); }
    }
    let mut all = list().map_err(|e| e.to_string())?;
    all.retain(|s| s.id != id);
    save_all(&all).map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 36.2: Register module + commands**

Edit `src-tauri/src/core/ops/mod.rs`, add:

```rust
pub mod secrets;
```

Edit `src-tauri/src/commands/ops.rs`, append new commands:

```rust
use crate::core::ops::secrets::{self, SecretEntry};

#[tauri::command]
pub async fn ops_list_secrets() -> Result<Vec<SecretEntry>, String> {
    secrets::list().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ops_put_secret(entry: SecretEntry, value: String) -> Result<SecretEntry, String> {
    let mut e = entry;
    if e.id.is_empty() { e.id = uuid::Uuid::new_v4().to_string(); }
    if e.created_at == 0 { e.created_at = chrono::Utc::now().timestamp(); }
    secrets::put(e, &value)
}

#[tauri::command]
pub async fn ops_delete_secret(id: String) -> Result<(), String> {
    secrets::delete(&id)
}
```

In `src-tauri/src/lib.rs`, register:
```rust
crate::commands::ops::ops_list_secrets,
crate::commands::ops::ops_put_secret,
crate::commands::ops::ops_delete_secret,
```

- [ ] **Step 36.3: TS types + wrappers**

Append to `src/types/ops.ts`:

```ts
export interface SecretEntry {
  id: string;
  key: string;
  scope: Scope;
  projectHash?: string;
  createdAt: number;
}
```

Append to `src/lib/ops.ts`:

```ts
import type { SecretEntry } from "@/types/ops";

export async function listSecrets(): Promise<SecretEntry[]> {
  return invoke("ops_list_secrets");
}

export async function putSecret(entry: SecretEntry, value: string): Promise<SecretEntry> {
  return invoke("ops_put_secret", { entry, value });
}

export async function deleteSecret(id: string): Promise<void> {
  return invoke("ops_delete_secret", { id });
}
```

- [ ] **Step 36.4: SecretsSubSection**

Replace `src/components/ops/surfaces/SecretsSubSection.tsx`:

```tsx
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { SecretEntry } from "@/types/ops";
import { listSecrets, putSecret, deleteSecret } from "@/lib/ops";

interface Props { projectHash?: string }

export function SecretsSubSection({ projectHash }: Props) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<SecretEntry[]>([]);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [scope, setScope] = useState<"global" | "project">("global");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setEntries(await listSecrets());
    } catch (e) { setError(String(e)); }
  };
  useEffect(() => { if (open) load(); }, [open]);

  const onAdd = async () => {
    if (!key.trim() || !value) return;
    try {
      await putSecret({
        id: "",
        key: key.trim(),
        scope,
        projectHash: scope === "project" ? projectHash : undefined,
        createdAt: 0,
      }, value);
      setKey(""); setValue(""); setAdding(false); setError(null);
      await load();
    } catch (e) { setError(String(e)); }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-default items-center gap-1.5 px-4 py-1.5 text-left text-[11px] text-maestro-muted hover:bg-maestro-card/30"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="flex-1">Secrets</span>
        <span className="text-[10.5px] text-maestro-muted/60">{entries.length}</span>
      </button>
      {open && (
        <div>
          <div className="flex items-center gap-2 border-b border-maestro-border/20 px-4 py-1">
            <button
              type="button"
              onClick={() => setAdding((a) => !a)}
              className="flex items-center gap-1 text-[10.5px] text-maestro-accent"
            >
              <Plus size={10} /> {adding ? "Cancel" : "Add secret"}
            </button>
          </div>
          {adding && (
            <div className="space-y-2 border-b border-maestro-border/20 px-4 py-2">
              <div className="flex gap-2">
                <input
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="Env var name (e.g. GITHUB_TOKEN)"
                  className="flex-1 rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11px] text-maestro-text"
                />
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value as "global" | "project")}
                  className="rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11px] text-maestro-text"
                >
                  <option value="global">global</option>
                  <option value="project" disabled={!projectHash}>project</option>
                </select>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Secret value"
                  className="flex-1 rounded border border-maestro-border bg-maestro-card px-2 py-1 font-mono text-[11px] text-maestro-text"
                />
                <button
                  type="button"
                  onClick={onAdd}
                  className="rounded bg-maestro-accent/20 px-2 py-1 text-[10.5px] text-maestro-accent"
                >
                  Save
                </button>
              </div>
            </div>
          )}
          {error && <p className="px-4 py-1 text-[10.5px] text-maestro-red">{error}</p>}
          {entries.length === 0 ? (
            <p className="px-4 py-2 text-[10.5px] text-maestro-muted/60">No secrets yet.</p>
          ) : (
            <ul>
              {entries.map((s) => (
                <li key={s.id} className="flex items-center gap-2 border-t border-maestro-border/10 px-4 py-1">
                  <span className="w-16 text-[9.5px] uppercase tracking-wider text-maestro-muted">{s.scope}</span>
                  <span className="flex-1 truncate font-mono text-[11px] text-maestro-text">{s.key}</span>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(`Delete secret ${s.key}?`)) return;
                      try { await deleteSecret(s.id); await load(); } catch (e) { window.alert(String(e)); }
                    }}
                    aria-label="Delete secret"
                    className="text-maestro-muted hover:text-maestro-red"
                  >
                    <Trash2 size={11} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 36.5: Build + commit**

Run: `npm run build` and `cd src-tauri && cargo check`
Expected: clean.

Commit:
```bash
git add src-tauri/src/core/ops/secrets.rs src-tauri/src/core/ops/mod.rs \
        src-tauri/src/commands/ops.rs src-tauri/src/lib.rs \
        src/types/ops.ts src/lib/ops.ts src/components/ops/surfaces/SecretsSubSection.tsx
git commit -m "feat(ops): Secrets manager with keychain-backed add/list/delete"
```

---

## Phase I — Polish

### Task 37: Cost/usage wiring (minimal — tokens on lastDispatch)

Scope: surface the `tokens` field from `Dispatch` in the JobRow expanded view so Claude-trigger jobs show their cumulative token usage. Full Tamagotchi integration is deferred — the existing tamagotchi widget reads its own usage data via `useUsageStore`, and surfacing dispatch tokens there requires backend changes that aren't worth Stage 2 scope.

**Files:**
- Modify: `src/components/ops/JobRow.tsx`
- Modify: `src/types/ops.ts` — extend `LastDispatch` with `tokens`

- [ ] **Step 37.1: Extend LastDispatch in TS**

Edit `src/types/ops.ts`, change `LastDispatch`:

```ts
export interface LastDispatch {
  id: string;
  startedAt: number;
  status: DispatchStatus;
  tokens?: number;
}
```

Edit `src-tauri/src/core/ops/model.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastDispatch {
    pub id: String,
    pub started_at: i64,
    pub status: DispatchStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens: Option<u64>,
}
```

Edit `src-tauri/src/commands/ops.rs` inside `update_last_dispatch`, also copy `tokens`:

```rust
j.last_dispatch = Some(LastDispatch {
    id: rec.id.clone(),
    started_at: rec.started_at,
    status: rec.status,
    tokens: rec.tokens,
});
```

- [ ] **Step 37.2: Render in JobRow expanded view**

In `src/components/ops/JobRow.tsx`, inside the expanded `<dl>` block, after the "Last run" row, add:

```tsx
{job.lastDispatch?.tokens != null && (
  <>
    <dt className="text-maestro-muted/70 uppercase text-[9.5px]">Tokens</dt>
    <dd>{job.lastDispatch.tokens.toLocaleString()}</dd>
  </>
)}
```

- [ ] **Step 37.3: Build + commit**

Run: `npm run build` and `cd src-tauri && cargo test --lib core::ops::model`
Expected: 3 passed.

Commit:
```bash
git add src/types/ops.ts src-tauri/src/core/ops/model.rs \
        src-tauri/src/commands/ops.rs src/components/ops/JobRow.tsx
git commit -m "feat(ops): surface dispatch tokens on JobRow for cost visibility"
```

---

### Task 38: Notification policy on failure

Use `@tauri-apps/plugin-notification`. Check if the plugin is already listed in `package.json` / `Cargo.toml`. If not, add it.

**Files:**
- Modify: `src-tauri/Cargo.toml` / `package.json` (if needed)
- Modify: `src-tauri/src/lib.rs` — `plugin` init
- Modify: `src-tauri/src/commands/ops.rs` — on Finished/Failed, if job.notify_on_failure, emit notification
- Modify: `src/components/ops/JobRow.tsx` — toggle in expanded view

- [ ] **Step 38.1: Add notification plugin**

Edit `src-tauri/Cargo.toml`, add to `[dependencies]`:
```toml
tauri-plugin-notification = "2"
```

Edit `package.json`, add to `dependencies`:
```json
"@tauri-apps/plugin-notification": "^2.0.0"
```

Run `npm install` to sync.

Edit `src-tauri/src/lib.rs`, in the `Builder` chain, add before `.invoke_handler(...)`:
```rust
.plugin(tauri_plugin_notification::init())
```

- [ ] **Step 38.2: Emit notification on failure**

Edit `src-tauri/src/commands/ops.rs`, inside `handle_dispatch_event` on the `Finished` branch, after the persistence call and before the registry cleanup, add:

```rust
if *status == DispatchStatus::Failed {
    if let Some((scope_, ph, jid)) = self.lookup_dispatch_scope(dispatch_id).await {
        // Find the job and check notify_on_failure
        let map = self.jobs_by_scope.lock().await;
        let key = scope_key(scope_, ph.as_deref());
        if let Some(list) = map.get(&key) {
            if let Some(job) = list.iter().find(|j| j.id == jid) {
                if job.notify_on_failure {
                    use tauri_plugin_notification::NotificationExt;
                    let _ = self.app.notification()
                        .builder()
                        .title("Job failed")
                        .body(&format!("{} failed", job.name))
                        .show();
                }
            }
        }
    }
}
```

- [ ] **Step 38.3: UI toggle**

Edit `src/components/ops/JobRow.tsx`, in the expanded `<dl>`, add after the schedule row:

```tsx
<dt className="text-maestro-muted/70 uppercase text-[9.5px]">Notify</dt>
<dd>
  <button
    type="button"
    onClick={async (e) => {
      e.stopPropagation();
      // Quick save: toggle the flag and re-save.
      const updated = { ...job, notifyOnFailure: !job.notifyOnFailure };
      try {
        await useOpsStore.getState().saveJob(job.scope, updated, job.projectHash);
      } catch (err) { window.alert(String(err)); }
    }}
    className={job.notifyOnFailure ? "text-maestro-accent" : "text-maestro-muted"}
  >
    {job.notifyOnFailure ? "✓ on failure" : "off"}
  </button>
</dd>
```

- [ ] **Step 38.4: Build + commit**

Run: `npm run build` and `cd src-tauri && cargo check`
Expected: clean.

Commit:
```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs \
        src-tauri/src/commands/ops.rs package.json package-lock.json \
        src/components/ops/JobRow.tsx
git commit -m "feat(ops): system notification on failure with per-job toggle"
```

---

### Task 39: YAML import/export

**Files:**
- Create: `src-tauri/src/core/ops/yaml_io.rs`
- Modify: `src-tauri/src/core/ops/mod.rs`, `Cargo.toml`, `commands/ops.rs`, `lib.rs`
- Create: `src/components/ops/ImportExportMenu.tsx`
- Modify: `src/components/ops/sections/JobsSection.tsx`
- Modify: `src/lib/ops.ts`

- [ ] **Step 39.1: Add dep + yaml_io.rs**

Edit `src-tauri/Cargo.toml`, add:
```toml
serde_yaml = "0.9"
```

Create `src-tauri/src/core/ops/yaml_io.rs`:

```rust
use crate::core::ops::model::{Job, Scope};
use crate::core::ops::store;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct JobsYaml {
    pub version: u32,
    pub jobs: Vec<Job>,
}

pub fn export_yaml(scope: Scope, project_hash: Option<&str>) -> Result<String, String> {
    let jobs = store::load_jobs(scope, project_hash).map_err(|e| e.to_string())?;
    let doc = JobsYaml { version: 1, jobs };
    serde_yaml::to_string(&doc).map_err(|e| e.to_string())
}

pub fn import_yaml(scope: Scope, project_hash: Option<&str>, body: &str) -> Result<usize, String> {
    let doc: JobsYaml = serde_yaml::from_str(body).map_err(|e| e.to_string())?;
    let mut existing = store::load_jobs(scope, project_hash).map_err(|e| e.to_string())?;
    for mut job in doc.jobs {
        job.scope = scope;
        job.project_hash = project_hash.map(|s| s.to_string());
        existing.retain(|j| j.id != job.id);
        existing.push(job);
    }
    let n = existing.len();
    store::save_jobs(scope, project_hash, &existing).map_err(|e| e.to_string())?;
    Ok(n)
}
```

Register `pub mod yaml_io;` in `core/ops/mod.rs`.

- [ ] **Step 39.2: Commands**

Append to `src-tauri/src/commands/ops.rs`:

```rust
#[tauri::command]
pub async fn ops_export_jobs_yaml(scope: Scope, project_hash: Option<String>) -> Result<String, String> {
    crate::core::ops::yaml_io::export_yaml(scope, project_hash.as_deref())
}

#[tauri::command]
pub async fn ops_import_jobs_yaml(
    state: State<'_, Arc<OpsState>>,
    scope: Scope,
    project_hash: Option<String>,
    body: String,
) -> Result<usize, String> {
    let n = crate::core::ops::yaml_io::import_yaml(scope, project_hash.as_deref(), &body)?;
    // Re-sync scheduler
    let jobs = store::load_jobs(scope, project_hash.as_deref()).map_err(|e| e.to_string())?;
    state.jobs_by_scope.lock().await.insert(scope_key(scope, project_hash.as_deref()), jobs.clone());
    state.maestro_scheduler.set_jobs(jobs).await;
    let _ = state.app.emit("ops://jobs-updated", serde_json::json!({ "scope": scope, "projectHash": project_hash }));
    Ok(n)
}
```

Register in `lib.rs`:
```rust
crate::commands::ops::ops_export_jobs_yaml,
crate::commands::ops::ops_import_jobs_yaml,
```

- [ ] **Step 39.3: TS wrappers**

Append to `src/lib/ops.ts`:

```ts
export async function exportJobsYaml(scope: Scope, projectHash?: string): Promise<string> {
  return invoke("ops_export_jobs_yaml", { scope, projectHash });
}

export async function importJobsYaml(scope: Scope, body: string, projectHash?: string): Promise<number> {
  return invoke("ops_import_jobs_yaml", { scope, projectHash, body });
}
```

- [ ] **Step 39.4: ImportExportMenu UI**

Create `src/components/ops/ImportExportMenu.tsx`:

```tsx
import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { exportJobsYaml, importJobsYaml } from "@/lib/ops";
import type { Scope } from "@/types/ops";
import { useOpsStore } from "@/stores/useOpsStore";

interface Props {
  scope: Scope;
  projectHash?: string;
}

export function ImportExportMenu({ scope, projectHash }: Props) {
  const [busy, setBusy] = useState(false);

  const onExport = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    try {
      const yaml = await exportJobsYaml(scope, projectHash);
      const blob = new Blob([yaml], { type: "text/yaml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ops-${scope}${projectHash ? `-${projectHash.slice(0, 8)}` : ""}.yaml`;
      a.click();
      URL.revokeObjectURL(url);
    } finally { setBusy(false); }
  };

  const onImport = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".yaml,.yml,text/yaml";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const body = await file.text();
        const n = await importJobsYaml(scope, body, projectHash);
        window.alert(`Imported. ${n} job${n === 1 ? "" : "s"} now in this scope.`);
        await useOpsStore.getState().loadJobs(scope, projectHash);
      };
      input.click();
    } finally { setBusy(false); }
  };

  return (
    <>
      <button type="button" onClick={onExport} disabled={busy} aria-label="Export YAML"
        className="rounded p-0.5 text-maestro-muted hover:text-maestro-accent"
      ><Download size={11} /></button>
      <button type="button" onClick={onImport} disabled={busy} aria-label="Import YAML"
        className="rounded p-0.5 text-maestro-muted hover:text-maestro-accent"
      ><Upload size={11} /></button>
    </>
  );
}
```

- [ ] **Step 39.5: Wire into JobsSection**

Edit `src/components/ops/sections/JobsSection.tsx`. Import:
```ts
import { ImportExportMenu } from "../ImportExportMenu";
```

Change the `action` prop on `OpsSection` to include both the existing `+` button and the new menu. The filter picks the scope:

```tsx
action={
  <div className="flex items-center gap-1">
    <ImportExportMenu
      scope={scopeFilter === "global" ? "global" : "project"}
      projectHash={scopeFilter === "global" ? undefined : projectHash}
    />
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setWizardOpen(true); }}
      aria-label="New job"
      className="rounded p-0.5 text-maestro-accent hover:bg-maestro-accent/10"
    >
      <Plus size={12} />
    </button>
  </div>
}
```

- [ ] **Step 39.6: Build + commit**

Run: `npm run build` and `cd src-tauri && cargo check`
Expected: clean.

Commit:
```bash
git add src-tauri/src/core/ops/yaml_io.rs src-tauri/src/core/ops/mod.rs \
        src-tauri/src/commands/ops.rs src-tauri/src/lib.rs src-tauri/Cargo.toml \
        src-tauri/Cargo.lock src/lib/ops.ts src/components/ops/ImportExportMenu.tsx \
        src/components/ops/sections/JobsSection.tsx
git commit -m "feat(ops): YAML import/export for jobs per scope"
```

---

## Phase J — Finishing

### Task 40: Docs pass

Append a short Ops section to the main README and to `website/docs` if the layout is clear.

**Files:**
- Modify: `README.md`
- Possibly: `website/docs/*.md` (only if the site has a features index — otherwise skip)

- [ ] **Step 40.1: Inspect docs**

Read `README.md` to find the Features section, and `website/` to see if there's a corresponding docs file.

- [ ] **Step 40.2: Add Ops feature blurb**

Add under Features (between MCP and another existing section):

```markdown
### Ops Panel

New tab in the Git panel: schedule and one-shot-dispatch CLI tools, Claude Code remote triggers, and manage Claude Surfaces (Hooks, MCP, Webhooks, Secrets) in one place.

- Register any CLI as a Tool template, turn it into a scheduled Job or one-off dispatch
- Maestro-local scheduler for fast iteration + Claude Trigger (`/schedule`) for always-on remote runs
- Global and per-project scope, YAML import/export, notifications on failure
- Live output streaming + on-disk log tail per dispatch
```

- [ ] **Step 40.3: Commit**

```bash
git add README.md
git commit -m "docs: describe Ops panel feature in README"
```

---

### Task 41: Stage 2 completion marker + PR open

- [ ] **Step 41.1: Full test pass**

Run:
```bash
cd src-tauri && cargo test
cd .. && npm test -- --run src/components/ops src/stores/__tests__/useOpsStore
```

Expected: all Rust tests pass (existing 144 + new ones from Task 33). Frontend ops suite passes.

- [ ] **Step 41.2: Biome fix**

```bash
npx @biomejs/biome check --write src/components/ops src/stores/useOpsStore.ts src/lib/ops.ts src/types/ops.ts
```

Re-check. Fix any new fixable issues; leave a11y onClick-on-div consistent with existing codebase.

- [ ] **Step 41.3: Stage 2 marker commit**

```bash
git commit --allow-empty -m "chore(ops): Stage 2 complete; Ops panel feature shipped"
```

- [ ] **Step 41.4: Push + open PR**

```bash
git push -u origin feat/ops-panel
gh pr create --title "feat: Ops panel — jobs, schedules, tools, Claude surfaces" --body "$(cat <<'EOF'
## Summary

- Adds a new **Ops** tab to the Git panel with scheduled jobs, one-off dispatches, a CLI tool registry, and Claude Code surfaces (Hooks, MCP, Webhooks, Secrets)
- Two drivers: Maestro-local (spawn + stream) and Claude Trigger (proxies via `claude -p /schedule`)
- Global + per-project scope, JSON persistence with dispatch log rotation
- YAML import/export, failure notifications, secrets via OS keychain

Shipped in two stages on this branch: Stage 1 (MVP core) and Stage 2 (Claude surfaces + polish). Each task is its own commit — reviewable sequentially.

**Spec:** [docs/superpowers/specs/2026-04-18-ops-panel-design.md](./docs/superpowers/specs/2026-04-18-ops-panel-design.md)
**Stage 1 plan:** [docs/superpowers/plans/2026-04-18-ops-panel-stage-1.md](./docs/superpowers/plans/2026-04-18-ops-panel-stage-1.md)
**Stage 2 plan:** [docs/superpowers/plans/2026-04-18-ops-panel-stage-2.md](./docs/superpowers/plans/2026-04-18-ops-panel-stage-2.md)

## Test plan

- [ ] Open the Ops tab — confirm Live/Jobs/Tools/Surfaces/History sections render
- [ ] Create a Maestro job (`echo hi` on `* * * * *`) — verify scheduled firing
- [ ] Create a Claude-trigger job — confirm `/schedule create` round-trips (requires `claude` CLI logged in)
- [ ] Toggle a hook in Surfaces → Hooks, verify round-trip into `~/.claude/settings.json`
- [ ] Add a secret, verify it appears in the list, delete it, verify it's gone from keychain
- [ ] Export jobs as YAML, re-import on another scope
- [ ] Fail a job, confirm system notification fires

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Stage 2 Self-Review

**Spec coverage check:**

- §5 Stage 2 item 11 Hooks editor → Task 33
- §5 Stage 2 item 12 MCP compact view → Task 34
- §5 Stage 2 item 13 Webhooks → Task 35 (deep-link fallback per spec §6 open question)
- §5 Stage 2 item 14 Secrets manager → Task 36
- §5 Stage 2 item 15 Cost/usage → Task 37 (scope reduced: tokens-on-JobRow; full Tamagotchi wire deferred)
- §5 Stage 2 item 16 Notifications → Task 38
- §5 Stage 2 item 17 YAML import/export → Task 39
- §5 Stage 2 item 18 Docs → Task 40

**Deliberate scope reductions:**

- **Task 37**: Only surfaces `tokens` on the JobRow. Full tamagotchi integration would require extending `useUsageStore` with a new dimension for ops-driven usage — substantial, and the tamagotchi widget isn't scoped in the plan. Token visibility per-job is the Stage-2-worthy slice.
- **Task 35 Webhooks**: Deep-link only, per spec §6 open question.

**Placeholder scan:** None. Every step has complete code or a specific modification.

**Type consistency:** `HookEntry`, `SecretEntry`, `HooksSnapshot` types defined in both Rust (`hooks_reader.rs`, `secrets.rs`) and TS (`types/ops.ts`) with `camelCase` serde on Rust side to match TS.

**Known soft spots:**

1. **McpServerConfig discriminator** (Task 34 Step 34.1): The code uses `"command" in s.server_type` for the runtime type check. Verify `McpServerConfig` actually has that structure by reading `src/lib/mcp.ts`. If the existing API uses a `type` field instead (`.server_type.type === "stdio"`), adjust accordingly.
2. **Notification plugin** (Task 38): Verify `@tauri-apps/plugin-notification` isn't already in `package.json`/`Cargo.toml` before adding. If it's already there, only wire the `.plugin(...)` call.
3. **YAML serde round-trip**: Our Rust types use `rename_all = "camelCase"`. `serde_yaml` will also produce camelCase keys — verify re-import on a fresh scope works.

---

## Execution handoff

Plan complete. Same two options as Stage 1:

1. **Subagent-driven** — I dispatch per-task subagents
2. **Inline** — executing-plans skill

User already chose subagent-driven for Stage 1 autonomous mode; proceed the same way.
