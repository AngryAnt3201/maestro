//! Shared utilities for IPC command modules.

use sha2::{Digest, Sha256};

/// Canonicalizes a project path, returning a user-friendly error on failure.
pub fn canonicalize_path(path: &str) -> Result<String, String> {
    Ok(std::fs::canonicalize(path)
        .map_err(|e| format!("Invalid project path '{}': {}", path, e))?
        .to_string_lossy()
        .into_owned())
}

/// Creates a stable hash of a project path for use in store filenames.
pub fn hash_project_path(path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    let result = hasher.finalize();
    format!("{:x}", &result)[..12].to_string()
}
