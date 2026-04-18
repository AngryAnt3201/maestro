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
