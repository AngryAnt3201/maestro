use std::path::{Path, PathBuf};

/// The shell script installed as `maestro` on the user's PATH. Embedded at
/// compile time so `cli/maestro.sh` is the single source of truth — editing
/// one without the other previously caused silent drift.
const CLI_SCRIPT: &str = include_str!("../../../cli/maestro.sh");

/// Resolves a CLI path argument to an absolute path.
/// Handles ".", "..", relative paths, and already-absolute paths.
/// Canonicalization is best-effort: a path that doesn't yet exist still
/// returns the joined absolute form rather than `None`.
pub fn resolve_cli_path(path: &str) -> Option<PathBuf> {
    let p = PathBuf::from(path);
    let absolute = if p.is_absolute() {
        p
    } else {
        std::env::current_dir().ok()?.join(p)
    };
    Some(absolute.canonicalize().unwrap_or(absolute))
}

/// Resolves a raw argv entry to an existing absolute path, or `None`.
///
/// Used by the single-instance handler to scan `args[1..]` for the user's
/// project path. Differs from [`resolve_cli_path`] in two ways:
///
/// 1. Args that look like flags (`-x`, `--foo`) are rejected outright. Without
///    this, a prepended flag from `open -b … --args` would be joined to cwd
///    and treated as the project path.
/// 2. The resolved path must actually exist. `resolve_cli_path` tolerates
///    non-existent paths for the startup-slot case (frontend validates), but
///    for argv scanning we want a real filesystem check so a stray unknown
///    token doesn't short-circuit the search.
pub fn resolve_existing_path_arg(arg: &str) -> Option<PathBuf> {
    if arg.starts_with('-') {
        return None;
    }
    let resolved = resolve_cli_path(arg)?;
    if resolved.exists() {
        Some(resolved)
    } else {
        None
    }
}

/// Returns the on-disk install target for the `maestro` CLI, or `None` on
/// platforms where we don't yet support installing.
///
/// Windows intentionally returns `None`: the embedded script is POSIX bash,
/// and silently dropping it at `maestro.cmd` produced a file that couldn't run.
fn cli_install_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        None
    }
    #[cfg(not(target_os = "windows"))]
    {
        Some(PathBuf::from("/usr/local/bin/maestro"))
    }
}

/// Escapes a path for safe interpolation inside an AppleScript `do shell script
/// "..."` single-quoted shell string.
///
/// `do shell script` wraps its argument in a literal shell invocation, so we
/// must defend against both the AppleScript string (double quotes, backslashes)
/// *and* the shell (single quotes). We only use single quotes in the shell, so
/// the shell-level escape is the classic `'\''` trick.
fn escape_for_applescript_single_quoted_shell(input: &str) -> String {
    // 1. Escape AppleScript string: `\` -> `\\`, `"` -> `\"`.
    let applescript_escaped = input.replace('\\', "\\\\").replace('"', "\\\"");
    // 2. Escape single quotes for the shell-level single-quoted string.
    applescript_escaped.replace('\'', "'\\''")
}

#[tauri::command]
pub fn install_cli() -> Result<String, String> {
    let dest = cli_install_path()
        .ok_or_else(|| "CLI install is not yet supported on this platform.".to_string())?;

    // Try direct write first
    match try_install_cli_direct(&dest) {
        Ok(()) => return Ok(dest.to_string_lossy().to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            // Fall through to elevated install
        }
        Err(e) => return Err(format!("Failed to install CLI: {e}")),
    }

    // Use elevated permissions (osascript on macOS, pkexec on Linux)
    install_cli_elevated(&dest)?;
    Ok(dest.to_string_lossy().to_string())
}

fn try_install_cli_direct(dest: &Path) -> std::io::Result<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(dest, CLI_SCRIPT)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dest, std::fs::Permissions::from_mode(0o755))?;
    }
    Ok(())
}

