//! Tauri build script.
//!
//! This script copies the maestro-mcp-server binary to both:
//! 1. The target directory (for dev runtime discovery via candidate [0])
//! 2. src-tauri/binaries/ with target-triple suffix (for Tauri's externalBin bundler)

use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    // Copy MCP server binary BEFORE tauri_build::build() because
    // tauri_build validates that externalBin paths exist.
    copy_mcp_server_binary();

    // Standard Tauri build (validates externalBin paths)
    tauri_build::build();
}

/// Copies the maestro-mcp-server binary from its build location to:
/// 1. The Tauri target directory (for dev runtime, found by candidate [0])
/// 2. src-tauri/binaries/ with target-triple suffix (for externalBin bundler)
fn copy_mcp_server_binary() {
    let out_dir = env::var("OUT_DIR").unwrap_or_default();
    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    let target = env::var("TARGET").unwrap_or_default();

    // Determine binary name based on platform
    #[cfg(target_os = "windows")]
    let binary_name = "maestro-mcp-server.exe";
    #[cfg(not(target_os = "windows"))]
    let binary_name = "maestro-mcp-server";

    // Find the project root by traversing up from OUT_DIR
    // OUT_DIR is typically: src-tauri/target/{profile}/build/{crate}/out
    let project_root = PathBuf::from(&out_dir)
        .ancestors()
        .find(|p| p.join("maestro-mcp-server").is_dir())
        .map(|p| p.to_path_buf());

    let Some(project_root) = project_root else {
        println!("cargo:warning=Could not find project root from OUT_DIR: {}", out_dir);
        return;
    };

    // Source: target/{profile}/maestro-mcp-server (workspace builds to root target dir)
    let mcp_source = project_root
        .join("target")
        .join(&profile)
        .join(binary_name);

    // Also try release build if debug doesn't exist
    let mcp_source = if mcp_source.exists() {
        mcp_source
    } else {
        project_root
            .join("target")
            .join("release")
            .join(binary_name)
    };

    if !mcp_source.exists() {
        println!(
            "cargo:warning=maestro-mcp-server binary not found at {:?}. Build it first with: cargo build --release -p maestro-mcp-server",
            mcp_source
        );
        return;
    }

    // Destination 1: target/{profile}/maestro-mcp-server (next to the main executable)
    // In workspace builds, the main exe is at target/{profile}/maestro.exe,
    // so place the MCP binary alongside it for find_maestro_mcp_path candidate [0].
    let target_dir = project_root.join("target").join(&profile);
    let mcp_dest = target_dir.join(binary_name);

    // Only copy if source is newer than destination (or destination doesn't exist)
    let should_copy = should_copy_file(&mcp_source, &mcp_dest);

    if should_copy {
        copy_and_set_executable(&mcp_source, &mcp_dest);
    }

    // Destination 2: src-tauri/binaries/maestro-mcp-server-{TARGET}
    // This is where Tauri's externalBin bundler looks for sidecar binaries.
    if !target.is_empty() {
        let sidecar_dir = project_root.join("src-tauri").join("binaries");
        if let Err(e) = fs::create_dir_all(&sidecar_dir) {
            println!("cargo:warning=Failed to create sidecar dir {:?}: {}", sidecar_dir, e);
        } else {
            #[cfg(target_os = "windows")]
            let sidecar_name = format!("maestro-mcp-server-{}.exe", target);
            #[cfg(not(target_os = "windows"))]
            let sidecar_name = format!("maestro-mcp-server-{}", target);

            let sidecar_dest = sidecar_dir.join(&sidecar_name);
            if should_copy_file(&mcp_source, &sidecar_dest) {
                copy_and_set_executable(&mcp_source, &sidecar_dest);
            }
        }
    }

    // Tell Cargo to rerun this script if the MCP server binary changes
    // Only track existing files to avoid glob pattern errors
    if mcp_source.exists() {
        println!("cargo:rerun-if-changed={}", mcp_source.display());
    }
}

/// Check if source is newer than destination (or destination doesn't exist).
fn should_copy_file(source: &PathBuf, dest: &PathBuf) -> bool {
    if dest.exists() {
        let source_meta = fs::metadata(source).ok();
        let dest_meta = fs::metadata(dest).ok();
        match (source_meta, dest_meta) {
            (Some(s), Some(d)) => {
                s.modified().ok().unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                    > d.modified().ok().unwrap_or(std::time::SystemTime::UNIX_EPOCH)
            }
            _ => true,
        }
    } else {
        true
    }
}

/// Copy a file and set it executable on Unix.
fn copy_and_set_executable(source: &PathBuf, dest: &PathBuf) {
    if let Err(e) = fs::copy(source, dest) {
        println!(
            "cargo:warning=Failed to copy maestro-mcp-server from {:?} to {:?}: {}",
            source, dest, e
        );
    } else {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(mut perms) = fs::metadata(dest).map(|m| m.permissions()) {
                perms.set_mode(0o755);
                let _ = fs::set_permissions(dest, perms);
            }
        }
        println!(
            "cargo:warning=Copied maestro-mcp-server from {:?} to {:?}",
            source, dest
        );
    }
}
