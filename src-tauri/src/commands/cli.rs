use std::path::PathBuf;

const CLI_SCRIPT: &str = r#"#!/bin/bash
# Maestro CLI — launch Maestro from the terminal
# Usage: maestro [path]

resolve_path() {
    if [ -d "$1" ]; then
        (cd "$1" && pwd)
    else
        echo "$1"
    fi
}

launch_macos() {
    # Try bundle identifier first (most reliable)
    if open -b com.maestro.app "$@" 2>/dev/null; then
        return 0
    fi
    # Fall back to app name
    if open -a Maestro "$@" 2>/dev/null; then
        return 0
    fi
    echo "Error: Maestro.app not found. Is it installed?" >&2
    return 1
}

case "$(uname -s)" in
    Darwin)
        if [ -n "$1" ]; then
            PATH_ARG="$(resolve_path "$1")"
            launch_macos --args "$PATH_ARG"
        else
            launch_macos
        fi
        ;;
    Linux)
        MAESTRO_BIN="${MAESTRO_BIN:-maestro-app}"
        if [ -n "$1" ]; then
            PATH_ARG="$(resolve_path "$1")"
            "$MAESTRO_BIN" "$PATH_ARG" &
        else
            "$MAESTRO_BIN" &
        fi
        disown
        ;;
    MINGW*|MSYS*|CYGWIN*)
        if [ -n "$1" ]; then
            PATH_ARG="$(resolve_path "$1")"
            start "" "Maestro.exe" "$PATH_ARG"
        else
            start "" "Maestro.exe"
        fi
        ;;
    *)
        echo "Unsupported platform: $(uname -s)" >&2
        exit 1
        ;;
esac
"#;

fn cli_install_path() -> PathBuf {
    if cfg!(target_os = "windows") {
        // On Windows, install to the user's local bin
        directories::BaseDirs::new()
            .map(|d| d.data_local_dir().join("Maestro").join("maestro.cmd"))
            .unwrap_or_else(|| PathBuf::from("C:\\Program Files\\Maestro\\maestro.cmd"))
    } else {
        PathBuf::from("/usr/local/bin/maestro")
    }
}

#[tauri::command]
pub fn install_cli() -> Result<String, String> {
    let dest = cli_install_path();

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

fn try_install_cli_direct(dest: &std::path::Path) -> std::io::Result<()> {
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

fn install_cli_elevated(dest: &std::path::Path) -> Result<(), String> {
    // Write script to a temp file first, then move with elevated privileges
    let tmp = std::env::temp_dir().join("maestro-cli-install.sh");
    std::fs::write(&tmp, CLI_SCRIPT)
        .map_err(|e| format!("Failed to write temp file: {e}"))?;

    let dest_str = dest.to_string_lossy();

    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "do shell script \"install -m 755 '{}' '{}'\" with administrator privileges",
            tmp.to_string_lossy(),
            dest_str
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
                return Err("Installation cancelled by user.".to_string());
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
            .arg(dest_str.as_ref())
            .output()
            .map_err(|e| format!("Failed to run pkexec: {e}"))?;

        let _ = std::fs::remove_file(&tmp);

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to install: {stderr}"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        let _ = std::fs::remove_file(&tmp);
        // On Windows the direct write should work since we install to user-local dir
    }

    Ok(())
}

#[tauri::command]
pub fn uninstall_cli() -> Result<(), String> {
    let dest = cli_install_path();
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

    let dest_str = dest.to_string_lossy();

    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "do shell script \"rm -f '{}'\" with administrator privileges",
            dest_str
        );
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
            .map_err(|e| format!("Failed to run osascript: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("User canceled") || stderr.contains("-128") {
                return Err("Uninstall cancelled by user.".to_string());
            }
            return Err(format!("Failed to uninstall: {stderr}"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        let output = std::process::Command::new("pkexec")
            .arg("rm")
            .arg("-f")
            .arg(dest_str.as_ref())
            .output()
            .map_err(|e| format!("Failed to run pkexec: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to uninstall: {stderr}"));
        }
    }

    Ok(())
}

#[tauri::command]
pub fn is_cli_installed() -> bool {
    cli_install_path().exists()
}
