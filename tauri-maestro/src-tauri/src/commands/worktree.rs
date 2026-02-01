use std::path::PathBuf;

use serde::Serialize;
use tauri::State;

use crate::core::worktree_manager::WorktreeManager;
use crate::git::Git;

/// Result of preparing a worktree for a session.
#[derive(Debug, Clone, Serialize)]
pub struct WorktreePreparationResult {
    /// The directory where the session should run (worktree or project path).
    pub working_directory: String,
    /// The worktree path if one was created or reused.
    pub worktree_path: Option<String>,
    /// Whether a new worktree was created (vs. reused or skipped).
    pub created: bool,
    /// Warning message if something unexpected happened but we recovered.
    pub warning: Option<String>,
}

/// Prepares a worktree for a session, handling all edge cases gracefully.
///
/// This command orchestrates worktree creation for a session launch:
/// 1. If no branch is specified, returns the project path as-is.
/// 2. If a worktree already exists for this branch, reuses it.
/// 3. If the branch is checked out in the main repo, switches main to default branch first.
/// 4. If the branch doesn't exist locally, creates it from HEAD.
/// 5. Creates the worktree via WorktreeManager.
///
/// On any failure, falls back to the project path so sessions always launch.
/// The caller is responsible for updating the session with the worktree path.
#[tauri::command]
pub async fn prepare_session_worktree(
    worktree_manager: State<'_, WorktreeManager>,
    project_path: String,
    branch: Option<String>,
) -> Result<WorktreePreparationResult, String> {
    // No branch specified - just use the project path
    let branch = match branch {
        Some(b) if !b.is_empty() => b,
        _ => {
            return Ok(WorktreePreparationResult {
                working_directory: project_path,
                worktree_path: None,
                created: false,
                warning: None,
            });
        }
    };

    let repo_path = PathBuf::from(&project_path);
    let git = Git::new(&repo_path);

    // Check if a worktree already exists for this branch
    match git.worktree_list().await {
        Ok(worktrees) => {
            for wt in &worktrees {
                if let Some(ref wt_branch) = wt.branch {
                    if wt_branch == &branch {
                        log::info!(
                            "Reusing existing worktree at {} for branch {}",
                            wt.path,
                            branch
                        );
                        return Ok(WorktreePreparationResult {
                            working_directory: wt.path.clone(),
                            worktree_path: Some(wt.path.clone()),
                            created: false,
                            warning: None,
                        });
                    }
                }
            }
        }
        Err(e) => {
            log::warn!("Failed to list worktrees: {}", e);
            // Continue - we'll try to create the worktree anyway
        }
    }

    // Check if the branch is checked out in the main repo and needs to be switched
    let current_branch = git.current_branch().await.ok();
    let mut warning = None;

    if current_branch.as_ref() == Some(&branch) {
        log::info!(
            "Target branch {} is checked out in main repo, switching to default",
            branch
        );

        // Get a fallback branch to switch to, or detach HEAD if none available
        match get_fallback_branch(&git, &branch).await {
            Some(fallback) => {
                match git.checkout_branch(&fallback).await {
                    Ok(()) => {
                        log::info!("Switched main repo to {}", fallback);
                    }
                    Err(e) => {
                        log::warn!("Failed to switch main repo to {}: {}", fallback, e);
                        warning = Some(format!(
                            "Could not switch main repo from {}: {}",
                            branch, e
                        ));
                        // Continue anyway - worktree creation might still work
                    }
                }
            }
            None => {
                // No other branches exist - detach HEAD to free the branch
                log::info!("No fallback branch available, detaching HEAD");
                match git.detach_head().await {
                    Ok(()) => {
                        log::info!("Detached HEAD in main repo");
                    }
                    Err(e) => {
                        log::warn!("Failed to detach HEAD: {}", e);
                        warning = Some(format!("Could not detach HEAD: {}", e));
                        // Continue anyway - worktree creation might still work
                    }
                }
            }
        }
    }

    // Check if the branch exists locally; if not, create it from HEAD
    let branch_exists = check_branch_exists(&git, &branch).await;
    if !branch_exists {
        log::info!("Branch {} doesn't exist locally, creating from HEAD", branch);
        if let Err(e) = git.create_branch(&branch, None).await {
            log::error!("Failed to create branch {}: {}", branch, e);
            // Fall back to project path
            return Ok(WorktreePreparationResult {
                working_directory: project_path,
                worktree_path: None,
                created: false,
                warning: Some(format!("Failed to create branch {}: {}", branch, e)),
            });
        }
    }

    // Create the worktree
    match worktree_manager.create(&branch, &repo_path).await {
        Ok(wt_path) => {
            let wt_path_str = wt_path.to_string_lossy().to_string();
            log::info!(
                "Created worktree at {} for branch {}",
                wt_path_str,
                branch
            );

            Ok(WorktreePreparationResult {
                working_directory: wt_path_str.clone(),
                worktree_path: Some(wt_path_str),
                created: true,
                warning,
            })
        }
        Err(e) => {
            log::error!("Failed to create worktree for {}: {}", branch, e);
            // Fall back to project path
            Ok(WorktreePreparationResult {
                working_directory: project_path,
                worktree_path: None,
                created: false,
                warning: Some(format!("Failed to create worktree: {}", e)),
            })
        }
    }
}

/// Cleans up a worktree when a session ends.
///
/// Removes the worktree from the filesystem and prunes git refs.
/// Failures are logged but don't prevent session cleanup.
#[tauri::command]
pub async fn cleanup_session_worktree(
    worktree_manager: State<'_, WorktreeManager>,
    project_path: String,
    worktree_path: String,
) -> Result<bool, String> {
    if worktree_path.is_empty() {
        // No worktree to clean up
        return Ok(false);
    }

    let repo_path = PathBuf::from(&project_path);
    let wt_path = PathBuf::from(&worktree_path);

    match worktree_manager.remove(&repo_path, &wt_path).await {
        Ok(()) => {
            log::info!("Cleaned up worktree at {}", worktree_path);
            Ok(true)
        }
        Err(e) => {
            log::warn!("Failed to cleanup worktree at {}: {}", worktree_path, e);
            // Return Ok(false) rather than error - cleanup failure shouldn't block session end
            Ok(false)
        }
    }
}

/// Gets a fallback branch to switch to when the target branch is checked out.
///
/// Tries init.defaultBranch config, then looks for main/master.
/// Returns None if no suitable fallback branch exists (e.g., single-branch repo).
async fn get_fallback_branch(git: &Git, avoid_branch: &str) -> Option<String> {
    // Try configured default branch
    if let Ok(Some(default)) = git.get_default_branch().await {
        if default != avoid_branch {
            return Some(default);
        }
    }

    // Check for common default branches
    if let Ok(branches) = git.list_branches().await {
        for candidate in ["main", "master", "develop"] {
            if candidate != avoid_branch
                && branches.iter().any(|b| !b.is_remote && b.name == candidate)
            {
                return Some(candidate.to_string());
            }
        }

        // Pick any local branch that's not the one we're avoiding
        for b in branches {
            if !b.is_remote && b.name != avoid_branch {
                return Some(b.name);
            }
        }
    }

    // No fallback available
    None
}

/// Checks if a branch exists locally.
async fn check_branch_exists(git: &Git, branch: &str) -> bool {
    match git.list_branches().await {
        Ok(branches) => branches.iter().any(|b| !b.is_remote && b.name == branch),
        Err(_) => false,
    }
}
