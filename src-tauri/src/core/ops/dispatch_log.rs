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
    use super::*;

    #[test]
    fn report_default_is_all_zeros() {
        let r = RotateReport::default();
        assert_eq!(r, RotateReport { kept: 0, dropped: 0, removed_logs: 0 });
    }
}
