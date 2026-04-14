use std::path::PathBuf;

const CLI_SCRIPT: &str = r#"#!/bin/bash
# Maestro CLI — launch Maestro from the terminal
# Usage: maestro [path]

if [ -n "$1" ]; then
    # Resolve to absolute path
    if [ -d "$1" ]; then
        PATH_ARG="$(cd "$1" && pwd)"
    else
        PATH_ARG="$1"
    fi

    case "$(uname -s)" in
        Darwin)
            open -a Maestro --args "$PATH_ARG"
            ;;
        Linux)
            maestro-app "$PATH_ARG" &
            disown
            ;;
        MINGW*|MSYS*|CYGWIN*)
            start "" "Maestro.exe" "$PATH_ARG"
            ;;
    esac
else
    case "$(uname -s)" in
        Darwin)
            open -a Maestro
            ;;
        Linux)
            maestro-app &
            disown
            ;;
        MINGW*|MSYS*|CYGWIN*)
            start "" "Maestro.exe"
            ;;
    esac
fi
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

    // Ensure parent directory exists
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
    }

    std::fs::write(&dest, CLI_SCRIPT).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            "Permission denied. On macOS/Linux, you may need to run with sudo or ensure /usr/local/bin is writable.".to_string()
        } else {
            format!("Failed to write CLI script: {e}")
        }
    })?;

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Failed to set permissions: {e}"))?;
    }

    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub fn uninstall_cli() -> Result<(), String> {
    let dest = cli_install_path();
    if dest.exists() {
        std::fs::remove_file(&dest).map_err(|e| format!("Failed to remove CLI: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn is_cli_installed() -> bool {
    cli_install_path().exists()
}
