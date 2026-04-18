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
