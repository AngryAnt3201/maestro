//! PATH augmentation for CLI subprocesses spawned from the GUI.
//!
//! macOS apps launched from Finder/Dock/Spotlight inherit a minimal PATH from
//! launchd (typically `/usr/bin:/bin:/usr/sbin:/sbin`), which does not include
//! Homebrew, user installs, or most language toolchains. This causes
//! `Command::new("gh")` (and similar) to fail with `ErrorKind::NotFound` even
//! when the binary is installed. Linux has the same symptom when a DE launcher
//! runs with a restricted PATH.
//!
//! `augmented_path()` returns a PATH string combining the inherited PATH with
//! the common install directories, so subprocesses can find their executables.

#[cfg(unix)]
use std::sync::OnceLock;

/// Returns a PATH value that merges the process's inherited PATH with common
/// install directories missed by macOS/Linux GUI launchers.
///
/// The result is cached for the lifetime of the process.
#[cfg(unix)]
pub fn augmented_path() -> &'static str {
    static CACHED: OnceLock<String> = OnceLock::new();
    CACHED.get_or_init(build_augmented_path)
}

#[cfg(unix)]
fn build_augmented_path() -> String {
    let inherited = std::env::var("PATH").unwrap_or_default();
    let mut parts: Vec<String> = if inherited.is_empty() {
        Vec::new()
    } else {
        inherited.split(':').map(String::from).collect()
    };

    let mut extras: Vec<String> = vec![
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/sbin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/local/sbin".to_string(),
    ];

    if let Ok(home) = std::env::var("HOME") {
        extras.push(format!("{home}/.npm-global/bin"));
        extras.push(format!("{home}/node_modules/.bin"));
        extras.push(format!("{home}/.cargo/bin"));
        extras.push(format!("{home}/go/bin"));
        extras.push(format!("{home}/.local/bin"));
        extras.push(format!("{home}/.pyenv/shims"));
        extras.push(format!("{home}/.rbenv/shims"));
    }

    for dir in extras {
        if !parts.iter().any(|p| p == &dir) {
            parts.push(dir);
        }
    }

    parts.join(":")
}

#[cfg(test)]
#[cfg(unix)]
mod tests {
    use super::*;

    #[test]
    fn augmented_path_includes_common_dirs() {
        let path = augmented_path();
        assert!(path.contains("/opt/homebrew/bin"));
        assert!(path.contains("/usr/local/bin"));
    }

    #[test]
    fn augmented_path_preserves_inherited_entries() {
        let inherited = std::env::var("PATH").unwrap_or_default();
        let path = augmented_path();
        for entry in inherited.split(':').filter(|s| !s.is_empty()) {
            assert!(
                path.split(':').any(|p| p == entry),
                "expected inherited entry {entry:?} in augmented PATH"
            );
        }
    }
}
