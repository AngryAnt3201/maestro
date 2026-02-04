//! Tauri build script.
//!
//! This script copies the maestro-mcp-server binary to the target directory
//! so it can be found by the Tauri application during development.

use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    // Standard Tauri build
    tauri_build::build();

    // Copy maestro-mcp-server binary to target directory for development
    copy_mcp_server_binary();
}

/// Copies the maestro-mcp-server binary from its build location to the Tauri target directory.
/// This ensures the binary can be found at runtime during development.
fn copy_mcp_server_binary() {
    let out_dir = env::var("OUT_DIR").unwrap_or_default();
    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());

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

    // Destination: target/{profile}/maestro-mcp-server (next to the main executable)
    // In workspace builds, the main exe is at target/{profile}/maestro.exe,
    // so place the MCP binary alongside it for find_maestro_mcp_path candidate [0].
    let target_dir = project_root.join("target").join(&profile);
    let mcp_dest = target_dir.join(binary_name);

    // Only copy if source is newer than destination (or destination doesn't exist)
    let should_copy = if mcp_dest.exists() {
        let source_meta = fs::metadata(&mcp_source).ok();
        let dest_meta = fs::metadata(&mcp_dest).ok();
        match (source_meta, dest_meta) {
            (Some(s), Some(d)) => {
                s.modified().ok().unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                    > d.modified().ok().unwrap_or(std::time::SystemTime::UNIX_EPOCH)
            }
            _ => true,
        }
    } else {
        true
    };

    if should_copy {
        if let Err(e) = fs::copy(&mcp_source, &mcp_dest) {
            println!(
                "cargo:warning=Failed to copy maestro-mcp-server from {:?} to {:?}: {}",
                mcp_source, mcp_dest, e
            );
        } else {
            // Make the binary executable on Unix
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(mut perms) = fs::metadata(&mcp_dest).map(|m| m.permissions()) {
                    perms.set_mode(0o755);
                    let _ = fs::set_permissions(&mcp_dest, perms);
                }
            }
            println!(
                "cargo:warning=Copied maestro-mcp-server from {:?} to {:?}",
                mcp_source, mcp_dest
            );
        }
    }

    // Tell Cargo to rerun this script if the MCP server binary changes
    println!("cargo:rerun-if-changed={}", mcp_source.display());
}
