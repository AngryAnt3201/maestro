mod commands;
mod core;
mod git;

use std::sync::Arc;

use tauri::Manager;

use core::mcp_manager::McpManager;
use core::mcp_status_monitor::McpStatusMonitor;
use core::plugin_manager::PluginManager;
use core::ProcessManager;
use core::session_manager::SessionManager;
use core::worktree_manager::WorktreeManager;

/// Entry point for the Tauri application.
///
/// Registers plugins (store, dialog), injects shared state (ProcessManager,
/// SessionManager, WorktreeManager), verifies git availability at startup
/// (non-fatal -- logs an error but does not abort), and mounts all IPC
/// command handlers for the terminal, git, and session subsystems.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(McpManager::new())
        .manage(Arc::new(McpStatusMonitor::new()))
        .manage(PluginManager::new())
        .manage(ProcessManager::new())
        .manage(SessionManager::new())
        .manage(WorktreeManager::new())
        .setup(|app| {
            // Verify git is available at startup (non-blocking with timeout)
            tauri::async_runtime::spawn(async {
                match tokio::time::timeout(
                    std::time::Duration::from_secs(5),
                    verify_git_available(),
                )
                .await
                {
                    Ok(Ok(version)) => log::info!("Git available: {version}"),
                    Ok(Err(e)) => log::error!("Git not found: {e}. Git operations will fail."),
                    Err(_) => log::error!("Git version check timed out after 5s"),
                }
            });

            // Start MCP status monitor polling
            let monitor = app.state::<Arc<McpStatusMonitor>>().inner().clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                monitor.start_polling(app_handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // PTY commands (existing)
            commands::terminal::spawn_shell,
            commands::terminal::write_stdin,
            commands::terminal::resize_pty,
            commands::terminal::kill_session,
            commands::terminal::check_cli_available,
            commands::terminal::get_backend_info,
            commands::terminal::get_session_process_tree,
            commands::terminal::get_all_process_trees,
            commands::terminal::kill_process,
            // Git commands
            commands::git::git_branches,
            commands::git::git_current_branch,
            commands::git::git_uncommitted_count,
            commands::git::git_worktree_list,
            commands::git::git_worktree_add,
            commands::git::git_worktree_remove,
            commands::git::git_commit_log,
            commands::git::git_checkout_branch,
            commands::git::git_create_branch,
            commands::git::git_commit_files,
            commands::git::git_user_config,
            commands::git::git_set_user_config,
            commands::git::git_list_remotes,
            commands::git::git_add_remote,
            commands::git::git_remove_remote,
            commands::git::git_refs_for_commit,
            commands::git::git_test_remote,
            commands::git::git_set_remote_url,
            commands::git::git_get_default_branch,
            commands::git::git_set_default_branch,
            // Session commands (new)
            commands::session::get_sessions,
            commands::session::create_session,
            commands::session::update_session_status,
            commands::session::assign_session_branch,
            commands::session::remove_session,
            commands::session::get_sessions_for_project,
            commands::session::remove_sessions_for_project,
            // Worktree commands
            commands::worktree::prepare_session_worktree,
            commands::worktree::cleanup_session_worktree,
            // MCP commands
            commands::mcp::get_project_mcp_servers,
            commands::mcp::refresh_project_mcp_servers,
            commands::mcp::get_session_mcp_servers,
            commands::mcp::set_session_mcp_servers,
            commands::mcp::get_session_mcp_count,
            commands::mcp::save_project_mcp_defaults,
            commands::mcp::load_project_mcp_defaults,
            commands::mcp::set_mcp_project_path,
            commands::mcp::write_session_mcp_config,
            commands::mcp::remove_session_mcp_config,
            // Plugin commands
            commands::plugin::get_project_plugins,
            commands::plugin::refresh_project_plugins,
            commands::plugin::get_session_skills,
            commands::plugin::set_session_skills,
            commands::plugin::get_session_plugins,
            commands::plugin::set_session_plugins,
            commands::plugin::get_session_skills_count,
            commands::plugin::get_session_plugins_count,
            commands::plugin::save_project_skill_defaults,
            commands::plugin::load_project_skill_defaults,
            commands::plugin::save_project_plugin_defaults,
            commands::plugin::load_project_plugin_defaults,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Maestro");
}

async fn verify_git_available() -> Result<String, String> {
    let output = tokio::process::Command::new("git")
        .arg("--version")
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(version)
    } else {
        Err("git --version returned non-zero".to_string())
    }
}
