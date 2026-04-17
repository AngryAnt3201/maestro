mod commands;
mod core;
mod git;
mod github;

use std::sync::{Arc, Mutex};

use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager, State};
use tauri_plugin_cli::CliExt;

/// Holds a CLI-argument project path captured at startup, before the frontend
/// has mounted. The frontend drains this via [`take_pending_cli_path`] once it
/// is ready to handle the event, which eliminates the old 500ms race.
#[derive(Default)]
struct PendingCliPath(Mutex<Option<String>>);

/// Frontend-invoked on mount to claim any project path passed on the CLI.
/// Subsequent invocations return `None`.
#[tauri::command]
fn take_pending_cli_path(state: State<'_, PendingCliPath>) -> Option<String> {
    state.0.lock().ok().and_then(|mut g| g.take())
}

use core::marketplace_manager::MarketplaceManager;
use core::mcp_manager::McpManager;
use core::plugin_manager::PluginManager;
use core::status_server::StatusServer;
use core::{ClaudeEvent, EventBus, TranscriptWatcher};
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
    // Initialize logger for RUST_LOG environment variable support
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    log::info!("Maestro starting up...");

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // A second instance was launched with these args — forward to the
            // existing (already-mounted) window. We scan every arg past the
            // executable for the first one that points at an existing path,
            // skipping flags. This tolerates the extra flags `open -b ...
            // --args` may prepend without letting a flag masquerade as the
            // project path.
            let resolved = args
                .iter()
                .skip(1)
                .find_map(|arg| commands::cli::resolve_existing_path_arg(arg));
            if let Some(p) = resolved {
                let _ = app.emit("cli-open-project", p.to_string_lossy().to_string());
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    // Register macOS permissions plugin (for Full Disk Access check)
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_plugin_macos_permissions::init());
    }

    builder
        .menu(|handle| {
            // App submenu (macOS standard items)
            let app_menu = SubmenuBuilder::new(handle, "Maestro")
                .about(None)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            // Edit submenu
            let edit_menu = SubmenuBuilder::new(handle, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            // View submenu with terminal font zoom controls
            let zoom_in = MenuItem::with_id(handle, "zoom-in", "Zoom In", true, Some("CmdOrCtrl+="))?;
            let zoom_out = MenuItem::with_id(handle, "zoom-out", "Zoom Out", true, Some("CmdOrCtrl+-"))?;
            let zoom_reset = MenuItem::with_id(handle, "zoom-reset", "Actual Size", true, Some("CmdOrCtrl+0"))?;
            let view_menu = SubmenuBuilder::new(handle, "View")
                .item(&zoom_in)
                .item(&zoom_out)
                .separator()
                .item(&zoom_reset)
                .separator()
                .fullscreen()
                .build()?;

            // Window submenu (intentionally no Zoom/maximize item)
            let window_menu = SubmenuBuilder::new(handle, "Window")
                .minimize()
                .separator()
                .close_window()
                .build()?;

            MenuBuilder::new(handle)
                .items(&[&app_menu, &edit_menu, &view_menu, &window_menu])
                .build()
        })
        .on_menu_event(|app, event| {
            let id = event.id();
            match id.as_ref() {
                "zoom-in" | "zoom-out" | "zoom-reset" => {
                    if let Err(e) = app.emit("terminal-zoom", id.as_ref()) {
                        log::error!("Failed to emit terminal-zoom event: {}", e);
                    }
                }
                _ => {}
            }
        })
        .manage(MarketplaceManager::new())
        .manage(McpManager::new())
        .manage(PluginManager::new())
        .manage(ProcessManager::new())
        .manage(SessionManager::new())
        .manage(WorktreeManager::new())
        .setup(|app| {
            // Generate a unique instance ID for this Maestro run
            // This prevents status pollution between different app instances
            let instance_id = uuid::Uuid::new_v4().to_string();
            log::info!("Maestro instance ID: {}", instance_id);

            // Create EventBus - emits events to frontend via Tauri
            let app_handle_for_bus = app.handle().clone();
            let emit_fn: Arc<dyn Fn(ClaudeEvent) + Send + Sync> = Arc::new(move |event: ClaudeEvent| {
                let _ = app_handle_for_bus.emit("claude-event", &event);
            });
            let event_bus = Arc::new(EventBus::new(emit_fn));

            // Create TranscriptWatcher
            let transcript_watcher = Arc::new(TranscriptWatcher::new(event_bus.clone()));

            // Create hook emit callback
            // When SessionStarted events arrive via hooks, start watching the transcript
            let event_bus_for_hooks = event_bus.clone();
            let transcript_watcher_for_hooks = transcript_watcher.clone();
            let hook_emit_fn: Arc<dyn Fn(ClaudeEvent) + Send + Sync> = Arc::new(move |event: ClaudeEvent| {
                if let ClaudeEvent::SessionStarted { session_id, ref transcript_path, .. } = event {
                    transcript_watcher_for_hooks.start_watching(
                        session_id,
                        std::path::PathBuf::from(transcript_path),
                    );
                }
                event_bus_for_hooks.emit(event);
            });

            // Start the HTTP status server for MCP status reporting
            // IMPORTANT: This must be done synchronously so the server is ready
            // before any commands try to use it
            let app_handle = app.handle().clone();
            let server = tauri::async_runtime::block_on(async {
                StatusServer::start(app_handle, instance_id, Some(hook_emit_fn)).await
            });

            match server {
                Some(server) => {
                    log::info!(
                        "Status server started on port {}, URL: {}",
                        server.port(),
                        server.status_url()
                    );
                    app.manage(Arc::new(server));
                }
                None => {
                    log::error!("Failed to start status server - MCP status reporting will not work");
                    // Return error to prevent app from starting without status server
                    return Err("Failed to start status server".into());
                }
            }

            app.manage(event_bus);
            app.manage(transcript_watcher);

            // Capture any CLI-supplied path into PendingCliPath state. The
            // frontend drains this on mount via `take_pending_cli_path`, which
            // avoids the fragile "wait N ms then emit" race.
            let pending = PendingCliPath::default();
            if let Ok(matches) = app.cli().matches() {
                if let Some(path_arg) = matches.args.get("path") {
                    if let Some(path_str) = path_arg.value.as_str() {
                        if !path_str.is_empty() {
                            if let Some(resolved) = commands::cli::resolve_cli_path(path_str) {
                                if let Ok(mut slot) = pending.0.lock() {
                                    *slot = Some(resolved.to_string_lossy().into_owned());
                                }
                            }
                        }
                    }
                }
            }
            app.manage(pending);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // PTY commands (existing)
            commands::terminal::spawn_shell,
            commands::terminal::write_stdin,
            commands::terminal::resize_pty,
            commands::terminal::kill_session,
            commands::terminal::kill_all_sessions,
            commands::terminal::check_cli_available,
            commands::terminal::get_backend_info,
            commands::terminal::get_session_process_tree,
            commands::terminal::get_all_process_trees,
            commands::terminal::kill_process,
            commands::terminal::save_pasted_image,
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
            commands::git::git_fetch,
            commands::git::git_fetch_all,
            commands::git::git_test_remote,
            commands::git::git_set_remote_url,
            commands::git::git_get_default_branch,
            commands::git::git_set_default_branch,
            commands::git::is_git_repository,
            commands::git::is_git_worktree,
            commands::git::detect_repositories,
            // Claude session history
            commands::claude_sessions::list_claude_sessions,
            commands::claude_sessions::delete_claude_session,
            // Session commands (new)
            commands::session::get_sessions,
            commands::session::create_session,
            commands::session::update_session_status,
            commands::session::assign_session_branch,
            commands::session::rename_session,
            commands::session::remove_session,
            commands::session::get_sessions_for_project,
            commands::session::remove_sessions_for_project,
            // Worktree commands
            commands::worktree::prepare_session_worktree,
            commands::worktree::cleanup_session_worktree,
            commands::worktree::get_default_worktree_base_dir,
            commands::worktree::has_managed_worktree,
            // MCP commands
            commands::mcp::get_project_mcp_servers,
            commands::mcp::refresh_project_mcp_servers,
            commands::mcp::get_session_mcp_servers,
            commands::mcp::set_session_mcp_servers,
            commands::mcp::get_session_mcp_count,
            commands::mcp::save_project_mcp_defaults,
            commands::mcp::load_project_mcp_defaults,
            commands::mcp::add_mcp_project,
            commands::mcp::remove_mcp_project,
            commands::mcp::remove_session_status,
            commands::mcp::write_session_mcp_config,
            commands::mcp::remove_session_mcp_config,
            commands::mcp::write_opencode_mcp_config,
            commands::mcp::remove_opencode_mcp_config,
            commands::mcp::generate_project_hash,
            commands::mcp::get_custom_mcp_servers,
            commands::mcp::save_custom_mcp_server,
            commands::mcp::delete_custom_mcp_server,
            commands::mcp::get_status_server_info,
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
            commands::plugin::write_session_plugin_config,
            commands::plugin::remove_session_plugin_config,
            commands::plugin::delete_skill,
            commands::plugin::delete_plugin,
            commands::plugin::save_branch_config,
            commands::plugin::load_branch_config,
            // Marketplace commands
            commands::marketplace::load_marketplace_data,
            commands::marketplace::get_marketplace_sources,
            commands::marketplace::add_marketplace_source,
            commands::marketplace::remove_marketplace_source,
            commands::marketplace::toggle_marketplace_source,
            commands::marketplace::refresh_marketplace,
            commands::marketplace::refresh_all_marketplaces,
            commands::marketplace::get_available_plugins,
            commands::marketplace::get_installed_plugins,
            commands::marketplace::install_marketplace_plugin,
            commands::marketplace::uninstall_plugin,
            commands::marketplace::is_marketplace_plugin_installed,
            commands::marketplace::get_session_marketplace_config,
            commands::marketplace::set_marketplace_plugin_enabled,
            commands::marketplace::clear_session_marketplace_config,
            // ClaudeMd commands
            commands::claudemd::check_claude_md,
            commands::claudemd::read_claude_md,
            commands::claudemd::write_claude_md,
            // Font detection commands
            commands::fonts::get_available_fonts,
            commands::fonts::check_font_available,
            // Usage tracking commands
            commands::usage::get_claude_usage,
            // GitHub commands
            commands::github::github_auth_status,
            commands::github::github_list_prs,
            commands::github::github_get_pr,
            commands::github::github_create_pr,
            commands::github::github_merge_pr,
            commands::github::github_close_pr,
            commands::github::github_comment_pr,
            commands::github::github_list_issues,
            commands::github::github_list_discussions,
            commands::github::github_get_issue,
            commands::github::github_comment_issue,
            commands::github::github_close_issue,
            commands::github::github_reopen_issue,
            commands::github::github_get_discussion,
            commands::github::github_comment_discussion,
            // Update commands
            commands::update::check_for_updates,
            commands::update::download_and_install_update,
            commands::update::get_app_version,
            // Hooks commands
            commands::hooks::write_session_hooks_config,
            commands::hooks::remove_session_hooks_config,
            // CLI commands
            commands::cli::install_cli,
            commands::cli::uninstall_cli,
            commands::cli::is_cli_installed,
            take_pending_cli_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Maestro");
}

// Note: We intentionally don't check git availability at startup.
// Spawning processes during Tauri's app initialization phase can cause
// crashes on some systems (particularly macOS with certain shell configurations).
// Git availability is checked lazily when git operations are performed,
// and the GitRunner handles GitNotFound errors gracefully.
