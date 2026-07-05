use std::path::{Component, Path, PathBuf};

pub fn canonical_existing_dir(path: &Path, label: &str) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Invalid {} '{}': {}", label, path.display(), e))?;

    if !canonical.is_dir() {
        return Err(format!(
            "Invalid {} '{}': not a directory",
            label,
            path.display()
        ));
    }

    Ok(canonical)
}

pub fn has_claude_subdir_ancestor(path: &Path, subdir_name: &str) -> bool {
    path.ancestors().any(|ancestor| {
        ancestor
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name == subdir_name)
            && ancestor
                .parent()
                .and_then(|parent| parent.file_name())
                .and_then(|name| name.to_str())
                .is_some_and(|name| name == ".claude" || name == ".claude.local")
            && path != ancestor
    })
}

pub fn is_safe_relative_path(path: &str) -> bool {
    let path = Path::new(path);
    if path.as_os_str().is_empty() || path.is_absolute() {
        return false;
    }

    path.components()
        .all(|component| matches!(component, Component::Normal(_)))
}
