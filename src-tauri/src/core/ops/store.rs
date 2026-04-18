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
    let mut all: Vec<Dispatch> = Vec::new();
    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<Dispatch>(&line) {
            Ok(d) => all.push(d),
            Err(_) => continue,
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
        let err = scope_dir(Scope::Project, None).unwrap_err();
        match err {
            StoreError::MissingProjectHash => {}
            other => panic!("expected MissingProjectHash, got {other:?}"),
        }
    }

    #[test]
    fn dispatch_round_trips() {
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