/// Sentinel string the frontend uses to distinguish user-cancel from a real
/// install failure. Keep in sync with `MaestroSettingsModal.tsx`.
const CANCEL_SENTINEL: &str = "CANCELLED_BY_USER";

fn install_cli_elevated(dest: &Path) -> Result<(), String> {
    // Write script to a temp file first, then move with elevated privileges
    let tmp = std::env::temp_dir().join("maestro-cli-install.sh");
    std::fs::write(&tmp, CLI_SCRIPT)
        .map_err(|e| format!("Failed to write temp file: {e}"))?;

    #[cfg(target_os = "macos")]
    {
        let tmp_escaped = escape_for_applescript_single_quoted_shell(&tmp.to_string_lossy());
        let dest_escaped = escape_for_applescript_single_quoted_shell(&dest.to_string_lossy());
        let script = format!(
            "do shell script \"install -m 755 '{tmp_escaped}' '{dest_escaped}'\" with administrator privileges"
        );
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
            .map_err(|e| format!("Failed to run osascript: {e}"))?;

        let _ = std::fs::remove_file(&tmp);

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("User canceled") || stderr.contains("-128") {
                return Err(CANCEL_SENTINEL.to_string());
            }
            return Err(format!("Failed to install: {stderr}"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        let output = std::process::Command::new("pkexec")
            .arg("install")
            .arg("-m")
            .arg("755")
            .arg(tmp.to_string_lossy().as_ref())
            .arg(dest.to_string_lossy().as_ref())
            .output()
            .map_err(|e| format!("Failed to run pkexec: {e}"))?;

        let _ = std::fs::remove_file(&tmp);

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // pkexec exits 126 when the user dismisses the auth dialog.
            if output.status.code() == Some(126) {
                return Err(CANCEL_SENTINEL.to_string());
            }
            return Err(format!("Failed to install: {stderr}"));
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = std::fs::remove_file(&tmp);
        let _ = dest; // avoid unused-variable warning
        return Err("CLI install is not yet supported on this platform.".to_string());
    }

    Ok(())
}

#[tauri::command]
pub fn uninstall_cli() -> Result<(), String> {
    let dest = match cli_install_path() {
        Some(p) => p,
        None => return Ok(()), // nothing to uninstall on unsupported platforms
    };
    if !dest.exists() {
        return Ok(());
    }

    // Try direct removal first
    match std::fs::remove_file(&dest) {
        Ok(()) => return Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            // Fall through to elevated removal
        }
        Err(e) => return Err(format!("Failed to remove CLI: {e}")),
    }

    #[cfg(target_os = "macos")]
    {
        let dest_escaped = escape_for_applescript_single_quoted_shell(&dest.to_string_lossy());
        let script = format!(
            "do shell script \"rm -f '{dest_escaped}'\" with administrator privileges"
        );
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
            .map_err(|e| format!("Failed to run osascript: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("User canceled") || stderr.contains("-128") {
                return Err(CANCEL_SENTINEL.to_string());
            }
            return Err(format!("Failed to uninstall: {stderr}"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        let output = std::process::Command::new("pkexec")
            .arg("rm")
            .arg("-f")
            .arg(dest.to_string_lossy().as_ref())
            .output()
            .map_err(|e| format!("Failed to run pkexec: {e}"))?;

        if !output.status.success() {
            if output.status.code() == Some(126) {
                return Err(CANCEL_SENTINEL.to_string());
            }
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to uninstall: {stderr}"));
        }
    }

    Ok(())
}

#[tauri::command]
pub fn is_cli_installed() -> bool {
    cli_install_path().map(|p| p.exists()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_cli_path_accepts_absolute_path() {
        let tmp = tempfile::tempdir().unwrap();
        let canonical = tmp.path().canonicalize().unwrap();
        let resolved = resolve_cli_path(canonical.to_str().unwrap()).unwrap();
        assert_eq!(resolved, canonical);
    }

    #[test]
    fn resolve_cli_path_resolves_dot_to_cwd() {
        let cwd = std::env::current_dir().unwrap().canonicalize().unwrap();
        let resolved = resolve_cli_path(".").unwrap();
        assert_eq!(resolved, cwd);
    }

    #[test]
    fn resolve_cli_path_handles_nonexistent_paths() {
        // An absolute path that doesn't exist must still return Some, not None.
        let candidate = if cfg!(target_os = "windows") {
            "C:\\does-not-exist-12345\\subpath"
        } else {
            "/does-not-exist-12345/subpath"
        };
        let resolved = resolve_cli_path(candidate).expect("should resolve");
        assert!(resolved.is_absolute());
    }

    #[test]
    fn resolve_cli_path_joins_relative_against_cwd() {
        let cwd = std::env::current_dir().unwrap().canonicalize().unwrap();
        let resolved = resolve_cli_path("Cargo.toml").unwrap();
        // Cargo.toml is in src-tauri/; canonicalize will resolve it if it exists.
        assert!(resolved.starts_with(&cwd) || resolved.is_absolute());
    }

    // ---- resolve_existing_path_arg ---------------------------------------

    #[test]
    fn existing_path_arg_rejects_short_flag() {
        assert!(resolve_existing_path_arg("-n").is_none());
    }

    #[test]
    fn existing_path_arg_rejects_long_flag() {
        assert!(resolve_existing_path_arg("--psn_0_12345").is_none());
    }

    #[test]
    fn existing_path_arg_rejects_nonexistent_path() {
        let candidate = if cfg!(target_os = "windows") {
            "C:\\does-not-exist-maestro-12345\\subpath"
        } else {
            "/does-not-exist-maestro-12345/subpath"
        };
        assert!(resolve_existing_path_arg(candidate).is_none());
    }

    #[test]
    fn existing_path_arg_accepts_real_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let canonical = tmp.path().canonicalize().unwrap();
        let resolved = resolve_existing_path_arg(canonical.to_str().unwrap())
            .expect("real path should resolve");
        assert_eq!(resolved, canonical);
    }

    #[test]
    fn existing_path_arg_skips_flag_then_accepts_path() {
        // Simulates scanning `["--some-flag", "<real-tmp-path>"]` argv-style.
        let tmp = tempfile::tempdir().unwrap();
        let canonical = tmp.path().canonicalize().unwrap();
        let canonical_str = canonical.to_str().unwrap().to_string();
        let args = ["--some-flag".to_string(), canonical_str];
        let resolved = args
            .iter()
            .find_map(|a| resolve_existing_path_arg(a))
            .expect("should find path after skipping flag");
        assert_eq!(resolved, canonical);
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn install_path_is_usr_local_bin_on_unix() {
        assert_eq!(
            cli_install_path().unwrap(),
            PathBuf::from("/usr/local/bin/maestro")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn install_path_is_none_on_windows() {
        assert!(cli_install_path().is_none());
    }

    #[test]
    fn applescript_escaping_leaves_plain_path_unchanged() {
        assert_eq!(
            escape_for_applescript_single_quoted_shell("/usr/local/bin/maestro"),
            "/usr/local/bin/maestro"
        );
    }

    #[test]
    fn applescript_escaping_handles_single_quote() {
        // o'brien -> o'\''brien under the shell single-quote escape.
        assert_eq!(
            escape_for_applescript_single_quoted_shell("/Users/o'brien/cli"),
            "/Users/o'\\''brien/cli"
        );
    }

    #[test]
    fn applescript_escaping_handles_double_quote_and_backslash() {
        // A path with a backslash and a double-quote must escape both for the
        // AppleScript string literal before shell escaping runs.
        let input = "a\\b\"c";
        let out = escape_for_applescript_single_quoted_shell(input);
        assert_eq!(out, "a\\\\b\\\"c");
    }

    #[test]
    fn cli_script_embedded_and_nonempty() {
        assert!(CLI_SCRIPT.starts_with("#!/bin/bash"));
        assert!(CLI_SCRIPT.contains("com.maestro.app"));
    }
}
